import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import type { CanonicalGroupedDomain } from './domainSynonyms.js';

/**
 * Splits a run-on cell that holds several statements into one item each.
 *
 * WHY THIS EXISTS. The other half of the 2026-09-22 ask that produced
 * `shared/inlineLabelGroups.ts`. A common house style writes a whole list into one cell —
 * `Programming; school partnerships; field trips` — and the extraction faithfully returns it as
 * one item, so the board and the CSV carry one row where the source states three things. The
 * label half of that ask (promoting `Label:` to the group name) shipped; this half was held back
 * because no single separator works: within one source column the lists are separated by
 * semicolons, by full stops, and by bare commas.
 *
 * WHAT IT SPLITS ON, in strict precedence, decided per item from the item's own text:
 *   1. semicolons, when the cell yields three or more clean parts;
 *   2. sentence boundaries, when the cell yields two or more clean sentences.
 * A cell that satisfies neither is left exactly as the model returned it.
 *
 * WHAT IT WILL NEVER SPLIT ON: bare commas. `increased artistic skills, physical activity levels,
 * and improved goal-setting` is one statement written as a list, and no syntactic test separates
 * it from `demographics, attendance, retention`, which is three. That distinction is semantic, so
 * a comma rule is a coin flip on every cell, and the wrong side of it shreds a sentence into
 * fragments a reviewer has to reassemble by hand. Leaving a coarse cell whole is a cost a reviewer
 * can see and fix; shredding one is a cost they have to notice first.
 *
 * WHY IN CODE AND NOT THE PROMPT. A separator chosen per cell by the model is a fresh decision on
 * every run, and grouping/granularity is the axis this project's reproducibility problem already
 * lives on. This runs after the model returns, on the model's own words, so it adds no call, moves
 * nothing between columns by itself, and invents no text: every part is a substring of what Gemini
 * transcribed.
 *
 * MEASURED over `fixtures/regression-set/snapshots/` (17 blessed documents, 712 items) — see
 * `docs/verification/2026-09-26-run-on-cell-splitting.md` for the item-by-item list. Both hazard
 * classes present in that set are left alone by the guards below: `Part-time Therapist (Joseph J.
 * Peter Institute)` (an initial, and a split inside brackets) and `Avg. Sessions per week` (an
 * abbreviation).
 *
 * RETIRE/REVISE IF a document appears where a split part reads as a fragment rather than a
 * statement, or where a reviewer has to rejoin two rows by hand.
 */

/** The eight grouped columns. `unmapped` is excluded: it is a holding pen, not a column. */
const GROUPED_DOMAINS = [
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
] as const satisfies readonly CanonicalGroupedDomain[];

/**
 * Below this the cell is already one statement's worth of text and nothing is gained by cutting
 * it. Tuned so the shortest genuine run-on in the blessed set (a-new-dawn's three activities, 69
 * characters) still qualifies.
 */
export const MIN_CELL_CHARS = 60;

/**
 * A part longer than this is prose, not a list entry, so the separator was punctuation inside a
 * sentence rather than between statements.
 */
export const MAX_PART_CHARS = 200;

/** A semicolon list needs three parts; see `splitOnSemicolons`. */
export const MIN_SEMICOLON_PARTS = 3;

/** Each semicolon part must carry at least this many words to read as a statement. */
export const MIN_SEMICOLON_PART_WORDS = 2;

/**
 * Each sentence part must carry at least this many words. This is the guard that does the real
 * work on the two false positives in the blessed set: `Avg.` is one word and `Peter Institute)`
 * is two, so neither cell clears it. The abbreviation list below is a second net, not the first.
 */
export const MIN_SENTENCE_PART_WORDS = 4;

/**
 * Tokens that end in a full stop without ending a sentence. A single capital letter (an initial)
 * is handled separately and needs no entry here.
 */
const ABBREVIATIONS = new Set([
  'approx', 'assoc', 'ave', 'avg', 'co', 'coord', 'corp', 'dept', 'div', 'dr', 'e.g', 'est',
  'etc', 'ext', 'fig', 'govt', 'hrs', 'i.e', 'inc', 'intl', 'jr', 'ltd', 'max', 'mgmt', 'mgr',
  'min', 'mos', 'mr', 'mrs', 'ms', 'mt', 'natl', 'no', 'ph', 'prof', 'qtr', 'rd', 'sched', 'sec',
  'sr', 'st', 'univ', 'vs', 'yrs',
]);

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * True when every bracket and quote opened in `s` is also closed in it. A split that leaves a
 * dangling `(` cut a parenthetical in half, which is never what a list separator does.
 */
