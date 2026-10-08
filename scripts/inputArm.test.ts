import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyInputArm, inputArmFromArgs } from './inputArm.ts';

test('the default arm sends the bundle exactly as captured', () => {
  const bundle = { images: ['a'], imageRefs: [{ page: 1 }], textTrack: 'x' };
  assert.equal(inputArmFromArgs([]), 'both');
  assert.equal(applyInputArm(bundle, 'both'), bundle);
});

test('text-only drops images and their refs without touching the captured bundle', () => {
  const bundle = { images: ['a'], imageRefs: [{ page: 1 }], textTrack: 'x', sourceFormat: 'pptx' };
  const sent = applyInputArm(bundle, 'text-only');
  assert.deepEqual(sent, { textTrack: 'x', sourceFormat: 'pptx', images: [] });
  assert.deepEqual(bundle.images, ['a']);
});

test('text-only refuses a bundle with no text, and an unknown arm refuses to run', () => {
  assert.throws(() => applyInputArm({ images: ['a'], textTrack: '  ' }, 'text-only'), /no text track/);
  assert.throws(() => inputArmFromArgs(['--input=images-only']), /--input=images-only/);
});
