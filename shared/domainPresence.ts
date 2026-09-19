import type { LogicModel, LogicModelGroup } from '../types';
import { qaStatusLabel } from './qaStatus.js';
import { itemNeedsReview } from './provenance.js';
import { documentTypeFlagLabel } from './extractionFidelity.js';

export function stringDomainHasContent(content?: string): boolean {
  return Boolean(content?.trim());
}

export function groupedDomainHasContent(groups?: LogicModelGroup[]): boolean {
  return (groups ?? []).some(g => g.items.some(i => Boolean(i.text?.trim())));
}

export interface GranularExportRow {
  /**
   * Stable per-item key: `<fileId>-<modelField>-<groupIndex>-<itemIndex>` for grouped domains and
   * `<fileId>-<modelField>` for the single-string ones. Deliberately the SAME scheme
   * `services/codingExport.ts` uses, so the granular CSV, the coding CSV and a filled-in
   * verification scorecard all join on one key instead of on free-text item wording (which is
   * itself what a review is checking, and changes between runs). Empty when no `fileId` was
   * supplied by the caller.
   */
  rowId: string;
  organization: string;
  program: string;
  domain: string;
  group: string;
  content: string;
  needsReview: string;
  sourceNote: string;
  fillColor: string;
  borderColor: string;
  colorLegend: string;
  sourceHeader: string;
  mappedBy: string;
  mappingConfidence: string;
  mappingNote: string;
  extractionStatus: string;
  extractionConfidence: string;
  extractionBlockers: string;
  mappingCorrectionsJson: string;
  /** Uploaded file name (e.g. "1234_5678_program-name.pdf") — the caller's own ID, not derived from content. */
  sourceFilename: string;
  /**
   * Document-level QA signal — "Needs Review" or "Successfully Processed", from the same check
   * that drives the session list's NEEDS REVIEW grouping (see shared/qaStatus.ts). Distinct from
   * the per-item `needsReview` field above.
   */
  qaStatus: string;
  /**
   * '' | "Possibly Not a Logic Model" | "Unclear Document Type" — from Gemini's document-type
   * self-report (see shared/extractionFidelity.ts). Also already folds into `qaStatus` above via
   * the fidelity banner, but broken out here so QA can filter for this specific reason.
   */
  documentTypeFlag: string;
}

export interface GranularExportEntry {
  model: LogicModel;
  sourceFilename: string;
  /** `ProcessingFile.id` — supplies the `rowId` prefix. Omit only in tests that don't need a key. */
  fileId?: string;
}

/** Build full CSV rows — omit domains with no content (presence-first export). */
export function buildGranularExportRows(entries: GranularExportEntry[]): GranularExportRow[] {
  const rows: GranularExportRow[] = [];

  for (const { model: m, sourceFilename, fileId } of entries) {
    const colorLegend = m.colorLegend?.trim() || '';
    const extractionStatus = m.extractionStatus || '';
    const extractionConfidence = m.extractionConfidence || '';
    const extractionBlockers = (m.extractionBlockers || []).filter(Boolean).join(' | ');
    const mappingCorrectionsJson = m.mappingCorrections?.length
      ? JSON.stringify(m.mappingCorrections)
      : '';
    const qaStatus = qaStatusLabel(m);
    const documentTypeFlag = documentTypeFlagLabel(m);

    const rowIdFor = (modelField: string, gi?: number, ii?: number): string => {
      if (!fileId) return '';
      return gi === undefined ? `${fileId}-${modelField}` : `${fileId}-${modelField}-${gi}-${ii}`;
    };

    const pushStringField = (domain: string, modelField: string, field: { content: string }) => {
      if (!stringDomainHasContent(field.content)) return;
      rows.push({
        rowId: rowIdFor(modelField),
        organization: m.organization,
        program: m.program,
        domain,
        group: 'General',
        content: field.content,
        needsReview: '',
        sourceNote: '',
        fillColor: '',
        borderColor: '',
        colorLegend,
        sourceHeader: '',
        mappedBy: '',
        mappingConfidence: '',
        mappingNote: '',
        extractionStatus,
        extractionConfidence,
        extractionBlockers,
        mappingCorrectionsJson,
        sourceFilename,
        qaStatus,
        documentTypeFlag,
      });
    };

    const pushField = (domain: string, modelField: string, field: { content: LogicModelGroup[] }) => {
      if (!groupedDomainHasContent(field.content)) return;
      field.content.forEach((g, gi) => {
        g.items.forEach((item, ii) => {
          const text = item.text?.trim();
          if (!text) return;
          const flaggedForReview = itemNeedsReview(item);
          rows.push({
            rowId: rowIdFor(modelField, gi, ii),
            organization: m.organization,
            program: m.program,
            domain,
            group: g.name,
            content: text,
            needsReview: flaggedForReview ? 'Yes' : '',
            sourceNote: item.sourceNote?.trim() || '',
            fillColor: item.fillColor?.trim() || '',
            borderColor: item.borderColor?.trim() || '',
            colorLegend,
            sourceHeader: item.sourceHeader?.trim() || g.name || '',
            mappedBy: item.mappedBy || '',
            mappingConfidence: item.mappingConfidence || '',
            mappingNote: item.mappingNote?.trim() || '',
            extractionStatus,
            extractionConfidence,
            extractionBlockers,
            mappingCorrectionsJson,
            sourceFilename,
            qaStatus,
            documentTypeFlag,
          });
        });
      });
    };

    if (m.impactStatement?.content?.trim()) {
      pushStringField('Impact Statement', 'impactStatement', m.impactStatement);
    }
    pushStringField('Mission / Overview', 'mission', m.mission);
    pushStringField('Target Population', 'targetPopulation', m.targetPopulation);
    pushField('Inputs', 'inputs', m.inputs);
    pushField('Activities', 'activities', m.activities);
    pushField('Outputs', 'outputs', m.outputs);
    pushField('Short-Term Outcomes', 'shortTermOutcomes', m.shortTermOutcomes);
    pushField('Medium-Term Outcomes', 'mediumTermOutcomes', m.mediumTermOutcomes);
    pushField('Long-Term Outcomes', 'longTermOutcomes', m.longTermOutcomes);
    if (m.generalOutcomes) pushField('General Outcomes', 'generalOutcomes', m.generalOutcomes);
    pushField('Impact', 'impact', m.impact);
    if (m.unmapped) pushField('Unmapped', 'unmapped', m.unmapped);
  }

  return rows;
}
