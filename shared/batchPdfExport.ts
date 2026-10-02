/**
 * What to tell the user after a batch PDF export, now that one unexportable document no longer
 * stops the rest.
 *
 * A document can drop out of the ZIP for two different reasons, and they mean different things:
 * `empty` is an extraction with nothing to put on a page (an evaluator's report that correctly
 * extracted nothing — see fixtures/regression-set/snapshots/philadelphia-ballet-lets-dance.json),
 * which is expected; `failed` is a document whose PDF genuinely could not be drawn, which is worth
 * reporting. Only a non-empty bucket gets mentioned.
 */

/** How many names to spell out before falling back to a count. */
const MAX_NAMES = 5;

export interface BatchPdfOutcome {
  /** Every export-ready file the batch tried. */
  total: number;
  /** Names of files whose extraction had nothing to put in a PDF. */
  empty: string[];
  /** Names of files whose PDF could not be drawn. */
  failed: string[];
}

const nameList = (names: string[]): string => {
  if (names.length <= MAX_NAMES) return names.join(', ');
  return `${names.slice(0, MAX_NAMES).join(', ')} and ${names.length - MAX_NAMES} more`;
};

/**
 * The alert to show after the ZIP downloads, or `null` when every file made it in and there is
 * nothing to say. When nothing could be drawn at all there is no ZIP, and the message says so.
 */
export const describeBatchPdfOutcome = ({ total, empty, failed }: BatchPdfOutcome): string | null => {
  const omitted = empty.length + failed.length;
  if (omitted === 0) return null;

  const sentences: string[] = [];
  if (omitted >= total) {
    sentences.push("Couldn't create the batch ZIP.");
  } else {
    sentences.push(`Downloaded ${total - omitted} of ${total} PDFs.`);
  }
  if (empty.length > 0) {
    sentences.push(
      `${empty.length} ${empty.length === 1 ? 'file had' : 'files had'} nothing to put in a PDF: ${nameList(empty)}.`
    );
  }
  if (failed.length > 0) {
    sentences.push(
      `${failed.length} ${failed.length === 1 ? "file couldn't" : "files couldn't"} be drawn: ${nameList(failed)}.`
    );
  }

  return sentences.join(' ');
};
