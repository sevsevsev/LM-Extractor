/**
 * Deterministic harvest of labeled Impact Statement prose from document text layers.
 * Complements vision extract when page-1 text sits far below an IMPACT STATEMENT header
 * (large empty boxes) and Gemini drops it entirely.
 */

/**
 * Matches "Impact Statement" and a conservative subset of its prompt-recognized synonyms (see
 * `constants.ts`'s CONTEXT & OVERVIEW block) — only phrases containing "impact" itself, since those
 * are unlikely to appear as ordinary mid-sentence phrasing in unrelated body text. Broader synonyms
 * like "Ultimate Goal" / "Overall Goal" / "Goal Statement" are deliberately left prompt-only: Gemini
 * can see whether such a phrase is a styled page heading vs. an incidental mention ("our goal is
 * to..." inside an Activities bullet); this regex, running on flattened raw text with no visual
 * context, cannot make that distinction safely.
 */
const IMPACT_STATEMENT_HEADING = /(?:impact\s+statement|(?:intended|anticipated|long[- ]term)\s+impact)\b/i;


/**
 * The words that end an Impact Statement, because the next section has started.
 *
 * They are ordinary English, so finding one is not enough — it has to be the start of a HEADING.
 * This used to take the first match anywhere in the slice, which truncated any impact statement
 * that happened to use one of these words in a sentence. Measured on two real documents:
 *
 *   Performance Garage  "...expanding their educational pathways and |long-term| career
 *                        opportunities in the arts and beyond."   → cut after "pathways and"
 *   Oxford Circle       "...support and family |resources|."      → cut after "and family"
 *
 * Neither bit in production, because this fallback only runs when Gemini left `impactStatement`
 * empty and Gemini filled both of those — but the fallback exists for exactly the case where
 * Gemini drops the field, so it would have bitten the first time it was actually needed.
 *
 * `findSectionStop` below is the test that tells the two apart. See it for what "heading" means
 * here and what that does not cover.
 */
const SECTION_STOP =
  /\b(mission\s*(statement|\/|overview)?|purpose|program\s+overview|target\s+population|who\s+we\s+serve|resources|inputs|activities|outputs|short[- ]term|medium[- ]term|long[- ]term|##\s*page\s*\d)\b/gi;

/**
 * An impact statement is at most this long. The scan path has always enforced it through
 * `looksLikeImpactStatementProse`; the fast path used to have a floor and no ceiling, so a slice
 * that found no section stop could return the rest of the document. A New Dawn's 591 characters
 * passed under this by luck rather than by test.
 */
const MAX_STATEMENT_CHARS = 600;

/**
 * End of a sentence, followed by the gap before whatever comes next. The closers include Markdown
 * emphasis as well as quotes and brackets, because the DOCX text track is Markdown and a heading
 * there follows `...and beyond.**` rather than `...and beyond.` — without them the last sentence
 * end goes unrecognised and every later stop word reads as prose.
 */
const SENTENCE_BREAK = /^[\s\S]*[.!?]["'“”)\]*_~`]*\s+/;

/**
 * Index of the first section stop that actually starts a heading, or -1.
 *
 * In text flattened out of a PDF layer or a Markdown track, a heading has no styling left, but it
 * does have a position: it comes after the end of the previous sentence, with nothing but heading
 * between. So take the run of text from the last sentence end up to the candidate stop word — if
 * that run contains lower-case prose, the stop word is inside a sentence and is not a heading.
 *
 *   "...in the arts and beyond. BRIEF PROGRAM OVERVIEW/MISSION..."   run "BRIEF " → a heading
 *   "...educational pathways and long-term career opportunities..."  run "...pathways and " → prose
 *
 * The run rather than the stop word itself, because a stop word is routinely the second word of a
 * longer heading — firsthand's slide 1 is the case above, where "program overview" matches four
 * characters in and strands "BRIEF" on the end for `sliceAfterHeading` to trim.
 *
 * NOT COVERED, and left that way for want of a document that shows it: a heading in Title Case
 * rather than caps ("Brief Program Overview"), whose run reads as prose by this test. All fourteen
 * documents measured on 2026-09-23 set their headings in caps.
 */
function findSectionStop(after: string): number {
  SECTION_STOP.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECTION_STOP.exec(after)) !== null) {
    const run = after.slice(0, match.index).replace(SENTENCE_BREAK, '');
    if (!/[a-z]/.test(run)) return match.index;
  }
  return -1;
}

