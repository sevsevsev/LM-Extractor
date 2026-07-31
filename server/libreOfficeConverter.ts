import path from 'path';
import { createRequire } from 'module';
import { createWorkerConverter } from '@matbee/libreoffice-converter/server';

const require = createRequire(import.meta.url);

/** Absolute path to the package's shipped WASM assets (~250MB). */
export function getLibreOfficeWasmPath(): string {
  const pkgJson = require.resolve('@matbee/libreoffice-converter/package.json');
  return path.join(path.dirname(pkgJson), 'wasm');
}

export function getLibreOfficePackageRoot(): string {
  const pkgJson = require.resolve('@matbee/libreoffice-converter/package.json');
  return path.dirname(pkgJson);
}

type WorkerConverter = Awaited<ReturnType<typeof createWorkerConverter>>;

let converter: WorkerConverter | null = null;
let initPromise: Promise<WorkerConverter> | null = null;

/**
 * Lazy singleton LibreOffice WASM worker (Node). First call pays init cost;
 * subsequent PPTX→PDF conversions reuse the same worker.
 */
export async function getLibreOfficeConverter(): Promise<WorkerConverter> {
  if (converter?.isReady()) return converter;
  if (!initPromise) {
    initPromise = (async () => {
      const wasmPath = getLibreOfficeWasmPath();
      console.log(`[LibreOffice WASM] Initializing worker from ${wasmPath} …`);
      const started = Date.now();
      const instance = await createWorkerConverter({
        wasmPath,
        verbose: false,
      });
      console.log(`[LibreOffice WASM] Ready in ${Date.now() - started}ms`);
      converter = instance;
      return instance;
    })().catch(err => {
      initPromise = null;
      converter = null;
      throw err;
    });
  }
  return initPromise;
}

/** Convert PPTX (or PPT) bytes to PDF via LibreOffice WASM. */
export async function convertPptxBufferToPdf(
  input: Uint8Array | ArrayBuffer,
  filename = 'presentation.pptx'
): Promise<{ data: Uint8Array; duration: number; filename: string }> {
  const lo = await getLibreOfficeConverter();
  const result = await lo.convert(
    input,
    { outputFormat: 'pdf', inputFormat: filename.toLowerCase().endsWith('.ppt') ? 'ppt' : 'pptx' },
    filename
  );
  return {
    data: result.data,
    duration: result.duration,
    filename: result.filename || filename.replace(/\.pptx?$/i, '.pdf'),
  };
}
