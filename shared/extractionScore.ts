/**
 * Score an extraction against a known-correct answer.
 *
 * WHY THIS EXISTS. Every instrument this project had before it measures whether an extraction
 * REPRODUCES — `npm run regression:check` diffs against a blessed snapshot, `npm run census`
 * re-runs the same bundle and compares the runs. None of them can tell a right answer from a
 * wrong one, because a snapshot is whatever the pipeline happened to emit the day it was blessed.
 * The only accuracy measurement ever taken (docs/verification/2026-09-23-accuracy-audit.md) was a
 * person reading 678 items against page images by eye, and it cannot be re-run on every change.
 *
 * So: reproducible-and-wrong is the one failure the existing loop cannot see, and this module is
 * what makes it visible. Given an expected answer written by hand from a document whose content is
 * known, it turns an extraction into four numbers that a later run can be compared against.
 *
 * WHAT IT DOES NOT DO. It does not grade prose, judge whether a grouping is sensible, or ask a
 * model to mark the model's work — `docs/specs/scope-extraction-only-2026-09.md` cut the
 * model-graded critique pass on the principle that code checks the model. Everything here is
 * arithmetic over strings.
 */
import type { LogicModel, LogicModelGroup } from '../types';

/** The grid domains an expected answer can place items in. Prose fields are compared separately. */
export const SCORED_DOMAINS = [
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
  'unmapped',
] as const;

export type ScoredDomain = (typeof SCORED_DOMAINS)[number];

/**
 * The hand-written answer for one document: which items should come out, and in which column.
 *
 * Deliberately a flat list of strings per domain and NOT a `LogicModel`. A golden file that
 * mirrors the output type invites writing down whatever the pipeline produced, which is a
 * snapshot again. Group names are left out entirely because grouping is the axis this project has
 * measured as unstable without items moving (see the census record) and the launch gate Severin
 * set is "same items in same columns" — so scoring group names would fail documents the gate
 * passes.
 */
export interface GoldenAnswer {
  id: string;
  label: string;
  /** What this document is in the benchmark to cover — the failure mode it exercises. */
  covers: string;
  organization?: string;
  program?: string;
  /** Expected item text per domain. A domain the document has nothing for is simply absent. */
  items: Partial<Record<ScoredDomain, string[]>>;
  /**
   * Items that may legitimately appear but are not required — a heading the model could
   * reasonably read as content, a label it may promote to a group name instead of an item.
   * They count neither as a miss when absent nor against precision when present.
   */
  tolerated?: string[];
  /** Expected document-type verdict, when the document is in the set to test that judgement. */
  documentTypeAssessment?: 'logic_model' | 'not_logic_model' | 'unclear';
}

export interface ItemMiss {
  expected: string;
  domain: ScoredDomain;
}

export interface ItemMisplacement {
  expected: string;
  expectedDomain: ScoredDomain;
  actualDomain: ScoredDomain;
  actualText: string;
}

export interface ExtractionScore {
  id: string;
  /** Expected items found somewhere in the extraction, over expected items. 1 = nothing lost. */
  recall: number;
  /** Extracted items matching an expected item, over extracted items. Below 1 = surplus text. */
  precision: number;
  /** Found items sitting in their expected domain, over found items. 1 = nothing moved column. */
  placement: number;
  /**
   * Extracted items whose wording is NOT findable in the source text, over extracted items.
   * The mechanical invention probe, folded in. A hit here is a "look at the page image" cue and
   * not by itself proof of invention — see `scripts/audit-coverage.mjs`, whose normalisation
   * rules this shares and whose hard-won lesson is that the probe is usually narrower than the
   * data. `null` when no source text was supplied.
   */
  unsourced: number | null;
  expectedCount: number;
  actualCount: number;
  misses: ItemMiss[];
  misplacements: ItemMisplacement[];
  /**
   * Extracted GRID items matching nothing expected and not tolerated. Items in `unmapped` are
   * excluded: that domain is the schema's explicit "seen, but not claimed to be grid content",
   * and penalising it would push the extractor toward forcing content into a column, which is the
   * behaviour this benchmark exists to catch. They are counted in `unmappedCount` instead, and a
   * genuine invention there still shows up in `unsourced`.
   */
  surplus: { text: string; domain: ScoredDomain; inSource: boolean }[];
  /** Extracted items parked in `unmapped`, neither rewarded nor penalised. */
  unmappedCount: number;
  /** Set when the golden names an expected document-type verdict and the extraction disagreed. */
  documentTypeMismatch?: { expected: string; actual: string };
}

