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

export const generatePdfFromElement = async (
  elementId: string,
  _filename: string
): Promise<Blob | null> => {
  const container = document.getElementById(elementId);
  if (!container) {
    console.error(`Element with id ${elementId} not found`);
    return null;
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

    for (let i = 0; i < elementsToCapture.length; i++) {
      const element = elementsToCapture[i] as HTMLElement;

      if (i > 0) {
        doc.addPage();
      }

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        onclone: neutralizeClonedRootBackground,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const imgProps = doc.getImageProperties(imgData);
      const ratio = imgProps.width / imgProps.height;
      const width = pdfWidth;
      const height = width / ratio;
      const y = height < pdfHeight ? (pdfHeight - height) / 2 : 0;

      doc.addImage(imgData, 'JPEG', 0, y, width, height);
    }

    return doc.output('blob');
  } catch (error) {
    console.error('PDF Generation Error:', error);
    throw error;
  }
};

export const createZipFromBlobs = async (
  files: { name: string; blob: Blob }[]
): Promise<void> => {
  const zip = new JSZip();

  files.forEach(file => {
    zip.file(file.name, file.blob);
  });

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = `logic_models_batch_${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
