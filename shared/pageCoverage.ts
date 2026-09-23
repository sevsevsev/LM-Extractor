import type { LogicModel, LogicModelGroup } from '../types';
import { synonymToDomain, type CanonicalGroupedDomain } from './domainSynonyms.js';

/**
 * Deterministic page-coverage check: which pages of a document hold a logic model grid whose
 * content did not survive into the extraction.
 *
 * WHY THIS EXISTS. Until now the only missed-content signal in the app was Gemini's own
 * `possiblyMissedRegions` self-report — `hasMissedContentSignal` in extractionFidelity.ts is
 * literally that array being non-empty. A self-report cannot flag what the model never noticed it
 * dropped. Measured case (2026-09-23, a three-slide deck carrying two differently-worded versions
 * of one logic model, on slides 1 and 3): page detection kept it as one document, the extraction
 * took slide 1, every one of its 39 items cited page 1, slide 3 contributed nothing, and the
 * result came back `ok` / `high` with `possiblyMissedRegions` absent. Nothing anywhere told a
 * reviewer a second grid existed.
 *
 * This asks a question the model is not the witness for: for each page of Track A, is that page's
 * text present in what came back? It costs no Gemini call and adds no sampling point, so it cannot
 * move the launch gate (same items in the same columns across runs) — it only adds a warning.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not re-extract the page, split the document, or pick
 * which version of a duplicated model is the right one. Which of two versions of one logic model a
 * partner meant is a human call, and guessing it silently is the same class of mistake as dropping
 * one silently. The page is named; the reviewer decides.
 *
 * It also does not touch `possiblyMissedRegions`. That field is Gemini's own per-image self-report
 * and is documented as such; a client-side text heuristic was removed from it once already (see
 * extractionFidelity.ts). Mixing a code-side measurement back into it would leave nobody able to
 * tell which signal said what. This raises its own blocker instead.
 *
 * PRECISION IS THE WHOLE DESIGN. The heuristic this replaces in spirit — counting candidate lines
 * in Track A against extracted item counts — was removed after going 3 for 3 on false positives,
 * because plenty of page text is never meant to become grid items: covers, colour legends,
 * evaluation-method footers, reference lists. So a page is only examined when it structurally
 * looks like a logic model grid (see `pageHoldsGrid`), and only then compared.
 */

/** `## Page N` / `## Slide N` markers inserted by services/fileService.ts's Track A builders. */
const PAGE_MARKER = /^##\s+(Page|Slide)\s+(\d+)\s*$/i;

/**
 * Character n-grams, not word n-grams, and 12 is measured rather than picked.
 *
 * LibreOffice's PPTX -> PDF text layer splits kerned runs mid-word ("g rowth", "l ifelong"), which
 * shifts every word boundary around it and cost word-trigram recall ~10 points on pages that were
 * extracted perfectly. Stripping whitespace before slicing makes the comparison immune to it. On
 * the 16 grid pages measured, character 12-grams separated the one genuinely dropped page from the
 * worst-scoring intact page by 0.403, against 0.329 for word trigrams.
 */
const GRAM = 12;

/**
 * Below this, a page's own content is not in the extraction.
 *
 * MEASURED on all 21 source documents available on 2026-09-23 (7 PowerPoint decks, 7 PDFs, 3 Word
 * files, 3 images, 1 spreadsheet), which is every page this check can see, plus five repeat runs of
 * the deck that prompted it. Sixteen pages satisfied `pageHoldsGrid`. Fifteen of them scored 0.780
 * to 0.992. The sixteenth — the discarded second grid described at the top of this file — scored
 * 0.009 on the three runs that dropped it outright and 0.520 on the two that pulled a third of it
 * in. There is nothing between 0.520 and 0.780. 0.55 sits in that empty band.
 *
 * An intact page does not score 1.0 and is not expected to: the header row, page furniture and
 * item boundaries are all in Track A and none of them come back as item text. That is why the bar
 * is "this page's own content is missing", not "any of it is".
 */
const MAX_COVERED_RECALL = 0.55;

