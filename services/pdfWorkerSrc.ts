import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDF_WORKER_POLYFILL_SOURCE } from '../polyfills';

/**
 * A `GlobalWorkerOptions.workerSrc` that installs `polyfills.ts`'s two pdf.js polyfills inside the
 * worker before pdf.js itself evaluates there.
 *
 * Why a wrapper at all: pdf.js spawns `new Worker(workerSrc, { type: 'module' })`, and a module
 * worker is a separate realm with its own `Map.prototype` and `Math`. `polyfills.ts` runs on the
 * main thread and cannot reach it, so pointing `workerSrc` straight at pdf.js's own worker leaves
 * the worker unpatched — see that file for what breaks.
 *
 * Why a blob: the wrapper has to name the real worker's URL, and that URL is only known here (Vite
 * emits a hashed asset for it in a production build), so it cannot be a static file in `public/`.
 * pdf.js uses this exact shape itself for cross-origin worker sources (`PDFWorker._createCDNWrapper`
 * builds `await import("…")` as a blob), so the blob-module-worker path is one pdf.js already
 * relies on rather than a trick this app invented. The URL is absolutised because a blob worker
 * resolves relative specifiers against the blob, not against the page.
 *
 * Falls back to the unwrapped worker where `Blob`/`createObjectURL` are unavailable: an unpatched
 * worker renders most PDFs, whereas no worker at all renders none.
 */
export function polyfilledPdfWorkerSrc(): string {
  if (typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') {
    return pdfWorkerUrl;
  }
  const realWorkerUrl = new URL(pdfWorkerUrl, globalThis.location?.href).href;
  const bootstrap = `${PDF_WORKER_POLYFILL_SOURCE}\nawait import(${JSON.stringify(realWorkerUrl)});\n`;
  return URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
}
