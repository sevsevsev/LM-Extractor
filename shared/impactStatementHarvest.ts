/**
 * Deterministic harvest of labeled Impact Statement prose from document text layers.
 * Complements vision extract when page-1 text sits far below an IMPACT STATEMENT header
 * (large empty boxes) and Gemini drops it entirely.
 */

const IMPACT_STATEMENT_HEADING = /impact\s+statement\b/i;

const SECTION_STOP =
  /\b(mission\s*(statement|\/|overview)?|purpose|program\s+overview|target\s+population|who\s+we\s+serve|resources|inputs|activities|outputs|short[- ]term|medium[- ]term|long[- ]term|##\s*page\s*\d)\b/i;

/** YouthMoves / similar overview fingerprints when heading+prose are split oddly. */
const IMPACT_PROSE_SIGNALS = [
  /through\s+sustained\s+participation/i,
  /will\s+experience\s+an\s+affirming/i,
  /fosters\s+artistic\s+growth/i,
  /expanding\s+their\s+educational\s+pathways/i,
  /long-term\s+career\s+opportunities/i,
];

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function looksLikeImpactProse(text: string): boolean {
  const t = collapseWs(text);
  if (t.length < 80) return false;
  return IMPACT_PROSE_SIGNALS.filter(p => p.test(t)).length >= 2 || IMPACT_PROSE_SIGNALS[0].test(t);
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

    // Heading found but body empty in the immediate slice — scan rest of doc for overview prose.
    const rest = normalized.slice(heading.index + heading[0].length);
    const sentences = rest.match(/[^.!?]+[.!?]+/g) || [rest];
    for (const s of sentences) {
      const c = collapseWs(s);
      if (looksLikeImpactProse(c)) return c;
    }
  }

  // No usable heading slice — still recover known overview fingerprints (rare OCR miss of heading).
  for (const signal of IMPACT_PROSE_SIGNALS) {
    const m = signal.exec(normalized);
    if (!m || m.index == null) continue;
    // Expand backward to sentence start and forward to end of long clause.
    let start = m.index;
    while (start > 0 && !/[.!?|]/.test(normalized[start - 1]!)) start--;
    let end = Math.min(normalized.length, m.index + 500);
    const chunk = collapseWs(normalized.slice(start, end));
    const stop = chunk.search(SECTION_STOP);
    const candidate = collapseWs(stop >= 0 ? chunk.slice(0, stop) : chunk);
    if (looksLikeImpactProse(candidate)) return candidate;
  }

  return null;
}
