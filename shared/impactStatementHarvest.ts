/**
 * Deterministic harvest of labeled Impact Statement prose from document text layers.
 * Complements vision extract when page-1 text sits far below an IMPACT STATEMENT header
 * (large empty boxes) and Gemini drops it entirely.
 */

const IMPACT_STATEMENT_HEADING = /impact\s+statement\b/i;

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

/** How far into the document (chars) "front matter" is assumed to end — impact statements are
 * conventionally near the top of page 1, not deep in a later section. */
const FRONT_MATTER_SCAN_CHARS = 2500;

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

  // No usable heading — conservatively scan only the document's front matter (impact
  // statements conventionally sit near the top of page 1) for prose that reads like one,
  // rather than searching the whole document for one document's exact wording.
  const frontMatter = normalized.slice(0, FRONT_MATTER_SCAN_CHARS);
  const sentences = frontMatter.match(/[^.!?]+[.!?]+/g) || [];
  for (const s of sentences) {
    const c = collapseWs(s);
    if (looksLikeImpactStatementProse(c)) return c;
  }

  return null;
}
