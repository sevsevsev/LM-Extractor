import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { LogicModel, LogicModelGroup, ProcessingFile } from '../types';
import { buildCodingExportCsv, buildCodingExportRows } from '../services/codingExport.js';
import {
  EXTRACTION_LOG_HEADERS,
  buildExtractionLogCsv,
  buildExtractionLogRows,
} from '../services/extractionLogExport.js';
import { buildGranularExportRows, type GranularExportEntry } from './domainPresence.js';
import { FULL_EXPORT_HEADERS, fullExportRowValues } from './exportColumns.js';
import { checkExportRoundtrip } from './exportRoundtrip.js';
import { csvBlob } from './csvDownload.js';
import { countExtractionItems } from './extractionFidelity.js';

/**
 * The three exports, run over the 17 blessed regression extractions rather than over hand-built
 * models.
 *
 * Everything else that tests this side of the app builds its own small model, which means every
 * assertion is about a shape someone thought of. These snapshots are the shapes the app actually
 * produces from real documents: 712 items, alternate outcome taxonomies, items only in Unmapped,
 * groups sharing a name across columns, one document with 124 items and another with 6. They are
 * committed, so this needs no Gemini call and no bundle.
 *
 * It is deliberately about CONSERVATION, not wording: every item that is on the board leaves in the
 * export it belongs to, with its column, its group and its page, exactly once. Whether the
 * extraction was right in the first place is a different question, measured by
 * `npm run regression:check` and the accuracy benchmark.
 *
 * The snapshots hold real client wording, so nothing from them is reproduced in an assertion
 * message: a failure names the document id and the count, and the file is there to be read.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(__dirname, '..', 'fixtures', 'regression-set', 'snapshots');

const OVERVIEW_DOMAINS = new Set(['Impact Statement', 'Mission / Overview', 'Target Population']);
/** Every domain that holds items, in board order, Unmapped last. */
const ITEM_DOMAINS: (keyof LogicModel)[] = [
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
  'unmapped',
];
const CODING_DOMAINS: (keyof LogicModel)[] = [
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
];

interface Blessed {
  id: string;
  model: LogicModel;
  promptVersion?: string;
}

function loadBlessed(): Blessed[] {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  return fs
    .readdirSync(SNAPSHOT_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => {
      const snap = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8')) as {
        model?: LogicModel;
        promptVersion?: string;
      };
      const model = snap.model ?? (snap as unknown as LogicModel);
      return { id: f.replace(/\.json$/, ''), model, promptVersion: snap.promptVersion };
    });
}

function entry(b: Blessed): GranularExportEntry {
  return { model: b.model, sourceFilename: `${b.id}.pdf`, fileId: b.id };
}

function fakeFile(b: Blessed): ProcessingFile {
  return {
    id: b.id,
    file: { name: `${b.id}.pdf` } as File,
    status: 'completed',
    result: b.model,
    promptVersion: b.promptVersion,
    modelId: 'gemini-flash-latest',
  } as ProcessingFile;
}

function countItems(model: LogicModel, domains: (keyof LogicModel)[]): number {
  let n = 0;
  for (const domain of domains) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    for (const group of field?.content ?? []) {
      for (const item of group.items ?? []) {
        if (item.text?.trim()) n += 1;
      }
    }
  }
  return n;
}

/** Every recorded `sourcePage`, as the CSV writes them, in board order. */
function itemSourcePages(model: LogicModel): string[] {
  const pages: string[] = [];
  for (const domain of ITEM_DOMAINS) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    for (const group of field?.content ?? []) {
      for (const item of group.items ?? []) {
        if (!item.text?.trim()) continue;
        if (typeof item.sourcePage === 'number') pages.push(String(item.sourcePage));
      }
    }
  }
  return pages;
}

const BLESSED = loadBlessed();

test('the blessed regression snapshots are present to test the exports against', () => {
  // A silent zero here would make every test below pass while checking nothing.
  assert.ok(BLESSED.length >= 17, `expected at least 17 blessed snapshots, found ${BLESSED.length}`);
});

