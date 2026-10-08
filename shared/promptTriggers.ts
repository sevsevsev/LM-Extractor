import { columnNameToDomain, type CanonicalGroupedDomain } from './domainSynonyms.js';

/**
 * What can be known about a document's layout BEFORE the extraction call, from its text track
 * alone, so the layered prompt can leave out sections whose trigger is absent.
 *
 * WHY. The full prompt runs 20-25k characters and its own header says rules compete for
 * attention. A document with a labelled five-column grid is carrying the whole WHEN THERE IS NO
 * GRID method; a narrative with no headers is carrying the whole COLUMN FIDELITY contract. The
 * layered shape (`LM_PROMPT_SHAPE=layered`, see constants.ts) sends a section only when this says
 * its trigger may be present.
 *
 * THE BIAS IS DELIBERATE. Every answer here is three-valued, and `unknown` always means "send the
 * section". Leaving a rule out of a prompt that needed it is the expensive mistake; sending a rule
 * that did not apply is only the status quo. So `absent` is claimed only on positive evidence —
 * plenty of text and not one column name on a line of its own — and a bundle with no text track
 * is `unknown` on every axis.
 */

export type Signal = 'present' | 'absent' | 'unknown';

export interface LayoutSignals {
  /** A labelled column grid: three or more distinct column names, each on a short line of its own. */
  grid: Signal;
}

/** Below this, a text track says too little to claim anything is absent from it. */
export const MIN_CHARS_TO_CLAIM_ABSENCE = 400;

/** A heading line, not prose: a column name in a sentence does not count. */
const MAX_HEADING_WORDS = 6;

/** Three distinct column families is the least that reads as a grid rather than a passing mention. */
const MIN_DISTINCT_COLUMNS_FOR_GRID = 3;

/** The four outcome tiers are one family here: a grid is Inputs/Activities/Outputs/Outcomes, however the outcomes split. */
function family(domain: CanonicalGroupedDomain): string {
  return /Outcomes$/.test(domain) ? 'outcomes' : domain;
}

function headingCandidate(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[\s>*•●○▪\-–—\d.)]+/, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s*:\s*$/, '')
    .trim();
}

export function detectLayoutSignals(textTrack: string | undefined): LayoutSignals {
  const text = (textTrack ?? '').trim();
  if (!text) return { grid: 'unknown' };

  const families = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const candidate = headingCandidate(raw);
    if (!candidate || candidate.split(/\s+/).length > MAX_HEADING_WORDS) continue;
    const domain = columnNameToDomain(candidate);
    if (domain) families.add(family(domain));
  }

  const distinct = families.size;
  let grid: Signal;
  if (distinct >= MIN_DISTINCT_COLUMNS_FOR_GRID) grid = 'present';
  else if (distinct === 0 && text.length >= MIN_CHARS_TO_CLAIM_ABSENCE) grid = 'absent';
  else grid = 'unknown';

  return { grid };
}
