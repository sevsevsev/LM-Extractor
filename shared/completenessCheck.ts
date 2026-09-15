/**
 * Deterministic proxy for extraction completeness (recall) — the one dimension of extraction
 * quality that previously had no code-level signal at all. Text fidelity has `verbatim` ratios,
 * placement has the causal-chain/mapping checks, resolution has the legibility floor — but
 * whether the model *missed* visible content had nothing except its own self-report contributing
 * to `partial` status.
 *
 * This compares how many candidate item-like lines exist in the source text track (Track A)
 * against how many items the model actually extracted. It is a rough proxy, not a measurement:
 * it can't tell a missed grid bullet from a mission-statement sentence, a page footer, or an
 * organization's letterhead text — so it's deliberately conservative (only flags gross
 * mismatches). Unlike the legibility/verbatim-ratio signals, which were tuned from real
 * documented friction (see extraction-confidence-v1.md), this one is unvalidated against real
 * documents yet — see its capped severity where it's wired into the fidelity rollup.
 */

const BULLET_PREFIX = /^[-*••]\s+/;
const NUMBERED_PREFIX = /^\d+[.)]\s+/;
const HEADING_PREFIX = /^#{1,6}\s+/;

/** Longer lines read as prose (an Impact Statement or Mission paragraph), not a single grid item. */
const MIN_CANDIDATE_LEN = 3;
const MAX_CANDIDATE_LEN = 200;

/**
 * PDF/PPTX's Track A is a flat text stream, not real markdown — pdfjs's line breaks follow
 * visual wrapping, so a single bullet item in a narrow grid column routinely lands on 2-4 lines
 * (e.g. "- Distributing marketing" / "materials"). Counting each wrapped continuation as its own
 * candidate massively over-counts on exactly the dense multi-column documents this signal most
 * needs to work on. Reflow first: once a bulleted/numbered line opens an item, absorb subsequent
 * non-bulleted, non-heading lines into it until the next bullet, heading, or blank line — the same
 * "sticky" merge a markdown renderer does for a wrapped list item.
 */
function reflowWrappedLines(rawLines: string[]): string[] {
  const merged: string[] = [];
  let current: string | null = null;
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed || HEADING_PREFIX.test(trimmed)) {
      if (current !== null) merged.push(current);
      current = null;
      continue;
    }
    if (BULLET_PREFIX.test(trimmed) || NUMBERED_PREFIX.test(trimmed)) {
      if (current !== null) merged.push(current);
      current = trimmed;
    } else if (current !== null) {
      current = `${current} ${trimmed}`; // wrapped continuation of the open bullet
    } else {
      merged.push(trimmed); // standalone line with nothing open (e.g. a DOCX line with no bullet)
    }
  }
  if (current !== null) merged.push(current);
  return merged;
}

function isCandidateItemLine(line: string): boolean {
  if (BULLET_PREFIX.test(line) || NUMBERED_PREFIX.test(line)) return true;
  return line.length >= MIN_CANDIDATE_LEN && line.length <= MAX_CANDIDATE_LEN;
}

export interface CompletenessEstimate {
  candidateSourceLines: number;
  extractedItemCount: number;
  possiblyIncomplete: boolean;
}

/** Ignore small documents / small absolute gaps entirely — noise, not signal, at that scale. */
const MIN_GAP_TO_FLAG = 5;
/** Candidate lines at least 50% more than what was extracted. */
const RATIO_TO_FLAG = 1.5;

export function estimateCompleteness(
  sourceText: string | undefined,
  extractedItemCount: number
): CompletenessEstimate {
  const rawLines = (sourceText || '').split('\n');
  const reflowedLines = reflowWrappedLines(rawLines);
  const candidateSourceLines = reflowedLines.filter(isCandidateItemLine).length;

  const gap = candidateSourceLines - extractedItemCount;
  const possiblyIncomplete =
    extractedItemCount > 0 && gap >= MIN_GAP_TO_FLAG && candidateSourceLines / extractedItemCount >= RATIO_TO_FLAG;

  return { candidateSourceLines, extractedItemCount, possiblyIncomplete };
}
