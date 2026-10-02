import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';

/**
 * html2canvas parses the cloned document's root and body background before it renders
 * anything, regardless of the backgroundColor option. Tailwind v4 sets those with
 * oklch(), which the 1.4.1 colour parser throws on, so overwrite them with plain hex.
 * Patching the clone keeps the visible page unchanged during capture.
 */
const neutralizeClonedRootBackground = (clonedDocument: Document): void => {
  clonedDocument.documentElement.style.backgroundColor = '#ffffff';
  if (clonedDocument.body) {
    clonedDocument.body.style.backgroundColor = '#ffffff';
  }
};

/**
 * Returns a PDF of the branded template, or `null` when the template had nothing to draw.
 *
 * A document that extracted nothing (an evaluator's report, say — see
 * fixtures/regression-set/snapshots/philadelphia-ballet-lets-dance.json) paginates to zero
 * `.pdf-page` elements, so the container measures 0x0, html2canvas hands back a 0x0 canvas and
 * `toDataURL` returns the string "data:," rather than a JPEG. Feeding that to jsPDF throws
 * `addImage does not support files of type 'UNKNOWN'`, which used to abort a whole batch export.
 * Detect it here and report it as "nothing to draw" instead. A genuine failure still throws.
 */
export const generatePdfFromElement = async (
  elementId: string,
  _filename: string
): Promise<Blob | null> => {
  const container = document.getElementById(elementId);
  if (!container) {
    throw new Error(`PDF template element ${elementId} is not mounted`);
  }

  try {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const pdfWidth = 297;
    const pdfHeight = 210;

    const pages = container.querySelectorAll('.pdf-page');
    const elementsToCapture = pages.length > 0 ? Array.from(pages) : [container];
    let drawn = 0;

    for (const element of elementsToCapture as HTMLElement[]) {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        onclone: neutralizeClonedRootBackground,
      });

      if (canvas.width === 0 || canvas.height === 0) continue;

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      if (!imgData.startsWith('data:image/')) continue;

      // Only paginate once a page is actually going in, so a skipped page leaves no blank sheet.
      if (drawn > 0) {
        doc.addPage();
      }

      const imgProps = doc.getImageProperties(imgData);
      const ratio = imgProps.width / imgProps.height;
      const width = pdfWidth;
      const height = width / ratio;
      const y = height < pdfHeight ? (pdfHeight - height) / 2 : 0;

      doc.addImage(imgData, 'JPEG', 0, y, width, height);
      drawn++;
    }

    if (drawn === 0) return null;

    return doc.output('blob');
  } catch (error) {
    console.error('PDF Generation Error:', error);
    throw error;
  }
};

/**
 * How much archive to hold in memory before handing it to the Blob store. JSZip's own
 * `generateAsync({ type: 'blob' })` accumulates every chunk, concatenates them into one
 * Uint8Array the size of the whole archive and then copies that into an ArrayBuffer — three
 * copies of the finished ZIP live at once at the peak. At 251 branded PDFs that archive runs to
 * a few hundred MB, and the browser can run out of room mid-write; when it does, the next source
 * blob fails to read and the whole export throws. Flushing in slices keeps the resident cost flat:
 * each slice becomes its own Blob (which lives in the browser's blob store, not the JS heap) and
 * the final Blob just references them.
 */
const ZIP_FLUSH_BYTES = 8 * 1024 * 1024;

/**
 * Build the ZIP without ever holding the whole archive in memory. Same bytes as
 * `generateAsync({ type: 'blob' })`, a fraction of the peak memory.
 */
export const buildZipArchive = async (files: { name: string; blob: Blob }[]): Promise<Blob> => {
  const zip = new JSZip();
  files.forEach(file => {
    zip.file(file.name, file.blob);
  });

  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;

  const flush = () => {
    if (pending.length === 0) return;
    parts.push(new Blob(pending));
    pending = [];
    pendingBytes = 0;
  };

  await new Promise<void>((resolve, reject) => {
    zip
      .generateInternalStream({ type: 'uint8array' })
      .on('data', (chunk: Uint8Array) => {
        pending.push(chunk);
        pendingBytes += chunk.length;
        if (pendingBytes >= ZIP_FLUSH_BYTES) flush();
      })
      .on('error', reject)
      .on('end', () => {
        flush();
        resolve();
      })
      .resume();
  });

  return new Blob(parts, { type: 'application/zip' });
};

export const createZipFromBlobs = async (
  files: { name: string; blob: Blob }[]
): Promise<void> => {
  const content = await buildZipArchive(files);
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = `logic_models_batch_${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