export function hasBalancedDelimiters(s: string): boolean {
  const pairs: Array<[string, string]> = [['(', ')'], ['[', ']'], ['{', '}']];
  for (const [open, close] of pairs) {
    let depth = 0;
    for (const ch of s) {
      if (ch === open) depth++;
      else if (ch === close) depth--;
      if (depth < 0) return false;
    }
    if (depth !== 0) return false;
  }
  for (const quote of ['"', '“”', "‘’"]) {
    if (quote.length === 1) {
      if ((s.split(quote).length - 1) % 2 !== 0) return false;
    } else {
      const opens = (s.split(quote[0]).length - 1);
      const closes = (s.split(quote[1]).length - 1);
      if (opens !== closes) return false;
    }
  }
  return true;
}

/**
 * True when the full stop ending `before` terminates a sentence rather than an abbreviation or an
 * initial.
 */
export function isSentenceTerminator(before: string): boolean {
  const token = before.trimEnd().replace(/\.$/, '').split(/\s+/).pop() ?? '';
  const bare = token.replace(/[^A-Za-z.]/g, '');
  if (bare.length === 0) return false;
  // "Joseph J." — a single capital letter is an initial, never the end of a sentence.
  if (/^[A-Z]$/.test(bare)) return false;
  if (ABBREVIATIONS.has(bare.toLowerCase())) return false;
  return true;
}

/**
 * Cuts `text` at every full stop that terminates a sentence and is followed by whitespace and a
 * capital letter or an opening bracket. Returns the parts with their terminating stop kept, so no
 * character of the model's text is lost.
 */
export function sentenceParts(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '.') continue;
    const rest = text.slice(i + 1);
    const m = /^\s+[A-Z(“"]/.exec(rest);
    if (!m) continue;
    const before = text.slice(start, i + 1);
    if (!isSentenceTerminator(before)) continue;
    parts.push(before.trim());
    start = i + 1 + m[0].length - 1;
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function splitOnSemicolons(text: string): string[] | null {
  if (!text.includes(';')) return null;
  const parts = text.split(';').map((p) => p.trim()).filter(Boolean);
  // A single semicolon usually joins a clause to its qualifier ("...and leveled; updated
  // annually") rather than separating two entries; three parts is the point at which the cell is
  // unambiguously a list.
  if (parts.length < MIN_SEMICOLON_PARTS) return null;
  for (const part of parts) {
    if (part.length > MAX_PART_CHARS) return null;
    if (wordCount(part) < MIN_SEMICOLON_PART_WORDS) return null;
    if (!hasBalancedDelimiters(part)) return null;
    // A part that is itself several sentences means the semicolons sit inside prose.
    if (sentenceParts(part).length > 1) return null;
  }
  return parts;
}

/**
 * Drops the full stop that used to terminate a sentence but now only trails a list entry, so a
 * split part looks like every other item rather than announcing where it came from. One stop
 * only: `(continuously.)` and an ellipsis keep theirs.
 */
function dropTerminalStop(part: string): string {
  return /[^.]\.$/.test(part) ? part.slice(0, -1) : part;
}

function splitOnSentences(text: string): string[] | null {
  const parts = sentenceParts(text);
  if (parts.length < 2) return null;
  for (const part of parts) {
    if (part.length > MAX_PART_CHARS) return null;
    if (wordCount(part) < MIN_SENTENCE_PART_WORDS) return null;
    if (!hasBalancedDelimiters(part)) return null;
  }
  return parts.map(dropTerminalStop);
}

/**
 * The parts one cell should become, or `null` when it should be left exactly as it is.
 * Pure and exported so the measurement script and the tests can run it over a cell at a time.
 */
export function splitRunOnCell(text: string): string[] | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_CELL_CHARS) return null;
  // A colon means the cell carries its own label. `shared/inlineLabelGroups.ts` owns that shape,
  // and splitting a labelled cell would scatter the label's list across rows that no longer say
  // what they belong to.
  if (trimmed.includes(':')) return null;
  if (!hasBalancedDelimiters(trimmed)) return null;
  return splitOnSemicolons(trimmed) ?? splitOnSentences(trimmed);
}

function splitGroup(group: LogicModelGroup): boolean {
  const next: LogicModelItem[] = [];
  let changed = false;
  for (const item of group.items) {
    const parts = splitRunOnCell(item.text);
    if (!parts) {
      next.push(item);
      continue;
    }
    changed = true;
    // Every part inherits the parent's provenance verbatim: the split happens after the model
    // located the cell, so each part came off the same page by the same mapping.
    for (const part of parts) next.push({ ...item, text: part });
  }
  if (changed) group.items = next;
  return changed;
}

/** Splits run-on cells in place across the eight grouped columns. Returns true if anything split. */
export function splitRunOnItems(model: LogicModel): boolean {
  let changed = false;
  for (const domain of GROUPED_DOMAINS) {
    const content = model[domain]?.content;
    if (!Array.isArray(content)) continue;
    for (const group of content) {
      if (Array.isArray(group.items) && splitGroup(group)) changed = true;
    }
  }
  return changed;
}
