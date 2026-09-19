import type { LogicModel, LogicModelGroup } from '../types';
import { qaStatusLabel } from './qaStatus.js';
import { documentTypeFlagLabel } from './extractionFidelity.js';
import { itemNeedsReview } from './provenance.js';

export function stringDomainHasContent(content?: string): boolean {
  return Boolean(content?.trim());
}

export function groupedDomainHasContent(groups?: LogicModelGroup[]): boolean {
  return (groups ?? []).some(g => g.items.some(i => Boolean(i.text?.trim())));
}

export interface GranularExportRow {
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
}

/** Build full CSV rows — omit domains with no content (presence-first export). */
export function buildGranularExportRows(entries: GranularExportEntry[]): GranularExportRow[] {
  const rows: GranularExportRow[] = [];

  for (const { model: m, sourceFilename } of entries) {
    const colorLegend = m.colorLegend?.trim() || '';
    const extractionStatus = m.extractionStatus || '';
    const extractionConfidence = m.extractionConfidence || '';
    const extractionBlockers = (m.extractionBlockers || []).filter(Boolean).join(' | ');
    const mappingCorrectionsJson = m.mappingCorrections?.length
      ? JSON.stringify(m.mappingCorrections)
      : '';
    const qaStatus = qaStatusLabel(m);
    const documentTypeFlag = documentTypeFlagLabel(m);

    const pushStringField = (domain: string, field: { content: string }) => {
      if (!stringDomainHasContent(field.content)) return;
      rows.push({
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

    const pushField = (domain: string, field: { content: LogicModelGroup[] }) => {
      if (!groupedDomainHasContent(field.content)) return;
      for (const g of field.content) {
        for (const item of g.items) {
          const text = item.text?.trim();
          if (!text) continue;
          rows.push({
            organization: m.organization,
            program: m.program,
            domain,
            group: g.name,
            content: text,
            needsReview: itemNeedsReview(item) ? 'Yes' : '',
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
        }
      }
    };

    if (m.impactStatement?.content?.trim()) {
      pushStringField('Impact Statement', m.impactStatement);
    }
    pushStringField('Mission / Overview', m.mission);
    pushStringField('Target Population', m.targetPopulation);
    pushField('Inputs', m.inputs);
    pushField('Activities', m.activities);
    pushField('Outputs', m.outputs);
    pushField('Short-Term Outcomes', m.shortTermOutcomes);
    pushField('Medium-Term Outcomes', m.mediumTermOutcomes);
    pushField('Long-Term Outcomes', m.longTermOutcomes);
    if (m.generalOutcomes) pushField('General Outcomes', m.generalOutcomes);
    pushField('Impact', m.impact);
    if (m.unmapped) pushField('Unmapped', m.unmapped);
  }

  return rows;
}
