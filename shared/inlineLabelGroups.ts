import type { LogicModel, LogicModelGroup } from '../types';
import { columnNameToDomain, type CanonicalGroupedDomain } from './domainSynonyms.js';

/**
 * Promotes an inline `Label: …` prefix to `Group.name` when a column carries a visible band of
 * them and the model returned no grouping at all.
 *
 * WHY THIS EXISTS. A common logic-model house style states a category, a colon, then what belongs
 * to it, repeated down every column — `● Participants: demographics, attendance, retention.` The
 * extraction puts all of it in one group called "General" with the category left inside the item
 * text, so the CSV's Group column says nothing and every row repeats its own heading. Raised by
 * the owner 2026-09-22 against two source documents; the renderer bug was ruled out first (those
 * PDFs do scan as fault-2 scrambled, so the extract in hand WAS made through degraded rasters,
 * but a re-run on main after the worker-realm fix reproduces the same shape item for item).
 * This is the prompt working as written, not damage.
 *
 * The prompt cannot fix it, and should not be asked to. GROUPING GATE rule 7 defines the group as
 * "the outermost label in that column carrying NO bullet marker" — a heading at the column's left
 * edge. A label at the head of a bulleted line does not qualify, so rule 1's default ("General")
 * takes over. That bullet-marker test is load-bearing: it is what stopped Oxford Circle's
 * Resources sub-headings being copied across every other column (friction-log sessions 1-2), so
 * loosening it in the prompt trades one documented failure for another. Worse, a prompt rule is a
 * decision the model re-makes on every run, and grouping is already the axis this project's
 * reproducibility problem lives on.
 *
 * So this runs in code instead, after the model returns and BEFORE `applySourceAwareMapping`, so
 * a promoted label flows into `sourceHeader` (the "Sub-heading In Source" export column) by the
 * path every other group name already takes. It adds no Gemini call and touches no prompt, so it
 * cannot move an item between columns or alter what the model transcribed — it only relabels, and
 * strips the label it promoted so the text is not carrying its own group name (GROUPING GATE 9).
 *
 * MEASURED over `fixtures/regression-set/snapshots/` (10 blessed documents): NINE come back
 * unchanged. The one that changes — ymca-youth-civic-engagement — changes because it has the same
 * miss, 15 of its 16 items label-shaped with no groups at all. Every threshold below was tuned
 * against that same set, and the YMCA columns are the ones quoted in the tests, because that
 * document is already committed here and the documents that prompted the change are not.
 *
 * WHAT IT DOES NOT DO. It does not split the list *after* the colon into separate items, which is
 * the other half of what the owner asked for and is deliberately left alone: real sources separate
 * those lists with semicolons, full stops and bare commas within one column, so no deterministic
 * separator exists, and any rule that picks one per cell is a fresh model decision on every run.
 *
 * RETIRE/REVISE IF a document appears where a genuine one-item-per-category column is promoted
 * into groups a reviewer then has to undo by hand.
 */

/** The eight grouped columns. `unmapped` is deliberately excluded — it is not a column. */
const GROUPED_DOMAINS = [
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
] as const satisfies readonly CanonicalGroupedDomain[];

/**
 * A label is a heading, not a sentence: it starts with a capital, runs to at most five words, and
 * carries no sentence punctuation. Those three together are what reject the prose colons that sit
 * in the same columns — a bullet opening with a figure (`110+ professional staff: including…`) or
 * a sentence that merely happens to contain one (`Multi-year presence in priority neighbourhoods
 * and strong partnerships: with schools…`) — neither of which a reviewer would call a category.
 *
 * Five words rather than four, measured: four leaves YMCA's Activities column ungrouped, because
 * `Mock Conferences (MUN and YAG)` is five words and dropping it takes that column under
 * MIN_LABELLED_ITEMS. Five changes nothing else across the ten blessed documents.
 */
