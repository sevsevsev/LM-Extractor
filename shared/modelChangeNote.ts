/**
 * How a regression diff announces that the MODEL moved, not just the prompt.
 *
 * Why this exists as its own function. On 2026-10-07 the tier-1 runner reported 12 of 17 documents
 * changed, and the header said only `2026-09-26.1 -> 2026-09-28.3`. The model had also rotated
 * under the rolling alias in the same window, and nothing printed or stored said so — so every
 * difference in that run was unattributable between "we changed the prompt" and "Google changed
 * the model", and the reader had no way to know they were looking at two changes at once.
 *
 * The quiet case is deliberate: when the model is unchanged there is nothing to attribute and the
 * header stays short. Silence here means "same model", and the absent-baseline case is called out
 * explicitly rather than being allowed to look like silence.
 */
export function modelChangeNote(previous: string | undefined, current: string | undefined): string {
  if (previous && current) {
    return previous === current ? '' : ` · model ${previous} -> ${current}`;
  }
  // Baseline predates the field. Naming the current model is still worth more than nothing: it
  // tells the reader what produced today's side, while being honest that the comparison cannot
  // establish whether the model moved.
  if (!previous && current) return ` · model ${current}, baseline recorded none`;
  if (previous && !current) return ` · model unreported, baseline was ${previous}`;
  return '';
}
