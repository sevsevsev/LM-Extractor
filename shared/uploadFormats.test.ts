import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SUPPORTED_UPLOAD_EXTENSIONS,
  UPLOAD_ACCEPT_ATTRIBUTE,
  isImageFileName,
  isSupportedUploadName,
  sourceFormatFromFileName,
} from './uploadFormats.ts';

test('accepts every format the partner corpus actually contains', () => {
  // The Drive corpus holds PDF, DOCX, PPTX, XLSX and PNG logic models. PNG and XLSX were rejected
  // outright before 2026-09-19 — 8 of ~95 files could not be ingested at all.
  for (const name of [
    '7_30 - Healthy NewsWorks - Logic Model.pdf',
    '174_#NA - X Educators - Logic Model.docx',
    '22_48 - FirstHand - Logic Model.pptx',
    '176_226 - Philadelphia Zoo - Animal Academy - Logic Model.xlsx',
    '56_474 - Art Thru Youth - Logic Model.png',
    'scan.JPG',
    'scan.jpeg',
  ]) {
    assert.equal(isSupportedUploadName(name), true, name);
  }
});

test('rejects formats the pipeline cannot convert', () => {
  for (const name of ['notes.txt', 'model.doc', 'sheet.csv', 'archive.zip', 'model.pdf.exe', 'noext']) {
    assert.equal(isSupportedUploadName(name), false, name);
  }
});

test('extension matching is case- and whitespace-insensitive', () => {
  assert.equal(isSupportedUploadName('  Model.PDF  '), true);
  assert.equal(isSupportedUploadName('MODEL.XLSX'), true);
  assert.equal(isImageFileName('Photo.PNG'), true);
  assert.equal(isImageFileName('report.pdf'), false);
});

test('sourceFormatFromFileName maps each extension to its prompt-variant-determining format', () => {
  // image -> one raster, no text track -> vision-only. xlsx -> Markdown tables, no raster -> text-only.
  assert.equal(sourceFormatFromFileName('a.pdf'), 'pdf');
  assert.equal(sourceFormatFromFileName('a.docx'), 'docx');
  assert.equal(sourceFormatFromFileName('a.pptx'), 'pptx');
  assert.equal(sourceFormatFromFileName('a.xlsx'), 'xlsx');
  assert.equal(sourceFormatFromFileName('a.png'), 'image');
  assert.equal(sourceFormatFromFileName('a.JPEG'), 'image');
});

test('a split part display name still resolves to its real format', () => {
  // displayFileName appends " — Part 2 of 7"; resolution must key on the underlying file name.
  assert.equal(sourceFormatFromFileName('deck.pptx'), 'pptx');
  assert.equal(sourceFormatFromFileName('deck.pptx — Part 2 of 7'), 'pdf', 'falls back, as documented');
});

test('the accept attribute lists every supported extension', () => {
  for (const ext of SUPPORTED_UPLOAD_EXTENSIONS) {
    assert.ok(UPLOAD_ACCEPT_ATTRIBUTE.includes(ext), `accept is missing ${ext}`);
  }
  assert.ok(UPLOAD_ACCEPT_ATTRIBUTE.includes('image/png'));
  assert.ok(UPLOAD_ACCEPT_ATTRIBUTE.includes('spreadsheetml.sheet'));
});
