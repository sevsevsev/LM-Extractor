import type { LogicModel, LogicModelGroup } from '../types';
import type { CanonicalGroupedDomain } from './domainSynonyms.js';

/**
 * Drops an `unmapped` item whose wording is already printed, word for word, in a grid column.
 *
 * WHY THIS EXISTS. Prompt `2026-09-28.1` taught the extraction that a programme printed twice is
 * mapped once: the first printing fills the columns and the later printing is kept in `unmapped`
 * under a group naming that pass. On the real document that rule was written for, seven of the
 * forty-two restated items came back with text IDENTICAL to an item already in a column, because
 * the two printings word those seven the same. The board then showed the same sentence twice, and
 * the owner's call on 2026-09-28 was to see each item once.
 *
 * WHY IN CODE AND NOT IN THE PROMPT. Two copies of one string is a mechanical fact, so the rule
 * can be applied the same way on every run. Asking the model not to repeat itself would put the
 * judgement back inside the call, which is the failure this project has paid for before — the
 * splitter is code for the same reason (see `shared/listItemSplit.ts`). It also means the effect
 * is measurable offline over the committed raw answers, with no Gemini call.
 *
 * WHAT IT WILL NEVER DO. It only removes a copy whose normalised text EXACTLY equals a grid
 * item's. A restated line that begins the same way and then diverges carries wording the first
 * pass does not have, so it stays: dropping it would lose content, and the restatement rule's own
 * promise is that a later printing goes to `unmapped`, never nowhere. Nothing is dropped from a
 * grid column, and nothing is dropped because two `unmapped` items match each other — this looks
 * across the boundary only, so every removed item is still readable on the board.
 *
 * RETIRE/REVISE IF the board starts losing a restated line a reviewer wanted, which would mean
 * the match has been loosened beyond exact text, or if `unmapped` ever stops being visible beside
 * the columns, in which case dropping the copy would be dropping the content.
 */

/** The eight grouped columns. `unmapped` is the holding pen this reads against, never from. */
const GRID_DOMAINS = [
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
] as const satisfies readonly CanonicalGroupedDomain[];

/** Same normalisation the rest of the pipeline compares by: case and run-together spaces only. */
function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface DroppedRestatement {
  text: string;
  /** The column the surviving copy sits in, so a caller can say where the reader will find it. */
  keptIn: CanonicalGroupedDomain;
}

/**
 * Removes the duplicates in place and returns what went, newest caller first. An empty array —
 * the overwhelmingly common case, since most documents print their programme once — means the
 * model was left exactly as it came.
 */
export function dropRestatedDuplicates(model: LogicModel): DroppedRestatement[] {
  const unmapped = model.unmapped?.content;
  if (!Array.isArray(unmapped) || unmapped.length === 0) return [];

  const inGrid = new Map<string, CanonicalGroupedDomain>();
  for (const domain of GRID_DOMAINS) {
    const groups = model[domain]?.content;
    if (!Array.isArray(groups)) continue;
    for (const group of groups as LogicModelGroup[]) {
      for (const item of group.items ?? []) {
        const key = norm(item.text ?? '');
        // First column wins, so the reported home is stable whatever order the domains hold.
        if (key && !inGrid.has(key)) inGrid.set(key, domain);
      }
    }
  }
  if (inGrid.size === 0) return [];

  const dropped: DroppedRestatement[] = [];
  for (const group of unmapped as LogicModelGroup[]) {
    if (!Array.isArray(group.items)) continue;
    group.items = group.items.filter(item => {
      const keptIn = inGrid.get(norm(item.text ?? ''));
      if (!keptIn) return true;
      dropped.push({ text: item.text, keptIn });
      return false;
    });
  }
  // A group emptied by this held nothing but duplicates, so leaving its heading behind would show
  // the reader a section with no rows under it.
  model.unmapped!.content = unmapped.filter(group => (group.items?.length ?? 0) > 0);
  return dropped;
}