/**
 * Normalise before comparing. Every clause is one a probe in this repo actually needed: markdown
 * escapes and emphasis (`**150+ students** engaged` vs the plain words), hyphens broken across a
 * line ("socio-\nemotional"), curly quotes, and LibreOffice splitting kerned runs mid-word.
 * Copied deliberately from `scripts/audit-coverage.mjs` rather than imported, because that script
 * is standalone .mjs; the two are kept in step by `extractionScore.test.ts`.
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/(\w)-\s+(\w)/g, '$1-$2')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokens(s: string): string[] {
  return normalizeForMatch(s)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/**
 * Sørensen–Dice over token multisets, which is what "these two strings say the same thing"
 * reduces to once a category label may have been promoted onto the front of an item
 * ("Academic Skills: reading gains" vs "reading gains") or a bullet marker dropped. A pure
 * substring test misses both directions; an exact match misses every one of them.
 */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const t of tb) pool.set(t, (pool.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of ta) {
    const left = pool.get(t) ?? 0;
    if (left > 0) {
      shared++;
      pool.set(t, left - 1);
    }
  }
  return (2 * shared) / (ta.length + tb.length);
}

/**
 * How alike two items must be to count as the same item. 0.6 was chosen against the failure modes
 * already on record rather than by taste, and `extractionScore.test.ts` pins every figure here:
 * a promoted category prefix scores 0.857 on a typical bullet and 0.667 on a terse one, while two
 * different bullets from the same column score 0.571 and 0.308 even sharing its vocabulary.
 *
 * KNOWN LIMITATION, stated rather than hidden: two short items differing in one salient word
 * ("Weekly after-school mentoring sessions" vs "...tutoring sessions") score 0.8 and pair up. So
 * an expected answer must use the document's own wording — which a synthetic benchmark does by
 * construction, since the generator writes both — and a near-miss transcription in a real
 * extraction will read as a match here. This scorer measures what was lost and what moved column;
 * it does not proofread.
 */
export const MATCH_THRESHOLD = 0.6;

interface FlatItem {
  text: string;
  domain: ScoredDomain;
}

export function flattenScoredItems(model: LogicModel): FlatItem[] {
  const out: FlatItem[] = [];
  for (const domain of SCORED_DOMAINS) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    const groups = Array.isArray(field?.content) ? field.content : [];
    for (const group of groups) {
      for (const item of group.items ?? []) {
        if (typeof item?.text === 'string' && item.text.trim()) {
          out.push({ text: item.text, domain });
        }
      }
    }
  }
  return out;
}

/**
 * Pair expected items to extracted items one-to-one, best pair first.
 *
 * Greedy over all pairs sorted by similarity, not per-expected-item first-fit: first-fit lets an
 * early expected item claim an extracted item that is a far better match for a later one, which
 * on a column of near-identical bullets manufactures both a miss and a surplus out of a correct
 * extraction.
 */
