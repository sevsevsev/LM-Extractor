import type { LogicModel, LogicModelGroup, ProcessingFile } from '../types';
import { qaStatusLabel } from '../shared/qaStatus.js';

/** Domains included in Export for coding — see docs/specs/export-for-coding.md */
export const CODING_EXPORT_DOMAINS = [
  'Short-Term Outcomes',
  'Medium-Term Outcomes',
  'Long-Term Outcomes',
  'General Outcomes',
] as const;

type CodingDomain = (typeof CODING_EXPORT_DOMAINS)[number];

const DOMAIN_FIELDS: { domain: CodingDomain; field: keyof LogicModel }[] = [
  { domain: 'Short-Term Outcomes', field: 'shortTermOutcomes' },
  { domain: 'Medium-Term Outcomes', field: 'mediumTermOutcomes' },
  { domain: 'Long-Term Outcomes', field: 'longTermOutcomes' },
  // No time horizon in the source — a coder assigns short/medium/long-term during coding.
  { domain: 'General Outcomes', field: 'generalOutcomes' },
];

export function countCodingExportRows(files: ProcessingFile[]): number {
  return buildCodingExportRows(files).length;
}

export function buildCodingExportRows(files: ProcessingFile[]): string[][] {
  const rows: string[][] = [];

  for (const f of files) {
    if (!(f.status === 'editing' || f.status === 'completed') || !f.result) continue;
    const m = f.result;

    const colorLegend = m.colorLegend?.trim() || '';
    const qaStatus = qaStatusLabel(m);
    for (const { domain, field } of DOMAIN_FIELDS) {
      // generalOutcomes is optional (most files don't set it), unlike the always-present short/
      // medium/long-term fields, so m[field] itself can be undefined here.
      const groups = (m[field] as { content: LogicModelGroup[] } | undefined)?.content || [];
      groups.forEach((g, gi) => {
        g.items.forEach((item, ii) => {
          const text = (item.text || '').trim();
          if (!text) return;
          const rowId = `${f.id}-${field}-${gi}-${ii}`;
          const color = [item.fillColor?.trim(), item.borderColor?.trim() ? `border:${item.borderColor.trim()}` : '']
            .filter(Boolean)
            .join(' ');
          const needsReview = item.verbatim === false || Boolean(item.sourceNote?.trim()) ? 'Yes' : '';
          rows.push([
            rowId,
            m.organization || '',
            m.program || '',
            g.name || 'General',
            domain,
            text,
            color,
            needsReview,
            colorLegend,
            f.file.name,
            qaStatus,
          ]);
        });
      });
    }
  }

  return rows;
}

export function buildCodingExportCsv(files: ProcessingFile[]): string | null {
  const rows = buildCodingExportRows(files);
  if (rows.length === 0) return null;

  const headers = [
    'row_id',
    'organization',
    'program',
    'group',
    'domain',
    'outcome_text',
    'color_coding',
    'needs_review',
    'color_legend',
    'source_filename',
    'qa_status',
  ];
  const escape = (c: string) => `"${String(c).replace(/"/g, '""')}"`;
  return [headers.map(escape).join(','), ...rows.map(row => row.map(escape).join(','))].join('\n');
}

export function downloadCodingExportCsv(files: ProcessingFile[]): { ok: true } | { ok: false; reason: string } {
  const csv = buildCodingExportCsv(files);
  if (!csv) {
    return { ok: false, reason: 'No short-, medium-, or long-term outcome rows to export for coding.' };
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `logic-models-for-coding_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  return { ok: true };
}
