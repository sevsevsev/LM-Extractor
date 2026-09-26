import type { LogicModel, LogicModelGroup } from '../types';
import { groupedDomainHasContent } from './domainPresence.js';

/** One column of the branded PDF's grid: its printed heading and the groups under it. */
export interface PdfColumn {
  title: string;
  /** The model field this column renders, for tests and for reading the code. */
  field: keyof LogicModel;
  groups: LogicModelGroup[];
}

export interface PdfColumnPlan {
  columns: PdfColumn[];
  /**
   * True when the three time-horizon outcome columns were replaced by a single Outcomes column
   * carrying `generalOutcomes`.
   */
  generalOutcomesSwappedIn: boolean;
}

const INPUT_COLUMNS: { title: string; field: keyof LogicModel }[] = [
  { title: 'Resources (Inputs)', field: 'inputs' },
  { title: 'Activities', field: 'activities' },
  { title: 'Outputs', field: 'outputs' },
];

const TIME_HORIZON_COLUMNS: { title: string; field: keyof LogicModel }[] = [
  { title: 'Short-Term Outcomes', field: 'shortTermOutcomes' },
  { title: 'Medium-Term Outcomes', field: 'mediumTermOutcomes' },
  { title: 'Long-Term Outcomes', field: 'longTermOutcomes' },
];

function groupsOf(model: LogicModel, field: keyof LogicModel): LogicModelGroup[] {
  const holder = model[field] as { content?: LogicModelGroup[] } | undefined;
  return holder?.content ?? [];
}

/**
 * Which columns the branded PDF prints, for this model.
 *
 * The PDF has always printed the same six: Inputs, Activities, Outputs and the three time-horizon
 * outcome columns. Some documents state their outcomes with no time horizon at all, and the app puts
 * those in `generalOutcomes` — which the PDF did not render, so such a document came out with three
 * empty outcome columns and its outcomes missing from the client's copy. UPenn BioEyes lost five of
 * its six items that way.
 *
 * So when all three time-horizon columns are empty and `generalOutcomes` is not, the three are
 * replaced by one Outcomes column carrying it. They are replaced rather than filled: spreading
 * general outcomes across short, medium and long-term would assert a time horizon the document never
 * stated, which is the one thing a coder must not be handed. When any time-horizon column does hold
 * items, the layout is exactly what it was, `generalOutcomes` included or not — this decides the
 * layout only, and nothing here moves an item between columns.
 *
 * Still deliberately not in the PDF: `impact` and `unmapped`. Both are Severin's call, and the PDF is
 * the client-facing deliverable rather than the working record — the full extract CSV carries every
 * item including those two.
 */
export function pdfColumnPlan(model: LogicModel): PdfColumnPlan {
  const timeHorizonEmpty = TIME_HORIZON_COLUMNS.every(
    c => !groupedDomainHasContent(groupsOf(model, c.field))
  );
  const hasGeneralOutcomes = groupedDomainHasContent(groupsOf(model, 'generalOutcomes'));
  const swap = timeHorizonEmpty && hasGeneralOutcomes;

  const outcomeColumns = swap
    ? [{ title: 'Outcomes', field: 'generalOutcomes' as keyof LogicModel }]
    : TIME_HORIZON_COLUMNS;

  return {
    generalOutcomesSwappedIn: swap,
    columns: [...INPUT_COLUMNS, ...outcomeColumns].map(c => ({
      title: c.title,
      field: c.field,
      groups: groupsOf(model, c.field),
    })),
  };
}
