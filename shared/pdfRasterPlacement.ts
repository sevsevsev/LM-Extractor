/**
 * Recovering where a PDF painted its raster images, and how large it painted them.
 *
 * Extracted from `services/fileService.ts` so it can be tested at all. That file is 1600 lines of
 * browser-only conversion code with no test file, and it is the layer behind the renderer bug
 * (#8) and both PowerPoint failures (#10, #17). The arithmetic here is pure, so there was never a
 * reason for it to live somewhere a Node test cannot reach.
 *
 * The pdfjs operator codes are passed in rather than imported, so this module pulls in no browser
 * dependency and a test can name its own op numbers.
 */

/** The four operator codes this replay cares about, supplied by the caller from `pdfjsLib.OPS`. */
export interface PdfPaintOps {
  save: number;
  restore: number;
  transform: number;
  /** Every op that paints an embedded raster — see IMAGE_PAINT_OPS in services/fileService.ts. */
  imagePaint: Set<number>;
}

/** [a, b, c, d, e, f] — PDF content-stream matrix, row-vector convention. */
export type PdfMatrix = [number, number, number, number, number, number];
export const IDENTITY_MATRIX: PdfMatrix = [1, 0, 0, 1, 0, 0];

/** `m1` applied first, then `m2` (matches how a PDF `cm` operator prepends into the CTM). */
export function multiplyPdfMatrix(m1: PdfMatrix, m2: PdfMatrix): PdfMatrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

export interface RasterPlacement {
  id: string;
  /** Rendered size of the image's unit square under the CTM at paint time, in PDF points. */
  widthPt: number;
  heightPt: number;
}

/**
 * Replay `save`/`restore`/`transform` alongside each image paint op to recover the CTM in effect
 * at paint time, then derive the on-page rendered size (in points) of that image's unit square —
 * this is what lets `analyzePdfPage` compare a raster's native pixel count against how large it's
 * actually displayed, instead of assuming a fixed absolute pixel floor regardless of placement.
 */
export function trackImagePlacements(
  opList: { fnArray: number[]; argsArray: unknown[][] },
  ops: PdfPaintOps
): RasterPlacement[] {
  const placements: RasterPlacement[] = [];
  const stack: PdfMatrix[] = [IDENTITY_MATRIX];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === ops.save) {
      stack.push(stack[stack.length - 1]);
    } else if (fn === ops.restore) {
      if (stack.length > 1) stack.pop();
    } else if (fn === ops.transform) {
      const args = opList.argsArray[i] as number[];
      if (args?.length === 6) {
        const cm = args as PdfMatrix;
        stack[stack.length - 1] = multiplyPdfMatrix(cm, stack[stack.length - 1]);
      }
    } else if (ops.imagePaint.has(fn)) {
      const objId = opList.argsArray[i]?.[0];
      if (typeof objId === 'string') {
        const ctm = stack[stack.length - 1];
        placements.push({
          id: objId,
          widthPt: Math.hypot(ctm[0], ctm[1]),
          heightPt: Math.hypot(ctm[2], ctm[3]),
        });
      }
    }
  }
  return placements;
}
