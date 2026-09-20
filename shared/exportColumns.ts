import type { GranularExportRow } from './domainPresence';

/**
 * The full extract CSV's columns — header text and the row field it reads — as ONE list.
 *
 * WHY THIS FILE EXISTS: this used to be two parallel arrays in `App.tsx`, a `headers` list and a
 * `rows.map(r => [...])` list, with nothing tying them together. Deleting or inserting a column in
 * one and not the other silently shifts every column to its right, and the result is a CSV that
 * looks fine until someone reads "Placed By" out of the Color Legend column weeks later. Two
 * columns were removed on 2026-09-20 and the alignment had to be checked by hand.
 *
 * Pairing them here makes that mistake unrepresentable rather than merely detectable: there is one
 * list, `field` is typed as a key of `GranularExportRow` so a typo will not compile, and
 * `exportColumns.test.ts` asserts the invariants a type cannot (no duplicate headers, no duplicate
 * fields, plain-language header text).
 *
 * These names are for a HUMAN opening the file — this export has no downstream consumer. The
 * coding CSV in `services/codingExport.ts` is the opposite case: its headers are an intake
 * contract with the Qualitative Outcomes Coder and must not be renamed. See
 * `docs/specs/export-for-coding.md`.
 */
export interface FullExportColumn {
  header: string;
  field: keyof GranularExportRow;
}

export const FULL_EXPORT_COLUMNS: readonly FullExportColumn[] = [
  { header: 'Row ID', field: 'rowId' },
  { header: 'Organization', field: 'organization' },
  { header: 'Program', field: 'program' },
  { header: 'Logic Model Column', field: 'domain' },
  { header: 'Group', field: 'group' },
  { header: 'Item Text', field: 'content' },
  { header: 'Fill Color', field: 'fillColor' },
  { header: 'Border Color', field: 'borderColor' },
  { header: 'Color Legend', field: 'colorLegend' },
  { header: 'Sub-heading In Source', field: 'sourceHeader' },
  { header: 'Placed By', field: 'mappedBy' },
  { header: 'Placement Confidence', field: 'mappingConfidence' },
  { header: 'Placement Note', field: 'mappingNote' },
  { header: 'Extraction Status', field: 'extractionStatus' },
  { header: 'Extraction Confidence', field: 'extractionConfidence' },
  { header: 'Review Reasons', field: 'extractionBlockers' },
  { header: 'Placement Changes (JSON)', field: 'mappingCorrectionsJson' },
  { header: 'Source Filename', field: 'sourceFilename' },
  { header: 'QA Status', field: 'qaStatus' },
  { header: 'Document Type Flag', field: 'documentTypeFlag' },
] as const;

/**
 * Fields on `GranularExportRow` that are deliberately NOT exported, and why. Listed so the
 * omission reads as a decision rather than an oversight — `exportColumns.test.ts` asserts that
 * every row field is either exported or named here, so adding a field to the row type without
 * deciding either way fails the build.
 */
export const INTENTIONALLY_UNEXPORTED: Readonly<Partial<Record<keyof GranularExportRow, string>>> = {
  needsReview:
    'Derived from per-item `verbatim`/`sourceNote`, which the prompt stopped requesting in PROMPT_VERSION 2026-09-20.2 (friction-log session 9), so it was blank in every row. Column dropped 2026-09-20; restore this entry and the prompt instruction together if item-level flagging comes back.',
  sourceNote:
    'Same as `needsReview` — no longer requested from the model, so always empty. Kept on the row type so reinstating flagging is a prompt change plus a line here, not a schema rebuild.',
};

export const FULL_EXPORT_HEADERS: readonly string[] = FULL_EXPORT_COLUMNS.map(c => c.header);

/** Values for one CSV row, in header order. */
export function fullExportRowValues(row: GranularExportRow): string[] {
  return FULL_EXPORT_COLUMNS.map(c => row[c.field]);
}