/**
 * A page shorter than this is not compared at all. Recall over a few hundred characters is too
 * noisy to act on, and a page that thin cannot be holding a grid worth warning about. The smallest
 * page that passed `pageHoldsGrid` in the measurement above was 1,897 characters, so this sits
 * well clear of every real case.
 */
const MIN_PAGE_CHARS = 600;

/**
 * A page needs at least this many n-grams of its own — ones no other page of the document carries
 * — before it is judged. Two pages that are near-copies of each other leave almost nothing to
 * measure, and a verdict drawn from a handful of n-grams would be noise. Skipping says "no
 * opinion", which for a page that really is a duplicate of one already extracted is also the right
 * answer. The smallest own-n-gram count among the 16 measured grid pages was 934, so no real case
 * comes near this.
 */
const MIN_DISTINCT_GRAMS = 200;

/** Keep the operator-facing blocker readable — naming a dozen pages helps nobody. */
const MAX_REPORTED_PAGES = 4;

const STRUCTURE_DOMAINS: readonly CanonicalGroupedDomain[] = ['inputs', 'activities', 'outputs'];
const RESULT_DOMAINS: readonly CanonicalGroupedDomain[] = [
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
];

const GROUPED_DOMAINS: (keyof LogicModel)[] = [
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

/** `LogicModelField<string>` overview fields — read through `.content`. */
const FIELD_STRINGS: (keyof LogicModel)[] = ['mission', 'targetPopulation', 'impactStatement'];

/** Plain-string fields on LogicModel — read directly. */
const PLAIN_STRINGS: (keyof LogicModel)[] = ['organization', 'program', 'colorLegend'];

export interface UncoveredPage {
  page: number;
  /**
   * Share of the page's OWN character n-grams — those no other page of the document carries —
   * found in the extraction, 0-1. See `findUncoveredGridPages` for why the differencing matters.
   */
  recall: number;
}

/** Split a Track A text track into `{ page: text }`. Empty when the track carries no page markers. */
function splitByPage(textTrack: string): Map<number, string> {
  const pages = new Map<number, string>();
  if (!textTrack.trim()) return pages;
  let current: number | null = null;
  for (const line of textTrack.split('\n')) {
    const match = PAGE_MARKER.exec(line.trim());
    if (match) {
      current = parseInt(match[2], 10);
      if (!pages.has(current)) pages.set(current, '');
      continue;
    }
    if (current !== null) pages.set(current, `${pages.get(current) ?? ''}${line}\n`);
  }
  return pages;
}

function charGrams(text: string): Set<string> {
  const flat = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  const grams = new Set<string>();
  for (let i = 0; i + GRAM <= flat.length; i++) grams.add(flat.slice(i, i + GRAM));
  return grams;
}

/** Every piece of source wording the extraction claims to carry — items, group names, overview fields. */
export function collectExtractedText(model: LogicModel): string {
  const parts: string[] = [];
  for (const domain of GROUPED_DOMAINS) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    for (const group of field?.content ?? []) {
      if (group.name) parts.push(group.name);
      for (const item of group.items ?? []) if (item.text) parts.push(item.text);
    }
  }
  for (const domain of FIELD_STRINGS) {
    const value = (model[domain] as { content?: unknown } | undefined)?.content;
    if (typeof value === 'string' && value.trim()) parts.push(value);
  }
  for (const domain of PLAIN_STRINGS) {
    const value = model[domain];
    if (typeof value === 'string' && value.trim()) parts.push(value);
  }
  return parts.join('\n');
}

/**
 * Does this page structurally look like a logic model grid?
 *
 * Not "does it mention a column name" — three distinct canonical domains, at least one of them a
 * structure column (Inputs/Activities/Outputs) and at least one a results column (any outcome
 * horizon, or Impact). A grid has both sides; a cover slide, a colour legend or a narrative page
 * does not. On the measured set this is exactly what keeps the two genuinely-uncited non-grid
 * pages out: a colour legend scoring 0.058 recall matched Inputs and Activities and no results
 * column, and a cover page scoring 0.017 matched nothing at all. Both would otherwise have been
 * false positives, and both were legitimately not extracted.
 *
 * Header vocabulary comes from `synonymToDomain`, the same list source-aware mapping uses, applied
 * over 1-3 word windows because Track A arrives as flat prose with no line structure to read
 * headers off. Growing that list grows this check with it, which is the intent.
 */
