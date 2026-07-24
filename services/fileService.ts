import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import TurndownService from 'turndown';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_VISION_PAGES = 15;

export const convertPdfToImages = async (file: File): Promise<string[]> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const images: string[] = [];
    const pageCount = Math.min(pdf.numPages, MAX_VISION_PAGES);

    if (pdf.numPages > MAX_VISION_PAGES) {
      console.warn(`PDF has ${pdf.numPages} pages; processing first ${MAX_VISION_PAGES} only.`);
    }

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // High scale for better text recognition
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      if (context) {
        await page.render({ canvasContext: context, canvas, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        images.push(dataUrl.split(',')[1]);
      }
    }
    return images;
  } catch (error) {
    console.error('PDF Image Conversion Error:', error);
    throw new Error('Failed to convert PDF to images for analysis.');
  }
};

export const convertDocxToImages = async (file: File): Promise<string[]> => {
  let container: HTMLDivElement | null = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '1000px'; // Fixed width to force layout
    container.style.backgroundColor = 'white';
    document.body.appendChild(container);

    // Render DOCX to DOM
    await renderAsync(arrayBuffer, container, container, {
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true
    });

    // Capture the rendered content
    const canvas = await html2canvas(container, {
        scale: 1.5,
        useCORS: true
    });

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    return [dataUrl.split(',')[1]];

  } catch (error) {
    console.error('DOCX Image Conversion Error:', error);
    throw new Error('Failed to convert Word document to images.');
  } finally {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
};

export const convertPptxToImages = async (file: File): Promise<string[]> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // Filter for slide XML files
    const slideFiles = Object.keys(zip.files).filter(name => 
      name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
    );
    
    slideFiles.sort((a, b) => {
      const getNum = (str: string) => {
        const match = str.match(/slide(\d+)\.xml/);
        return match ? parseInt(match[1], 10) : 0;
      };
      return getNum(a) - getNum(b);
    });

    if (slideFiles.length > MAX_VISION_PAGES) {
      console.warn(`PPTX has ${slideFiles.length} slides; processing first ${MAX_VISION_PAGES} only.`);
    }
    const slidesToProcess = slideFiles.slice(0, MAX_VISION_PAGES);

    const images: string[] = [];
    const parser = new DOMParser();

    // 1 inch = 914400 EMUs. 96 DPI -> 9525 EMUs per px.
    const emuToPx = (emu: number) => emu / 9525;

    const createSvgRectAndText = (x: number, y: number, w: number, h: number, text: string) => {
        const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
          <g>
            <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(240, 240, 255, 0.4)" stroke="#3b82f6" stroke-width="1" />
            <foreignObject x="${x}" y="${y}" width="${w}" height="${h}">
                <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:4px;overflow:hidden;height:100%;word-wrap:break-word;">
                    ${safeText}
                </div>
            </foreignObject>
          </g>
        `;
    };

    // Recursive function to process Shapes, Groups, and GraphicFrames (tables)
    const processNodeList = (nodes: HTMLCollection | NodeListOf<Element>, offsetX = 0, offsetY = 0): string => {
        let svgFragment = '';
        
        Array.from(nodes).forEach(node => {
            if (node.nodeType !== 1) return; // Skip non-element nodes
            const element = node as Element;
            const tagName = element.tagName;

            // --- 1. SHAPES (p:sp) ---
            if (tagName === 'p:sp') {
                const xfrm = element.getElementsByTagName('a:xfrm')[0];
                if (xfrm) {
                    const off = xfrm.getElementsByTagName('a:off')[0];
                    const ext = xfrm.getElementsByTagName('a:ext')[0];
                    if (off && ext) {
                        const x = emuToPx(parseInt(off.getAttribute('x') || '0')) + offsetX;
                        const y = emuToPx(parseInt(off.getAttribute('y') || '0')) + offsetY;
                        const w = emuToPx(parseInt(ext.getAttribute('cx') || '0'));
                        const h = emuToPx(parseInt(ext.getAttribute('cy') || '0'));
                        
                        const txBody = element.getElementsByTagName('p:txBody')[0];
                        if (txBody) {
                             const text = Array.from(txBody.getElementsByTagName('a:t')).map(t => t.textContent).join(' ');
                             if (text && text.trim()) {
                                 svgFragment += createSvgRectAndText(x, y, w, h, text);
                             }
                        }
                    }
                }
            }

            // --- 2. GROUPS (p:grpSp) ---
            else if (tagName === 'p:grpSp') {
                const grpSpPr = element.getElementsByTagName('p:grpSpPr')[0];
                let groupX = 0, groupY = 0;
                
                // Simplified Group Transform Handling:
                // We mainly care about the visual offset ('off') to shift children correctly on the page.
                // Complex scaling or chOff/chExt logic is omitted for stability, as we just need the text roughly in place.
                if (grpSpPr) {
                    const xfrm = grpSpPr.getElementsByTagName('a:xfrm')[0];
                    if (xfrm) {
                         const off = xfrm.getElementsByTagName('a:off')[0];
                         if (off) {
                             groupX = emuToPx(parseInt(off.getAttribute('x') || '0'));
                             groupY = emuToPx(parseInt(off.getAttribute('y') || '0'));
                         }
                    }
                }
                
                // Recursively process children of the group
                // Note: p:grpSp has direct children like p:sp, p:grpSp, p:graphicFrame
                svgFragment += processNodeList(element.children, offsetX + groupX, offsetY + groupY);
            }

            // --- 3. GRAPHIC FRAMES (Tables, Charts, Diagrams) ---
            else if (tagName === 'p:graphicFrame') {
                const xfrm = element.getElementsByTagName('p:xfrm')[0];
                let x = 0, y = 0, w = 0, h = 0;
                
                if (xfrm) {
                    const off = xfrm.getElementsByTagName('a:off')[0];
                    const ext = xfrm.getElementsByTagName('a:ext')[0];
                    if (off) {
                        x = emuToPx(parseInt(off.getAttribute('x') || '0')) + offsetX;
                        y = emuToPx(parseInt(off.getAttribute('y') || '0')) + offsetY;
                    }
                    if (ext) {
                        w = emuToPx(parseInt(ext.getAttribute('cx') || '0'));
                        h = emuToPx(parseInt(ext.getAttribute('cy') || '0'));
                    }
                }

                // CHECK FOR TABLE
                const tbl = element.getElementsByTagName('a:tbl')[0];
                if (tbl) {
                    const trs = tbl.getElementsByTagName('a:tr');
                    let currentY = y;
                    // Fallback height if row height not specified
                    const avgRowHeight = trs.length > 0 ? h / trs.length : 20;

                    Array.from(trs).forEach(tr => {
                        const hAttr = tr.getAttribute('h');
                        const rowH = hAttr ? emuToPx(parseInt(hAttr)) : avgRowHeight;
                        
                        const tcs = tr.getElementsByTagName('a:tc');
                        let currentX = x;
                        // Determine grid columns to estimate width if needed (complex), 
                        // simple approach: distribute width evenly if we can't find grid.
                        // Better approach: just pile them next to each other with a min width or estimated width.
                        // We will use a safe estimate: divide total width by num cols
                        const colW = tcs.length > 0 ? w / tcs.length : 50;

                        Array.from(tcs).forEach(tc => {
                            const txBody = tc.getElementsByTagName('a:txBody')[0];
                            if (txBody) {
                                const text = Array.from(txBody.getElementsByTagName('a:t')).map(t => t.textContent).join(' ');
                                if (text && text.trim()) {
                                    svgFragment += createSvgRectAndText(currentX, currentY, colW, rowH, text);
                                }
                            }
                            currentX += colW; 
                        });
                        currentY += rowH;
                    });
                }
            }
        });
        return svgFragment;
    };

    // Loop through slides and reconstruct simplified visual layout as SVG
    for (const slidePath of slidesToProcess) {
      const fileEntry = zip.file(slidePath);
      if (!fileEntry) continue;

      const content = await fileEntry.async('text');
      const xmlDoc = parser.parseFromString(content, 'application/xml');
      
      const slideWidth = 1280;
      const slideHeight = 720;

      // Start processing from the Shape Tree (p:spTree)
      const spTree = xmlDoc.getElementsByTagName('p:spTree')[0];
      let svgContent = '';
      
      if (spTree) {
          svgContent = processNodeList(spTree.children);
      }

      // Wrap in SVG
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${slideWidth}" height="${slideHeight}" style="background-color: white;">
            ${svgContent}
        </svg>
      `;

      // Convert SVG to Canvas to Base64
      const canvas = document.createElement('canvas');
      canvas.width = slideWidth;
      canvas.height = slideHeight;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
          const img = new Image();
          const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          
          await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                  ctx.fillStyle = 'white';
                  ctx.fillRect(0, 0, slideWidth, slideHeight);
                  ctx.drawImage(img, 0, 0);
                  URL.revokeObjectURL(url);
                  resolve();
              };
              img.onerror = reject;
              img.src = url;
          });
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          images.push(dataUrl.split(',')[1]);
      }
    }
    
    return images;

  } catch (error) {
    console.error('PPTX Image Conversion Error:', error);
    throw new Error('Failed to convert PowerPoint slides to images.');
  }
};

