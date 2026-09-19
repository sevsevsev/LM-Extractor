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

const SECTION_STOP =
  /\b(mission\s*(statement|\/|overview)?|purpose|program\s+overview|target\s+population|who\s+we\s+serve|resources|inputs|activities|outputs|short[- ]term|medium[- ]term|long[- ]term|##\s*page\s*\d)\b/i;

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

/** Does this candidate sentence/paragraph read like impact-statement overview prose? */
export function looksLikeImpactStatementProse(text: string): boolean {
  const t = collapseWs(text);
  if (t.length < 80 || t.length > 600) return false;
  // Bulleted/numbered lines are grid content (an Inputs/Activities list item), not overview prose.
  if (/^[-•*•]|^\d+[.)]/.test(t)) return false;
  return POPULATION_WORDS.test(t) && CHANGE_WORDS.test(t);
}

function sliceAfterHeading(normalized: string, headingIndex: number, headingLen: number): string {
  let after = normalized.slice(headingIndex + headingLen).replace(/^[:\-–—\s]+/, '');
  const stop = after.search(SECTION_STOP);
  if (stop >= 0) after = after.slice(0, stop);
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
    if (candidate.length >= 80) return candidate;

    // Heading found but body empty in the immediate slice — scan the rest for overview prose.
    const rest = normalized.slice(heading.index + heading[0].length);
    const sentences = rest.match(/[^.!?]+[.!?]+/g) || [rest];
    for (const s of sentences) {
      const c = collapseWs(s);
      if (looksLikeImpactStatementProse(c)) return c;
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
