import path from 'path';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { createWorkerConverter } from '@matbee/libreoffice-converter/server';

const require = createRequire(import.meta.url);

/** Absolute path to the package's shipped WASM assets (~250MB). */
export function getLibreOfficeWasmPath(): string {
  const pkgJson = require.resolve('@matbee/libreoffice-converter/package.json');
  return path.join(path.dirname(pkgJson), 'wasm');
}

/**
 * Whether this process can actually convert — i.e. the ~237MB of WASM the package ships is on
 * disk next to it.
 *
 * It is not always: a serverless bundler decides what to ship by tracing a function's imports, and
 * `getLibreOfficeWasmPath` builds its path at runtime, so `soffice.wasm` and `soffice.data` are
 * invisible to the trace and are left out unless the deployment config names them explicitly
 * (`includeFiles` in vercel.json). Checked before init so the failure is a clear 503 rather than a
 * loader stack trace 500, and so `GET /api/convert/pptx-to-pdf` can answer the question without
 * paying the ~1GB, multi-second cost of starting LibreOffice.
 */
export function libreOfficeWasmAvailable(): boolean {
  try {
    return existsSync(path.join(getLibreOfficeWasmPath(), 'soffice.wasm'));
  } catch {
    return false;
  }
}

export function getLibreOfficePackageRoot(): string {
  const pkgJson = require.resolve('@matbee/libreoffice-converter/package.json');
  return path.dirname(pkgJson);
}

type WorkerConverter = Awaited<ReturnType<typeof createWorkerConverter>>;

/**
 * How long a single conversion may run before this process stops waiting on it.
 *
 * Deliberately below the convert function's own `maxDuration` (60s in vercel.json, which is also
 * the ceiling on a personal account). Measured 2026-09-26 on this machine: roughly one cold first
 * conversion in three stalls for about 80 seconds on a deck that otherwise converts in two, and
 * the stall is idle waiting rather than work — 83.6s of wall time against 15.2s of user CPU, where
 * a healthy run spends 10s of CPU in 4s of wall time. Past 60s the platform kills the invocation
 * and answers with its own HTML gateway page, so the browser gets no reason at all. Stopping first
 * means the route can say what happened and the client's one retry can start against a converter
 * that is not stuck.
 */
const DEFAULT_CONVERT_DEADLINE_MS = 45_000;

function convertDeadlineMs(): number {
  const raw = Number(process.env.LM_CONVERT_DEADLINE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CONVERT_DEADLINE_MS;
}

/** Just enough of a converter for the lifecycle below; the real one has far more. */
export interface ConverterLike {
  isReady(): boolean;
  destroy?(): Promise<void> | void;
}

/** The one converter this process shares, and any init still in flight. */
export interface ConverterSlot<T extends ConverterLike> {
  instance: T | null;
  pending: Promise<T> | null;
}

/**
 * Hand back the shared converter, starting one if there is none — and, crucially, replacing one
 * that has stopped being ready.
 *
 * That last case used to be unreachable. `isReady()` is false once the worker is gone, but the
 * init promise from the first successful start was still cached, so this returned the dead
 * instance and every later conversion in the process failed instantly with "Converter not
 * initialized. Call initialize() first." One lost worker therefore broke a warm serverless
 * instance permanently, while a request routed to any other instance succeeded — which is what a
 * conversion that fails in a batch and works on its own looks like from the outside.
 */
export async function acquireConverter<T extends ConverterLike>(
  slot: ConverterSlot<T>,
  create: () => Promise<T>
): Promise<T> {
  if (slot.instance?.isReady()) return slot.instance;
  if (slot.instance) discardConverter(slot);
  if (!slot.pending) {
    slot.pending = (async () => {
      try {
        const instance = await create();
        slot.instance = instance;
        return instance;
      } catch (error) {
        // A failed start leaves nothing behind, so the next caller tries again rather than
        // awaiting a promise that has already rejected.
        slot.pending = null;
        slot.instance = null;
        throw error;
      }
    })();
  }
  return slot.pending;
}

/**
 * Drop the shared converter and terminate its worker in the background.
 *
 * Not awaited: a worker that is stuck mid-conversion is exactly when this is called, and the
 * caller is already out of time. What matters is that the next `acquireConverter` starts a fresh
 * one rather than queueing behind the stuck one.
 */
export function discardConverter<T extends ConverterLike>(slot: ConverterSlot<T>): void {
  const dying = slot.instance;
  slot.instance = null;
  slot.pending = null;
  if (!dying) return;
  void (async () => {
    try {
      await dying.destroy?.();
    } catch {
      /* it was already broken; nothing here can be done about it */
    }
  })();
}

/** Thrown when a conversion outlives its deadline, so the route can say so rather than time out. */
export class ConversionTimeoutError extends Error {
  constructor(ms: number) {
    super(
      `LibreOffice did not finish converting within ${Math.round(ms / 100) / 10}s and was abandoned. ` +
        'This is the stall described in docs/specs/friction-log.md; a retry starts a fresh converter.'
    );
    this.name = 'ConversionTimeoutError';
  }
}

/** Resolve with `work`, or reject once `ms` has passed, running `onTimeout` in that case. */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new ConversionTimeoutError(ms));
        }, ms);
        // Deliberately not unref'd: an unref'd deadline never fires when the stalled conversion is
        // the only thing left, which is precisely the case it exists for. `finally` always clears
        // it, so it cannot outlive the call.
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // The abandoned conversion may still reject later; nothing is listening by then.
    void work.catch(() => {});
  }
}

const slot: ConverterSlot<WorkerConverter> = { instance: null, pending: null };

/**
 * Lazy singleton LibreOffice WASM worker (Node). First call pays init cost;
 * subsequent PPTX→PDF conversions reuse the same worker.
 */
export async function getLibreOfficeConverter(): Promise<WorkerConverter> {
  return acquireConverter(slot, async () => {
    const wasmPath = getLibreOfficeWasmPath();
    console.log(`[LibreOffice WASM] Initializing worker from ${wasmPath} …`);
    const started = Date.now();
    const instance = await createWorkerConverter({ wasmPath, verbose: false });
    console.log(`[LibreOffice WASM] Ready in ${Date.now() - started}ms`);
    return instance;
  });
}

/** Convert PPTX (or PPT) bytes to PDF via LibreOffice WASM. */
export async function convertPptxBufferToPdf(
  input: Uint8Array | ArrayBuffer,
  filename = 'presentation.pptx'
): Promise<{ data: Uint8Array; duration: number; filename: string }> {
  // The deadline covers starting LibreOffice as well as converting, because what the route has to
  // promise is an answer before the platform stops waiting — not an answer from any one stage.
  const result = await withDeadline(
    (async () => {
      const lo = await getLibreOfficeConverter();
      return lo.convert(
        input,
        {
          outputFormat: 'pdf',
          inputFormat: filename.toLowerCase().endsWith('.ppt') ? 'ppt' : 'pptx',
        },
        filename
      );
    })(),
    convertDeadlineMs(),
    () => discardConverter(slot)
  );
  return {
    data: result.data,
    duration: result.duration,
    filename: result.filename || filename.replace(/\.pptx?$/i, '.pdf'),
  };
}