// Legacy/Fallback Text Extractions
export const extractTextFromPdf = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += `\n\n## Page ${i}\n\n${pageText}`;
    }
    return fullText;
  } catch (error) {
    console.error('PDF Extraction Error:', error);
    throw new Error('Failed to extract text from PDF.');
  }
};

export const extractTextFromDocx = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const turndownService = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
    return turndownService.turndown(result.value);
  } catch (error) {
    console.error('Docx Extraction Error:', error);
    throw new Error('Failed to extract text from DOCX.');
  }
};

export const extractTextFromPptx = async (file: File): Promise<string> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const slideFiles = Object.keys(zip.files).filter(name => 
            name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
        );
        slideFiles.sort((a, b) => {
            const getNum = (str: string) => { const match = str.match(/slide(\d+)\.xml/); return match ? parseInt(match[1], 10) : 0; };
            return getNum(a) - getNum(b);
        });
        let fullText = '';
        const parser = new DOMParser();
        for (const slidePath of slideFiles) {
            const entry = zip.file(slidePath);
            if(entry) {
                const content = await entry.async('text');
                const xmlDoc = parser.parseFromString(content, 'application/xml');
                const textNodes = xmlDoc.getElementsByTagName('a:t');
                const slideText = Array.from(textNodes).map(node => node.textContent).join(' ');
                if (slideText.trim()) fullText += `\n\n## Slide\n\n${slideText}`;
            }
        }
        return fullText;
    } catch (e) { throw new Error('PPTX Text Extraction failed'); }
};

export const convertFileToMarkdown = async (file: File): Promise<string> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return extractTextFromPdf(file);
  if (name.endsWith('.docx')) return extractTextFromDocx(file);
  if (name.endsWith('.pptx')) return extractTextFromPptx(file);
  throw new Error(`Unsupported file format: ${file.name}`);
};