/**
 * General vocabulary common to nonprofit/program impact-statement prose (population served +
 * a future-facing change verb) — not fitted to any one organization's exact wording. Earlier
 * versions of this module matched literal phrases lifted from one historical fixture document
 * ("through sustained participation…fosters artistic growth…"), which meant the fallback did
 * nothing on any other real document. This still won't catch everything, but it generalizes
 * instead of only ever matching the one document it was built from.
 */
const POPULATION_WORDS =
  /\b(communit(?:y|ies)|students?|youths?|famil(?:y|ies)|residents?|participants?|clients?|individuals?|children|child|parents?|volunteers?|seniors?|neighborhoods?|beneficiaries)\b/i;
const CHANGE_WORDS =
  /\b(will|improve[sd]?|increase[sd]?|reduce[sd]?|achieve[sd]?|ensure[sd]?|foster[sd]?|build[s]?|strengthen(?:s|ed)?|transform(?:s|ed)?|experience[sd]?|empower(?:s|ed)?|support(?:s|ed)?)\b/i;

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * A run of bullet markers or bold spans means the slice is grid content — a list of outcomes — and
 * not a single overview paragraph. An impact statement is one sentence or two; nothing in this
 * project's documents writes one as a bulleted list.
 *
 * EVIDENCE (2026-09-23 audit): A New Dawn's DOCX text track reads
 * `... **6\. LONG-TERM IMPACT (3–5 years)** **For Students** - Increased graduation rates ...`.
 * The heading regex matched LONG-TERM IMPACT, the slice ran to the next stop word, and 591
 * characters of bulleted long-term outcomes landed in `impactStatement` — literal asterisks, a
 * heading remainder and a dangling hyphen included — where the user sees it in the board and in
 * the PDF export. It is also a duplicate: those items are already correctly in `longTermOutcomes`.
 *
 * `looksLikeImpactStatementProse` already carried this rule in spirit ("bulleted/numbered lines are
 * grid content") but only tested the FIRST character, and that candidate opens on "(3–5 years)**".
 * Same rule, given the reach it was written to have.
 */
const LIST_MARKERS = /(?:^|\s)(?:[-•*]\s+|\d+[.)]\s+)/g;
/**
 * Two complete bold SPANS, not two asterisk pairs: a statement written as one emphasised sentence
 * is wrapped in a single span and is not a list. Counting the markers instead read that as two and
 * threw the statement away — which passed its test only while the stop-word bug was truncating the
 * closing `**` off the end of the slice before this ever saw it.
 */
const BOLD_SPAN = /\*\*[^*]+\*\*/g;

/**
 * Takes the RAW slice, before markup is stripped: the bold-span signal only exists there. Two
 * markers, not one, because a single " - " is ordinary punctuation in this kind of prose — Oxford
 * Circle's genuine impact statement reads "...stronger support networks - creating a safer, more
 * resilient school community." En and em dashes are left out of the marker class for the same
 * reason; they are punctuation far more often than they are bullets in flattened text.
 */
function readsAsList(raw: string): boolean {
  return (raw.match(LIST_MARKERS) || []).length >= 2 || (raw.match(BOLD_SPAN) || []).length >= 2;
}