function pair(
  expected: FlatItem[],
  actual: FlatItem[]
): { expectedIndex: number; actualIndex: number }[] {
  const candidates: { expectedIndex: number; actualIndex: number; score: number }[] = [];
  for (let i = 0; i < expected.length; i++) {
    for (let j = 0; j < actual.length; j++) {
      const score = similarity(expected[i].text, actual[j].text);
      if (score >= MATCH_THRESHOLD) candidates.push({ expectedIndex: i, actualIndex: j, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.expectedIndex - b.expectedIndex || a.actualIndex - b.actualIndex);
  const usedExpected = new Set<number>();
  const usedActual = new Set<number>();
  const pairs: { expectedIndex: number; actualIndex: number }[] = [];
  for (const c of candidates) {
    if (usedExpected.has(c.expectedIndex) || usedActual.has(c.actualIndex)) continue;
    usedExpected.add(c.expectedIndex);
    usedActual.add(c.actualIndex);
    pairs.push({ expectedIndex: c.expectedIndex, actualIndex: c.actualIndex });
  }
  return pairs;
}

/**
 * Is this wording present in the document's own text?
 *
 * Substring first, on a whitespace-collapsed, markup-stripped copy of both sides, because Track A
 * wraps phrases mid-sentence. Then a token-coverage fallback, because an extractor legitimately
 * JOINS source strings that are not adjacent on the page — a promoted label prefix
 * ("Academic Skills: reading gains"), or a table row rendered as
 * "Premises — Q1 BUDGET: 14,200 | Q1 ACTUAL: 13,880". Both are assembled from the document and
 * neither is an invention, and a substring test calls both invented. That is this repo's oldest
 * recurring mistake — the probe narrower than the data — so the fallback is here by design.
 */
export const SOURCE_TOKEN_COVERAGE = 0.9;

export function appearsInSource(text: string, normalizedSource: string): boolean {
  const needle = normalizeForMatch(text);
  if (!needle) return true;
  if (normalizedSource.includes(needle)) return true;
  // A promoted label prefix is two source strings joined, and the part after the colon is usually
  // verbatim — cheaper and stricter than the token fallback, so try it first.
  const afterColon = needle.slice(needle.indexOf(': ') + 2);
  if (afterColon !== needle && afterColon.length > 8 && normalizedSource.includes(afterColon)) return true;
  const sourceTokens = new Set(tokens(normalizedSource));
  const itemTokens = tokens(needle);
  if (itemTokens.length === 0) return true;
  const present = itemTokens.filter(t => sourceTokens.has(t)).length;
  return present / itemTokens.length >= SOURCE_TOKEN_COVERAGE;
}

export function scoreExtraction(
  golden: GoldenAnswer,
  model: LogicModel,
  options: { sourceText?: string } = {}
): ExtractionScore {
  const expected: FlatItem[] = [];
  for (const domain of SCORED_DOMAINS) {
    for (const text of golden.items[domain] ?? []) expected.push({ text, domain });
  }
  const actual = flattenScoredItems(model);
  const pairs = pair(expected, actual);

  const matchedExpected = new Set(pairs.map(p => p.expectedIndex));
  const matchedActual = new Set(pairs.map(p => p.actualIndex));

  const misses: ItemMiss[] = [];
  for (let i = 0; i < expected.length; i++) {
    if (!matchedExpected.has(i)) misses.push({ expected: expected[i].text, domain: expected[i].domain });
  }

  const misplacements: ItemMisplacement[] = [];
  for (const p of pairs) {
    const e = expected[p.expectedIndex];
    const a = actual[p.actualIndex];
    if (e.domain !== a.domain) {
      misplacements.push({
        expected: e.text,
        expectedDomain: e.domain,
        actualDomain: a.domain,
        actualText: a.text,
      });
    }
  }

  const normalizedSource = options.sourceText ? normalizeForMatch(options.sourceText) : null;
  const tolerated = golden.tolerated ?? [];
  /**
   * A document whose expected answer holds no grid items at all — a budget, an evaluation report,
   * anything that is not a logic model — is in the set for one purpose: to prove the extractor
   * does not manufacture a grid from it. Everything such a document prints is `tolerated`, and
   * tolerance excuses a surplus item wherever it lands, so filling four columns from one of these
   * used to score a clean 100%. That defeated the only property the document measures. Here
   * tolerance stops at the grid: an item may land in `unmapped` freely, and a grid column not at
   * all.
   */
  const expectsNoGridItems = expected.length === 0;
  const surplus: ExtractionScore['surplus'] = [];
  let unsourcedCount = 0;
  let unmappedCount = 0;
  for (let j = 0; j < actual.length; j++) {
    const a = actual[j];
    if (normalizedSource !== null && !appearsInSource(a.text, normalizedSource)) unsourcedCount++;
    if (a.domain === 'unmapped') unmappedCount++;
    if (matchedActual.has(j)) continue;
    if (a.domain === 'unmapped') continue;
    if (!expectsNoGridItems && tolerated.some(t => similarity(t, a.text) >= MATCH_THRESHOLD)) continue;
    surplus.push({
      text: a.text,
      domain: a.domain,
      inSource: normalizedSource === null ? true : appearsInSource(a.text, normalizedSource),
    });
  }

  const found = pairs.length;
  const score: ExtractionScore = {
    id: golden.id,
    recall: expected.length === 0 ? 1 : found / expected.length,
    // Tolerated items are excluded from the denominator as well as the numerator, so a document
    // whose only surplus is a tolerated heading scores a clean 1 rather than an arbitrary penalty.
    precision:
      actual.length - unmappedCount === 0
        ? 1
        : (actual.length - unmappedCount - surplus.length) / (actual.length - unmappedCount),
    placement: found === 0 ? 1 : (found - misplacements.length) / found,
    unsourced: normalizedSource === null ? null : actual.length === 0 ? 0 : unsourcedCount / actual.length,
    expectedCount: expected.length,
    actualCount: actual.length,
    unmappedCount,
    misses,
    misplacements,
    surplus,
  };

  if (golden.documentTypeAssessment) {
    const actualAssessment = model.documentTypeAssessment ?? 'logic_model';
    if (actualAssessment !== golden.documentTypeAssessment) {
      score.documentTypeMismatch = { expected: golden.documentTypeAssessment, actual: actualAssessment };
    }
  }

  return score;
}

const pct = (n: number): string => `${(n * 100).toFixed(1).padStart(5)}%`;

export function formatScoreRow(score: ExtractionScore, label: string): string {
  return [
    label.slice(0, 34).padEnd(34),
    `recall ${pct(score.recall)}`,
    `precision ${pct(score.precision)}`,
    `placement ${pct(score.placement)}`,
    score.unsourced === null ? 'unsourced     —' : `unsourced ${pct(score.unsourced)}`,
    `${score.actualCount}/${score.expectedCount} items`,
  ].join('  ');
}

export interface BenchmarkTotals {
  documents: number;
  recall: number;
  precision: number;
  placement: number;
  unsourced: number | null;
  expectedCount: number;
  actualCount: number;
}

/**
 * Totals are pooled over items, not averaged over documents: a 6-item document must not weigh the
 * same as a 120-item one, or a single small failure swamps the number.
 */
export function totalScores(scores: ExtractionScore[]): BenchmarkTotals {
  let expectedCount = 0;
  let actualCount = 0;
  let gridCount = 0;
  let found = 0;
  let placed = 0;
  let matchedActual = 0;
  let unsourced = 0;
  let unsourcedDenominator = 0;
  for (const s of scores) {
    expectedCount += s.expectedCount;
    actualCount += s.actualCount;
    gridCount += s.actualCount - s.unmappedCount;
    found += s.expectedCount - s.misses.length;
    placed += s.expectedCount - s.misses.length - s.misplacements.length;
    matchedActual += s.actualCount - s.unmappedCount - s.surplus.length;
    if (s.unsourced !== null) {
      unsourced += s.unsourced * s.actualCount;
      unsourcedDenominator += s.actualCount;
    }
  }
  return {
    documents: scores.length,
    recall: expectedCount === 0 ? 1 : found / expectedCount,
    precision: gridCount === 0 ? 1 : matchedActual / gridCount,
    placement: found === 0 ? 1 : placed / found,
    unsourced: unsourcedDenominator === 0 ? null : unsourced / unsourcedDenominator,
    expectedCount,
    actualCount,
  };
}