const LABEL_MAX_WORDS = 5;
const LABEL_MAX_CHARS = 40;
const LABEL_PATTERN = /^([A-Z][A-Za-z0-9'’&/()\- ]*?):[ \t]+(\S[\s\S]*)$/;

/**
 * At least this many labelled items, and this share of the group, before a column is regrouped.
 * Three is enough to read as a band rather than a coincidence; half the column is what keeps a
 * mostly-prose column from being renamed after its minority of labelled bullets.
 *
 * Demanding every item in a group, 60%, and 50% all give the IDENTICAL blast radius over the ten
 * blessed documents, so the loosest is used: it costs nothing measurable there, and it is what
 * lets through a column that mixes a few prose bullets in among the labelled ones.
 */
const MIN_LABELLED_ITEMS = 3;
const MIN_LABELLED_SHARE = 0.5;

function parseLabel(text: string): { label: string; rest: string } | null {
  const match = LABEL_PATTERN.exec(text.trim());
  if (!match) return null;
  const label = match[1].trim();
  const rest = match[2].trim();
  if (!label || !rest) return null;
  if (label.length > LABEL_MAX_CHARS) return null;
  if (label.split(/\s+/).length > LABEL_MAX_WORDS) return null;
  return { label, rest };
}

function isUngrouped(group: LogicModelGroup): boolean {
  const name = (group.name || '').trim().toLowerCase();
  return name === '' || name === 'general';
}

/**
 * Whether this column's labels can be promoted without `applySourceAwareMapping` then moving the
 * items somewhere else. It asks exactly the question that pass asks, with the same predicate, so
 * the two cannot drift apart: a label that would not trigger a move cannot disqualify a band.
 *
 * This guard was not foreseen — it was found by running candidate labels through the synonym
 * table. YMCA's Long-Term Outcomes column reads `Empowered Civic Participation:`, `College and
 * Career Readiness:`, `Sustained Community Impact:`, and the third ends in "Impact".
 *
 * It used to ask `synonymToDomain`, which matches a domain word anywhere at a word boundary, so
 * "Sustained Community Impact" read as the Impact column and disqualified the whole band. That
 * was the right call against the mapper as it then behaved and it cost this document its
 * Long-Term Outcomes grouping: four sections of five promoted, the fifth left with its labels
 * inline, same page and same markup. The 2026-09-23 audit filed it as a defect in its own right;
 * it was this guard firing as designed. `columnNameToDomain` now requires the unqualified column
 * name, so a qualified sub-heading is no longer read as a column and the fifth section promotes
 * like the other four.
 *
 * One offending label still disqualifies the WHOLE group rather than just itself. Promoting the
 * other members of a band and leaving one behind is worse for a reviewer than leaving the column
 * alone, and "this column contains a label that names another column outright" is a fair signal
 * that its labels are not categories in the sense this pass is looking for.
 */
function labelsStayInThisColumn(labels: string[], domain: CanonicalGroupedDomain): boolean {
  return labels.every(label => {
    const named = columnNameToDomain(label);
    return named === null || named === domain;
  });
}

/**
 * Rebuild one group as one group per label, in first-appearance order.
 *
 * Items with no label keep their reading position: they collect into a single "General" group
 * placed where the first of them appeared, rather than being swept to the end, so a column that
 * opens with prose and then turns into a labelled band still reads in source order.
 */
function regroup(group: LogicModelGroup): LogicModelGroup[] | null {
  const parsed = group.items.map(item => ({ item, label: parseLabel(item.text || '') }));
  const labelled = parsed.filter(p => p.label !== null);

  if (labelled.length < MIN_LABELLED_ITEMS) return null;
  if (labelled.length < MIN_LABELLED_SHARE * parsed.length) return null;

  // Distinct labels only. A repeated label means the column is using the prefix as a stem for a
  // list ("Students demonstrate improvements in:" on all nine Cub Reporter items), which is
  // GROUPING GATE rule 8's prefix-fold and already correct — not a set of categories waiting to
  // be promoted.
  const seen = new Set(labelled.map(p => p.label!.label.toLowerCase()));
  if (seen.size !== labelled.length) return null;

  const out: LogicModelGroup[] = [];
  let general: LogicModelGroup | null = null;
  for (const { item, label } of parsed) {
    if (label) {
      out.push({ name: label.label, items: [{ ...item, text: label.rest }] });
      continue;
    }
    if (!general) {
      general = { name: 'General', items: [] };
      out.push(general);
    }
    general.items.push(item);
  }
  return out;
}

/** Labels this pass would promote in `group`, for callers that want to inspect without rewriting. */
export function inlineLabelsIn(group: LogicModelGroup): string[] {
  if (!isUngrouped(group) || !Array.isArray(group.items)) return [];
  const regrouped = regroup(group);
  if (!regrouped) return [];
  return regrouped.filter(g => g.name !== 'General').map(g => g.name);
}

/** Mutates and returns `model`. Safe to call twice: a promoted group is no longer "General". */
export function promoteInlineColonLabels(model: LogicModel): LogicModel {
  for (const domain of GROUPED_DOMAINS) {
    const field = model[domain];
    const groups: LogicModelGroup[] | undefined = field?.content;
    if (!Array.isArray(groups) || groups.length === 0) continue;

    const next: LogicModelGroup[] = [];
    for (const group of groups) {
      if (!isUngrouped(group) || !Array.isArray(group.items)) {
        next.push(group);
        continue;
      }
      const regrouped = regroup(group);
      const labels = regrouped?.filter(g => g.name !== 'General').map(g => g.name) ?? [];
      if (!regrouped || !labelsStayInThisColumn(labels, domain)) {
        next.push(group);
        continue;
      }
      next.push(...regrouped);
    }
    field.content = next;
  }
  return model;
}
