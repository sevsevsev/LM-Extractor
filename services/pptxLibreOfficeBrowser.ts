/**
 * Browser-side LibreOffice WASM PPTX→PDF (fallback when Express convert API is unavailable).
 * Requires COOP/COEP headers and `/wasm/*` + worker script to be served same-origin.
 */
import {
  WorkerBrowserConverter,
  createWasmPaths,
  type ConversionResult,
} from '@matbee/libreoffice-converter/browser';

let converter: WorkerBrowserConverter | null = null;
let initPromise: Promise<WorkerBrowserConverter> | null = null;

async function getBrowserConverter(): Promise<WorkerBrowserConverter> {
  if (converter?.isReady()) return converter;
  if (!initPromise) {
    initPromise = (async () => {
      const instance = new WorkerBrowserConverter({
        ...createWasmPaths('/wasm/'),
        // Packaged global worker (IIFE) served by Express / Vite proxy
        browserWorkerJs: '/libreoffice/browser.worker.global.js',
        onProgress: info => {
          console.log(`[LibreOffice WASM browser] ${info.percent}% — ${info.message}`);
        },
      });
      console.log('[LibreOffice WASM browser] Initializing (first load may take ~1 min)…');
      await instance.initialize();
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

export async function convertPptxToPdfInBrowser(
  input: ArrayBuffer,
  filename: string
): Promise<ConversionResult> {
  const lo = await getBrowserConverter();
  return lo.convert(
    input,
    {
      outputFormat: 'pdf',
      inputFormat: filename.toLowerCase().endsWith('.ppt') ? 'ppt' : 'pptx',
    },
    filename
  );
}
