import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_MATRIX,
  multiplyPdfMatrix,
  trackImagePlacements,
  type PdfMatrix,
  type PdfPaintOps,
} from './pdfRasterPlacement.ts';

const OPS: PdfPaintOps = { save: 1, restore: 2, transform: 3, imagePaint: new Set([90, 91]) };

function opList(entries: [number, unknown[]][]) {
  return { fnArray: entries.map(e => e[0]), argsArray: entries.map(e => e[1]) };
}

test('multiplying by the identity changes nothing', () => {
  const m: PdfMatrix = [2, 0, 0, 3, 10, 20];
  assert.deepEqual(multiplyPdfMatrix(m, IDENTITY_MATRIX), m);
  assert.deepEqual(multiplyPdfMatrix(IDENTITY_MATRIX, m), m);
});

test('matrices compose first-applied-first, the way a cm operator prepends', () => {
  const scale: PdfMatrix = [2, 0, 0, 2, 0, 0];
  const translate: PdfMatrix = [1, 0, 0, 1, 5, 7];
  // Scale then translate: the translation is NOT scaled.
  assert.deepEqual(multiplyPdfMatrix(scale, translate), [2, 0, 0, 2, 5, 7]);
  // Translate then scale: it is.
  assert.deepEqual(multiplyPdfMatrix(translate, scale), [2, 0, 0, 2, 10, 14]);
});

test('an image painted under a scale reports that scale as its rendered size', () => {
  const placements = trackImagePlacements(
    opList([
      [OPS.transform, [200, 0, 0, 150, 0, 0]],
      [90, ['img_a']],
    ]),
    OPS
  );
  assert.deepEqual(placements, [{ id: 'img_a', widthPt: 200, heightPt: 150 }]);
});

test('restore undoes a transform made since the matching save', () => {
  // This is the whole reason the stack exists: without it the second image would inherit the
  // first one's scale and be reported four times too large.
  const placements = trackImagePlacements(
    opList([
      [OPS.save, []],
      [OPS.transform, [400, 0, 0, 400, 0, 0]],
      [90, ['big']],
      [OPS.restore, []],
      [OPS.transform, [100, 0, 0, 100, 0, 0]],
      [91, ['small']],
    ]),
    OPS
  );
  assert.deepEqual(placements, [
    { id: 'big', widthPt: 400, heightPt: 400 },
    { id: 'small', widthPt: 100, heightPt: 100 },
  ]);
});

test('nested transforms compound', () => {
  const placements = trackImagePlacements(
    opList([
      [OPS.transform, [2, 0, 0, 2, 0, 0]],
      [OPS.transform, [50, 0, 0, 50, 0, 0]],
      [90, ['nested']],
    ]),
    OPS
  );
  assert.deepEqual(placements, [{ id: 'nested', widthPt: 100, heightPt: 100 }]);
});

test('a rotated placement reports its true rendered size, not its matrix terms', () => {
  // A 90° rotation puts the scale in b and c, where reading a and d alone would report zero.
  const placements = trackImagePlacements(
    opList([
      [OPS.transform, [0, 120, -80, 0, 0, 0]],
      [90, ['rotated']],
    ]),
    OPS
  );
  assert.equal(placements[0].widthPt, 120);
  assert.equal(placements[0].heightPt, 80);
});

test('an unbalanced restore cannot empty the stack', () => {
  const placements = trackImagePlacements(
    opList([[OPS.restore, []], [OPS.restore, []], [OPS.transform, [10, 0, 0, 10, 0, 0]], [90, ['x']]]),
    OPS
  );
  assert.deepEqual(placements, [{ id: 'x', widthPt: 10, heightPt: 10 }]);
});

test('non-image ops, malformed transforms and non-string ids are ignored', () => {
  const placements = trackImagePlacements(
    opList([
      [OPS.transform, [1, 2, 3]],
      [42, ['not an image op']],
      [90, [{ notAString: true }]],
      [90, ['kept']],
    ]),
    OPS
  );
  assert.deepEqual(placements, [{ id: 'kept', widthPt: 1, heightPt: 1 }]);
});

test('a page that paints nothing yields no placements', () => {
  assert.deepEqual(trackImagePlacements(opList([[OPS.save, []], [OPS.restore, []]]), OPS), []);
});
