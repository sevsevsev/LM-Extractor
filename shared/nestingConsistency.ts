import type { LogicModel } from '../types';
import { domainFieldLabel, type CanonicalGroupedDomain } from './domainSynonyms.js';

/**
 * Detects output that contradicts the prompt's NESTING rules (GROUPING GATE 7-9, PROMPT_VERSION
 * 2026-09-20.1) — the two violations that are decidable from the extraction alone, with no access
 * to the source document.
 *
 * WHY THIS EXISTS: `LogicModel` is two levels (`Group.name` -> `items[]`); real logic models are
 * not. Before rules 7-9, nothing said how to flatten a deeper source, and friction-log session 6
 * measured the consequence directly — on two runs of the *same* prompt over the *same* bundle,
 * the model produced different encodings of identical content (parent promoted to `Group.name`,
 * parent inlined into each child, parent concatenated with every child into one item, parent
 * emitted as its own sibling item). That churn is what made item counts on nested documents
 * useless as a regression signal.
 *
 * This is analysis only. It is deliberately NOT wired into `reconcileExtractionFidelity`, so the
 * prompt change it accompanies stays the single variable in its batch — adding a blocker here
 * would alter `extractionStatus` and confound the A/B. Wire it in once rules 7-9 have a measured
 * effect worth gating on.
 *
 * Both checks are conservative: they fire only on an exact label boundary, never on a fuzzy or
 * substring resemblance, because a false "your grouping is wrong" is worse than a missed one.
 *
 * MEASURED SCOPE — read before trusting this. Across the six real arms of session 6/7 it fired
 * ZERO times, including on output it was written for: arm B (.2) emitted "Student Publications"
 * as a bare item, but its siblings were also bare ("40+ school newspapers published"), so no child
 * carried the parent as a prefix and `parent_label_as_item` could not see it. Detecting that
 * encoding needs the source document — "is this item the parent of those?" is not decidable from
 * the extraction. So this only catches a MIXED encoding (parent bare, children prefixed), which
 * may be rare. It is honest insurance against a regression in rules 7-9, not a validated detector.
 * RETIRE IF: two further batches pass with zero hits and no mixed encoding is ever observed.
 */

const GROUPED: Array<CanonicalGroupedDomain | 'unmapped'> = [
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

/** Separators GROUPING GATE 8 can produce when it folds a parent label onto its children. */
const JOINERS = [' — ', ': ', ' - ', ' – '];

export type NestingViolationKind =
  /** Rule 9c: an item's text restates the group it already sits in. */
  | 'group_name_repeated_in_item'
  /** Rule 9a: a parent label emitted as a bare item beside children that carry it as a prefix. */
  | 'parent_label_as_item';

export interface NestingViolation {
  kind: NestingViolationKind;
  /** Human-facing domain label, e.g. "Outputs". */
  domain: string;
  group: string;
  /** The offending item text. */
  text: string;
  /** For `parent_label_as_item`, one child that already carries this label. */
  example?: string;
}

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** True when `text` begins with `label` followed by one of the fold separators. */
function startsWithLabel(text: string, label: string): boolean {
  const t = norm(text);
  const l = norm(label);
  if (!l || t === l) return false;
  return JOINERS.some(j => t.startsWith(l + norm(j).trim()) || t.startsWith(l + j.trimEnd()));
}

export function findNestingViolations(model: LogicModel): NestingViolation[] {
  const out: NestingViolation[] = [];
  for (const domain of GROUPED) {
    const field = model[domain] as { content?: { name: string; items: { text: string }[] }[] } | undefined;
    for (const group of field?.content ?? []) {
      const name = group.name?.trim();
      const items = (group.items ?? []).filter(i => i.text?.trim());

      // Rule 9c — "General" is a placeholder, not a source label, so restating it is not a finding.
      if (name && norm(name) !== 'general') {
        for (const item of items) {
          if (startsWithLabel(item.text, name)) {
            out.push({ kind: 'group_name_repeated_in_item', domain: domainFieldLabel(domain), group: name, text: item.text });
          }
        }
      }

      // Rule 9a — a bare item that other items in the same group carry as their prefix.
      for (const candidate of items) {
        const child = items.find(o => o !== candidate && startsWithLabel(o.text, candidate.text));
        if (child) {
          out.push({
            kind: 'parent_label_as_item',
            domain: domainFieldLabel(domain),
            group: name || 'General',
            text: candidate.text,
            example: child.text,
          });
        }
      }
    }
  }
  return out;
}

/** One short line per violation, for a log or a review note. */
export function formatNestingViolations(violations: NestingViolation[]): string[] {
  return violations.map(v =>
    v.kind === 'group_name_repeated_in_item'
      ? `${v.domain}/${v.group}: item repeats its own group name — "${v.text}"`
      : `${v.domain}/${v.group}: "${v.text}" is a parent label emitted as its own item (cf. "${v.example}")`
  );
}