function pageHoldsGrid(pageText: string): boolean {
  const words = pageText.split(/\s+/).filter(Boolean);
  const found = new Set<CanonicalGroupedDomain>();
  for (let i = 0; i < words.length; i++) {
    for (let span = 1; span <= 3 && i + span <= words.length; span++) {
      const domain = synonymToDomain(words.slice(i, i + span).join(' '));
      if (domain) found.add(domain);
    }
  }
  if (found.size < 3) return false;
  if (!STRUCTURE_DOMAINS.some(d => found.has(d))) return false;
  return RESULT_DOMAINS.some(d => found.has(d));
}

/**
 * Pages that hold a logic model grid whose wording is largely absent from `model`.
 *
 * Returns [] — meaning "no opinion", never "verified complete" — whenever the comparison cannot be
 * made honestly: no text track, no page markers (Word's Track A has no pagination, and images and
 * spreadsheets have no text track at all, so all three no-op here), or an extraction that brought
 * back nothing to compare against, which `noContent` / `noGridItems` already flag far more loudly.
 */
export function findUncoveredGridPages(model: LogicModel, textTrack: string | undefined): UncoveredPage[] {
  if (!textTrack) return [];
  const pages = splitByPage(textTrack);
  if (pages.size === 0) return [];

  const extracted = charGrams(collectExtractedText(model));
  if (extracted.size === 0) return [];

  const numbers = [...pages.keys()].sort((a, b) => a - b);
  const perPage = new Map(numbers.map(page => [page, charGrams(pages.get(page) ?? '')]));

  const uncovered: UncoveredPage[] = [];
  for (const page of numbers) {
    const text = pages.get(page) ?? '';
    if (text.trim().length < MIN_PAGE_CHARS) continue;
    if (!pageHoldsGrid(text)) continue;

    // Only this page's OWN n-grams count — the ones no other page of the document carries.
    //
    // This is what makes the check work on the document class that prompted it. Two versions of one
    // logic model share most of their wording, so a page that was discarded outright still scores
    // 0.386 against the whole extraction purely on what its twin contributed. Difference the pages
    // first and the same page scores 0.009: its own wording is simply not there. On a document with
    // one grid nothing changes, because a single grid page has no twin to share n-grams with.
    //
    // It also sharpens the partial case, which matters more than it looks. The deck behind this
    // check does not behave the same way twice — over five runs on a byte-identical bundle, three
    // dropped the second grid completely and two took about a third of it. Measured against the
    // whole extraction those two runs score 0.682 and pass unnoticed; measured against the page's
    // own wording they score 0.520 and are flagged, which is the honest answer, since two thirds of
    // that page still never arrived.
    const own = new Set<string>();
    for (const gram of perPage.get(page) ?? []) {
      let seenElsewhere = false;
      for (const other of numbers) {
        if (other === page) continue;
        if (perPage.get(other)?.has(gram)) { seenElsewhere = true; break; }
      }
      if (!seenElsewhere) own.add(gram);
    }
    if (own.size < MIN_DISTINCT_GRAMS) continue;

    let hits = 0;
    for (const gram of own) if (extracted.has(gram)) hits++;
    const recall = hits / own.size;
    if (recall < MAX_COVERED_RECALL) uncovered.push({ page, recall });
  }
  return uncovered.slice(0, MAX_REPORTED_PAGES);
}

/** "page 3" / "pages 3 and 5" / "pages 3, 5 and 6" — for the operator-facing blocker. */
export function formatUncoveredPages(pages: UncoveredPage[]): string {
  const numbers = pages.map(p => String(p.page));
  if (numbers.length === 0) return '';
  if (numbers.length === 1) return `page ${numbers[0]}`;
  return `pages ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}