/** Does this candidate sentence/paragraph read like impact-statement overview prose? */
export function looksLikeImpactStatementProse(text: string): boolean {
  const t = collapseWs(text);
  if (t.length < 80 || t.length > MAX_STATEMENT_CHARS) return false;
  // Bulleted/numbered lines are grid content (an Inputs/Activities list item), not overview prose.
  if (/^[-•*•]|^\d+[.)]/.test(t)) return false;
  if (readsAsList(t)) return false;
  return POPULATION_WORDS.test(t) && CHANGE_WORDS.test(t);
}

/**
 * The text track is Markdown on the DOCX path, so a slice can carry escapes and bold runs into a
 * field the user reads. Strip them rather than shipping `**6\.` to the export. Same clause set as
 * `scripts/audit-coverage.mjs`'s comparison normaliser, for the same reason.
 */
function stripInlineMarkup(s: string): string {
  return s
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The raw slice between the heading and the next section stop, markup and all. */
function sliceAfterHeading(normalized: string, headingIndex: number, headingLen: number): string {
  let after = normalized.slice(headingIndex + headingLen).replace(/^[:\-–—\s]+/, '');
  const stop = findSectionStop(after);
  if (stop >= 0) {
    after = after.slice(0, stop);
    // A stop word inside a LONGER heading strands that heading's first word on the end: firsthand's
    // "BRIEF PROGRAM OVERVIEW/MISSION" stops at "PROGRAM OVERVIEW" and leaves "... opportunities.
    // BRIEF". Drop one trailing token that follows the final sentence end. Only on this branch —
    // an untruncated slice has nothing stranded, and a genuine one-word closing sentence should
    // survive.
    after = after.replace(/([.!?]["'“”)]*)\s+\S+\s*$/, '$1');
  }
  return collapseWs(after).replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

/**
 * Find labeled Impact Statement body in plain text (PDF text layer, markdown, etc.).
 * Returns null when no heading or usable prose is found.
 */
export function harvestImpactStatementFromPlainText(text: string): string | null {
  if (!text?.trim()) return null;

  const normalized = collapseWs(text);
  const heading = IMPACT_STATEMENT_HEADING.exec(normalized);
  if (heading && heading.index != null) {
    const candidate = sliceAfterHeading(normalized, heading.index, heading[0].length);
    // The length test alone used to decide this, so a long enough slice was returned without ever
    // being asked whether it reads as prose. That is how A New Dawn's outcomes list got through.
    // `readsAsList` runs on the raw slice and the markup is stripped after it, in that order: strip
    // first and the bold runs it looks for are already gone.
    if (
      candidate.length >= 80 &&
      candidate.length <= MAX_STATEMENT_CHARS &&
      !readsAsList(candidate)
    ) {
      return stripInlineMarkup(candidate);
    }

    // Heading found but body empty in the immediate slice — scan the rest for overview prose.
    const rest = normalized.slice(heading.index + heading[0].length);
    const sentences = rest.match(/[^.!?]+[.!?]+/g) || [rest];
    for (const s of sentences) {
      const c = collapseWs(s);
      if (looksLikeImpactStatementProse(c)) return stripInlineMarkup(c);
    }
  }

  // No usable heading — leave it to the model. `looksLikeImpactStatementProse` (population word +
  // change verb, 80-600 chars) is too weak a classifier to guess an unlabeled sentence is "the"
  // impact statement: it matches most ordinary mission-statement prose too. Confirmed live on a
  // real document — Imagine That Philly's opening Mission sentence ("...provides resources that
  // encourage children to learn...so we can organically foster...growth") got harvested here and
  // duplicated into impactStatement, literal "## Page 1" markdown artifact and all, even though the
  // extraction prompt now explicitly tells Gemini "no heading at all -> mission, never
  // impactStatement" and Gemini correctly left impactStatement empty. A previous version of this
  // fallback used to run unconditionally here; removed rather than tuned further, same reasoning as
  // the sibling `promoteImpactStatementFromMission` removal (see extractNormalize.ts) — the model
  // can see the actual document and heading, a front-matter regex can't.
  return null;
}
