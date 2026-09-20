import type { DocumentBundle, LogicModel, ProcessingFile } from '../types';
import { displayFileName } from './processingFileDisplay.js';

/**
 * Retention side of the dev-only regression-capture globals (`window.__lmRegression*`). The DOM
 * halves — the `__lmSaveRegression*` download helpers and the `import.meta.env.DEV` guard that
 * compiles the whole thing out of production — stay in `App.tsx`; only the parts that decide
 * *what is stored under which key* live here, because that is the part `scripts/capture-bundles.mjs`
 * depends on and the part a test can hold still.
 *
 * WHY A SECOND GLOBAL EXISTS: `App.tsx` builds a bundle and then extracts from it in the same
 * upload flow, so capturing a bundle already spends one Gemini extract call per document. The
 * result of that call went only into React state, which Playwright cannot read, so the capture
 * script re-extracted the same bundle over HTTP and paid a second call for an answer the browser
 * already had. Over the ~103-document corpus that is 206 calls where 103 would do. Retaining the
 * extraction beside its bundle lets the script take both in one pass.
 * See docs/specs/local-capture-session.md §2.
 */
export interface RegressionCaptureGlobals {
  __lmRegressionBundles?: Record<string, DocumentBundle>;
  __lmRegressionExtractions?: Record<string, RetainedExtraction>;
}

/**
 * What the extract call returned, kept whole rather than reduced to the `LogicModel`: the capture
 * script writes an extraction alongside its bundle, and an extraction that cannot name the exact
 * prompt that produced it cannot be compared against another run — pooling unlike prompts is the
 * mistake `services/extractionLogExport.ts` already exists to prevent.
 */
export interface RetainedExtraction {
  model: LogicModel;
  promptVersion?: string;
  promptVariant?: string;
}

/**
 * The key both globals are stored under. Bundle and extraction MUST agree on it — the script
 * joins the two maps by key, and a disagreement does not fail loudly, it just silently drops the
 * saving back to two calls per document. So neither caller composes a key itself; both go through
 * here.
 *
 * `displayFileName` rather than `file.file.name` because a multi-logic-model PDF splits into
 * sibling `ProcessingFile`s that share one underlying `File` (docs/specs/multi-logic-model-pdf-v1.md):
 * keyed on the raw name, part 2 of a split would overwrite part 1's capture.
 */
export function regressionCaptureKey(
  file: Pick<ProcessingFile, 'file' | 'splitPartLabel'> | undefined,
  fallback: string
): string {
  return file ? displayFileName(file) : fallback;
}

export function retainRegressionBundle(
  globals: RegressionCaptureGlobals,
  file: Pick<ProcessingFile, 'file' | 'splitPartLabel'> | undefined,
  bundle: DocumentBundle
): void {
  globals.__lmRegressionBundles = globals.__lmRegressionBundles ?? {};
  globals.__lmRegressionBundles[regressionCaptureKey(file, bundle.sourceFormat)] = bundle;
}

export function retainRegressionExtraction(
  globals: RegressionCaptureGlobals,
  file: Pick<ProcessingFile, 'file' | 'splitPartLabel'> | undefined,
  bundle: DocumentBundle,
  extraction: RetainedExtraction
): void {
  globals.__lmRegressionExtractions = globals.__lmRegressionExtractions ?? {};
  globals.__lmRegressionExtractions[regressionCaptureKey(file, bundle.sourceFormat)] = extraction;
}

/**
 * Keys that have BOTH halves captured — what the capture script polls on.
 *
 * It must not poll on bundles alone: the bundle lands first and the extract call it feeds takes
 * minutes, so a bundles-only check reports the batch done while every extraction is still in
 * flight, and the script closes the browser and loses them. A document that hard-stops on
 * fidelity still counts as complete: `App.tsx` retains that extraction too, because "this source
 * was refused" is itself a result worth auditing.
 */
export function completeRegressionCaptures(globals: RegressionCaptureGlobals): string[] {
  const extractions = globals.__lmRegressionExtractions ?? {};
  return Object.keys(globals.__lmRegressionBundles ?? {})
    .filter(key => key in extractions)
    .sort();
}
