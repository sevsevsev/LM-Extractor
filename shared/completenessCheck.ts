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
/** `## Page N` / `## Slide N` markers inserted by services/fileService.ts's Track A builders. */
const PAGE_MARKER = /^##\s+(?:Page|Slide)\s+(\d+)\s*$/i;

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
interface ReflowedLine {
  text: string;
  /** Page/slide the line fell under (from the nearest preceding `## Page N` / `## Slide N` marker); 1 when the text carries no such markers (e.g. DOCX Track A). */
  page: number;
}

function reflowWrappedLines(rawLines: string[]): { lines: ReflowedLine[]; sawPageMarker: boolean } {
  const merged: ReflowedLine[] = [];
  let current: string | null = null;
  let currentPage = 1;
  let sawPageMarker = false;
  const flush = () => {
    if (current !== null) merged.push({ text: current, page: currentPage });
    current = null;
  };
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    const pageMatch = PAGE_MARKER.exec(trimmed);
    if (pageMatch) {
      flush();
      currentPage = parseInt(pageMatch[1], 10) || currentPage;
      sawPageMarker = true;
      continue;
    }
    if (!trimmed || HEADING_PREFIX.test(trimmed)) {
      flush();
      continue;
    }
    if (BULLET_PREFIX.test(trimmed) || NUMBERED_PREFIX.test(trimmed)) {
      flush();
      current = trimmed;
    } else if (current !== null) {
      current = `${current} ${trimmed}`; // wrapped continuation of the open bullet
    } else {
      merged.push({ text: trimmed, page: currentPage }); // standalone line with nothing open (e.g. a DOCX line with no bullet)
    }
  }
  flush();
  return { lines: merged, sawPageMarker };
}

function isCandidateItemLine(line: string): boolean {
  if (BULLET_PREFIX.test(line) || NUMBERED_PREFIX.test(line)) return true;
  return line.length >= MIN_CANDIDATE_LEN && line.length <= MAX_CANDIDATE_LEN;
}

export interface CompletenessEstimate {
  candidateSourceLines: number;
  extractedItemCount: number;
  possiblyIncomplete: boolean;
  /**
   * Pages ranked by largest (candidate lines - extracted items) gap, capped at 3, ascending by
   * page number. Only set when `possiblyIncomplete` fires, `itemsByPage` was passed, and the
   * source text actually carried `## Page N` / `## Slide N` markers (DOCX Track A has none —
   * every line lands on the same synthetic page 1, which isn't a useful pointer, so it's omitted
   * rather than reported). Same "unvalidated proxy" trust level as `possiblyIncomplete` itself.
   */
  suspectPages?: number[];
}

/** Ignore small documents / small absolute gaps entirely — noise, not signal, at that scale. */
const MIN_GAP_TO_FLAG = 5;
/** Candidate lines at least 50% more than what was extracted. */
const RATIO_TO_FLAG = 1.5;
/** Per-page gap floor — deliberately smaller than MIN_GAP_TO_FLAG since per-page counts run smaller than whole-document ones. */
const MIN_PAGE_GAP_TO_FLAG = 2;
const MAX_SUSPECT_PAGES = 3;

export function estimateCompleteness(
  sourceText: string | undefined,
  extractedItemCount: number,
  itemsByPage?: Map<number, number>
): CompletenessEstimate {
  const rawLines = (sourceText || '').split('\n');
  const { lines: reflowedLines, sawPageMarker } = reflowWrappedLines(rawLines);
  const candidates = reflowedLines.filter(l => isCandidateItemLine(l.text));
  const candidateSourceLines = candidates.length;

  const gap = candidateSourceLines - extractedItemCount;
  const possiblyIncomplete =
    extractedItemCount > 0 && gap >= MIN_GAP_TO_FLAG && candidateSourceLines / extractedItemCount >= RATIO_TO_FLAG;

  let suspectPages: number[] | undefined;
  if (possiblyIncomplete && sawPageMarker && itemsByPage) {
    const candidatesByPage = new Map<number, number>();
    for (const c of candidates) {
      candidatesByPage.set(c.page, (candidatesByPage.get(c.page) ?? 0) + 1);
    }
    const ranked = Array.from(candidatesByPage.entries())
      .map(([page, count]) => ({ page, gap: count - (itemsByPage.get(page) ?? 0) }))
      .filter(p => p.gap >= MIN_PAGE_GAP_TO_FLAG)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, MAX_SUSPECT_PAGES)
      .map(p => p.page)
      .sort((a, b) => a - b);
    if (ranked.length > 0) suspectPages = ranked;
  }

  return { candidateSourceLines, extractedItemCount, possiblyIncomplete, suspectPages };
}
