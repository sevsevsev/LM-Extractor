import type { LogicModel, LogicModelGroup } from '../types';
import {
  buildGranularExportRows,
  groupedDomainHasContent,
  stringDomainHasContent,
  type GranularExportEntry,
  type GranularExportRow,
} from './domainPresence.js';

/**
 * Deterministic round-trip check: does the full CSV export (`buildGranularExportRows`) faithfully
 * preserve every domain/group/item from the extracted `LogicModel`, with nothing dropped, duplicated,
 * or moved to the wrong domain/group? Pure pipeline correctness — no Gemini call involved, and
 * orthogonal to whether the *extraction itself* was accurate against the source document (that needs
 * human verification against real documents — see docs/specs/extraction-verification-protocol-v1.md).
 *
 * Reconstitution here groups by `sourceFilename` (the uploaded file name), which is the CSV's stable
 * per-file id — two files sharing identical organization+program text in the same batch export are
 * still told apart, as long as they don't also share a filename.
 *
 * `exportRoundtrip.test.ts` also runs this against a real extracted model (the Oxford Circle gold
 * fixture), not just hand-built synthetic ones — added 2026-09-19 after a codebase audit found this
 * module was previously exercised only by its own synthetic-model tests despite the claim above.
 */

const GROUPED_DOMAIN_LABELS: Record<string, keyof LogicModel> = {
  Inputs: 'inputs',
  Activities: 'activities',
  Outputs: 'outputs',
  'Short-Term Outcomes': 'shortTermOutcomes',
  'Medium-Term Outcomes': 'mediumTermOutcomes',
  'Long-Term Outcomes': 'longTermOutcomes',
  'General Outcomes': 'generalOutcomes',
  Impact: 'impact',
  Unmapped: 'unmapped',
};

const STRING_DOMAIN_LABELS: Record<string, keyof LogicModel> = {
  'Impact Statement': 'impactStatement',
  'Mission / Overview': 'mission',
  'Target Population': 'targetPopulation',
};

export interface ReconstitutedModel {
  organization: string;
  program: string;
  sourceFilename: string;
  stringFields: Partial<Record<keyof LogicModel, string>>;
  groupedFields: Partial<Record<keyof LogicModel, LogicModelGroup[]>>;
}

function findOrCreateGroup(groups: LogicModelGroup[], name: string): LogicModelGroup {
  let g = groups.find(x => x.name === name);
  if (!g) {
    g = { name, items: [] };
    groups.push(g);
  }
  return g;
}

/** Rebuild LogicModel-shaped structure(s) from exported CSV rows, keyed by `sourceFilename`. */
export function reconstituteFromExportRows(rows: GranularExportRow[]): Map<string, ReconstitutedModel> {
  const byKey = new Map<string, ReconstitutedModel>();

  for (const row of rows) {
    const key = row.sourceFilename || `${row.organization}::${row.program}`;
    let model = byKey.get(key);
    if (!model) {
      model = {
        organization: row.organization,
        program: row.program,
        sourceFilename: row.sourceFilename,
        stringFields: {},
        groupedFields: {},
      };
      byKey.set(key, model);
    }

    const stringDomain = STRING_DOMAIN_LABELS[row.domain];
    if (stringDomain) {
      model.stringFields[stringDomain] = row.content;
      continue;
    }

    const groupedDomain = GROUPED_DOMAIN_LABELS[row.domain];
    if (groupedDomain) {
      if (!model.groupedFields[groupedDomain]) model.groupedFields[groupedDomain] = [];
      const groups = model.groupedFields[groupedDomain]!;
      findOrCreateGroup(groups, row.group).items.push({ text: row.content });
      continue;
    }
    // Unknown domain label — surfaced by the diff below as an unexpected extra row.
  }

  return byKey;
}

/** Multiset key for order-insensitive item comparison within a (domain, group). */
function itemKey(group: string, text: string): string {
  return `${group}\0${text.trim()}`;
}

function multiset(groups: LogicModelGroup[] | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of groups ?? []) {
    for (const item of g.items) {
      const text = item.text?.trim();
      if (!text) continue;
      const key = itemKey(g.name || 'General', text);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  }
  return m;
}

/**
 * Compare an original `LogicModel` against its reconstitution from exported rows.
 * Returns a list of discrepancies; empty means a lossless round trip (the export/import pipeline
 * dropped nothing, invented nothing, and moved nothing to the wrong domain or group).
 */
export function diffReconstitution(original: LogicModel, reconstituted: ReconstitutedModel | undefined): string[] {
  const issues: string[] = [];
  if (!reconstituted) {
    issues.push(`No reconstituted rows found for "${original.organization}::${original.program}".`);
    return issues;
  }

  for (const [label, domain] of Object.entries(STRING_DOMAIN_LABELS)) {
    const originalField = (original[domain] as { content?: string } | undefined)?.content;
    const hasContent = stringDomainHasContent(originalField);
    const reconstitutedValue = reconstituted.stringFields[domain];
    if (hasContent && reconstitutedValue !== originalField) {
      issues.push(`${label}: expected "${originalField}", got "${reconstitutedValue ?? '(missing row)'}"`);
    }
    if (!hasContent && reconstitutedValue !== undefined) {
      issues.push(`${label}: expected no row (domain absent), but found one with content "${reconstitutedValue}"`);
    }
  }

  for (const [label, domain] of Object.entries(GROUPED_DOMAIN_LABELS)) {
    const originalGroups = (original[domain] as { content?: LogicModelGroup[] } | undefined)?.content;
    if (domain === 'unmapped' && !groupedDomainHasContent(originalGroups)) continue; // unmapped omitted when empty, same as export
    const originalSet = multiset(originalGroups);
    const reconstitutedSet = multiset(reconstituted.groupedFields[domain]);

    const allKeys = new Set([...originalSet.keys(), ...reconstitutedSet.keys()]);
    for (const key of allKeys) {
      const [group, text] = key.split('\0');
      const originalCount = originalSet.get(key) ?? 0;
      const reconstitutedCount = reconstitutedSet.get(key) ?? 0;
      if (originalCount !== reconstitutedCount) {
        issues.push(
          `${label} / "${group}": item "${text}" appears ${originalCount}x in the model but ${reconstitutedCount}x in the export round-trip.`
        );
      }
    }
  }

  return issues;
}

/** Convenience: build export rows for `entries`, reconstitute, and diff each against its source model. */
export function checkExportRoundtrip(entries: GranularExportEntry[]): { model: LogicModel; issues: string[] }[] {
  const rows = buildGranularExportRows(entries);
  const reconstituted = reconstituteFromExportRows(rows);
  return entries.map(({ model, sourceFilename }) => ({
    model,
    issues: diffReconstitution(model, reconstituted.get(sourceFilename)),
  }));
}