for (const b of BLESSED) {
  test(`full CSV export preserves every item of ${b.id}`, () => {
    const [{ issues }] = checkExportRoundtrip([entry(b)]);
    assert.deepEqual(issues, [], `${b.id}: ${issues.length} round-trip discrepancy/discrepancies`);

    const rows = buildGranularExportRows([entry(b)]);
    const itemRows = rows.filter(r => !OVERVIEW_DOMAINS.has(r.domain));
    assert.equal(
      itemRows.length,
      countExtractionItems(b.model).total,
      `${b.id}: one row per item, Unmapped included`
    );
    assert.equal(new Set(rows.map(r => r.rowId)).size, rows.length, `${b.id}: row ids are unique`);
    assert.ok(
      rows.every(r => r.content.trim() && r.domain.trim() && r.group.trim()),
      `${b.id}: no row leaves without its text, column and group`
    );
    assert.ok(
      rows.every(r => fullExportRowValues(r).length === FULL_EXPORT_HEADERS.length),
      `${b.id}: every row is as wide as the header`
    );
  });

  test(`the board's source page reference survives the full CSV for ${b.id}`, () => {
    const rows = buildGranularExportRows([entry(b)]).filter(r => !OVERVIEW_DOMAINS.has(r.domain));
    // Not every extraction records a page for every item (one document in the set records none at
    // all), so this asserts the column carries what the model holds, not that the model holds it.
    const pagesOnModel = itemSourcePages(b.model);
    const pagesInCsv = rows.map(r => r.sourcePage).filter(Boolean);
    assert.deepEqual(
      pagesInCsv.slice().sort(),
      pagesOnModel.slice().sort(),
      `${b.id}: every page reference the board shows is in the CSV, and none is invented`
    );
    assert.ok(
      rows.every(r => r.sourcePage === '' || /^[1-9][0-9]*$/.test(r.sourcePage)),
      `${b.id}: an exported page is a 1-based number or blank`
    );
  });

  test(`coding CSV carries every outcome item of ${b.id} exactly once`, () => {
    const rows = buildCodingExportRows([fakeFile(b)]);
    assert.equal(
      rows.length,
      countItems(b.model, CODING_DOMAINS),
      `${b.id}: one coding row per short/medium/long/general outcome item`
    );
    assert.equal(new Set(rows.map(r => r[0])).size, rows.length, `${b.id}: coding row ids are unique`);
    assert.ok(rows.every(r => r[3].trim() && r[4].trim() && r[5].trim()), `${b.id}: group, domain and text`);
  });
}

test('the extraction log has one row per file, and carries the prompt version and model id', () => {
  const files = BLESSED.map(fakeFile);
  const rows = buildExtractionLogRows(files);
  assert.equal(rows.length, files.length);
  assert.ok(rows.every(r => r.length === EXTRACTION_LOG_HEADERS.length));

  const col = (name: string) => EXTRACTION_LOG_HEADERS.indexOf(name);
  assert.ok(col('prompt_version') >= 0 && col('model_id') >= 0);
  assert.ok(
    rows.every(r => r[col('prompt_version')]),
    'every blessed snapshot records the prompt that produced it'
  );
  assert.ok(rows.every(r => r[col('model_id')] === 'gemini-flash-latest'));

  // The per-document item count in the log must agree with the number of rows the full CSV writes
  // for that document — the two exports are read side by side, and a disagreement between them is
  // how a dropped item hides.
  const totalCol = col('total_items');
  for (const [i, b] of BLESSED.entries()) {
    const itemRows = buildGranularExportRows([entry(b)]).filter(r => !OVERVIEW_DOMAINS.has(r.domain));
    assert.equal(rows[i][totalCol], String(itemRows.length), `${b.id}: log total matches CSV rows`);
  }
});

test('every CSV download starts with a byte-order mark so Excel reads the wording correctly', async () => {
  // Without it Excel on Windows decodes the file in the machine's legacy code page, and the curly
  // quotes and dashes Gemini transcribes from the document come out as mojibake. 15 of the 17
  // blessed snapshots contain such characters.
  const files = BLESSED.map(fakeFile);
  const log = buildExtractionLogCsv(files);
  const coding = buildCodingExportCsv(files);
  assert.ok(log && coding, 'blessed snapshots produce both CSVs');
  for (const csv of [log!, coding!]) {
    assert.ok(!csv.startsWith('\ufeff'), 'the builders return plain text; csvBlob adds the mark');
    // Read as bytes, not as text: `Blob.text()` is a UTF-8 decode, which strips a leading mark, so
    // it cannot see the thing Excel reads. These three bytes are what Excel reads.
    const bytes = new Uint8Array(await csvBlob(csv).arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(Buffer.from(bytes.slice(3)).toString('utf8'), csv, 'nothing but the mark is added');
  }
});
