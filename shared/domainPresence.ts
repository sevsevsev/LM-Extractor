import type { LogicModel, LogicModelGroup } from '../types';

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
      });
    };

    const pushField = (domain: string, field: { content: LogicModelGroup[] }) => {
      if (!groupedDomainHasContent(field.content)) return;
      for (const g of field.content) {
        for (const item of g.items) {
          const text = item.text?.trim();
          if (!text) continue;
          const flaggedForReview = item.verbatim === false || Boolean(item.sourceNote?.trim());
          rows.push({
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
    pushField('Impact', m.impact);
    if (m.unmapped) pushField('Unmapped', m.unmapped);
  }

  return rows;
}
