/**
 * The session checkpoint round-trip, and the two small derivations beside it.
 *
 * Extracted from `App.tsx` — 1500 lines with no test file — because this is where a reload either
 * keeps the operator's work or silently loses it. `toPersistedRecord` and
 * `persistedRecordToProcessingFile` are two hand-written field lists that must stay in step: add a
 * field to `ProcessingFile` and forget one of them, and a resumed session comes back subtly wrong
 * with nothing failing. `sessionRecord.test.ts` now checks them against each other.
 */
import type { LogicModel, ProcessingFile } from '../types.js';
import { bundleImpliesLowLegibility } from '../types.js';
import { normalizeExtractedLogicModel } from './extractNormalize.js';
import type { PersistedFileRecord } from '../services/sessionStore.js';
import type { HighlightRegion } from '../components/SourceDocumentPane.js';

export function modelForExport(model: LogicModel, warnings?: string[]): LogicModel {
  return normalizeExtractedLogicModel(structuredClone(model), {
    lowLegibility: bundleImpliesLowLegibility({ warnings: warnings ?? [] }),
  });
}

export /** Checkpoint-relevant fields only — excludes transient/session-only data (previews, progress text). */
function toPersistedRecord(f: ProcessingFile): PersistedFileRecord {
  return {
    id: f.id,
    file: f.file,
    status:
      f.status === 'converting' || f.status === 'detecting' || f.status === 'extracting'
        ? 'pending'
        : f.status,
    result: f.result,
    warnings: f.warnings,
    extractionBlockers: f.extractionBlockers,
    error: f.error,
    mismatchBannerDismissed: f.mismatchBannerDismissed,
    fidelityBannerDismissed: f.fidelityBannerDismissed,
    codingExportFidelityAck: f.codingExportFidelityAck,
    sourcePaneCollapsed: f.sourcePaneCollapsed,
    sourceDocumentId: f.sourceDocumentId,
    sourcePageRange: f.sourcePageRange,
    splitPartLabel: f.splitPartLabel,
    forceSingleModel: f.forceSingleModel,
    promptVersion: f.promptVersion,
    promptVariant: f.promptVariant,
    modelId: f.modelId,
  };
}

export function hashPersistedRecord(record: PersistedFileRecord): string {
  return JSON.stringify(record, (key, value) => (key === 'file' ? undefined : value));
}

export function persistedRecordToProcessingFile(record: PersistedFileRecord): ProcessingFile {
  return {
    id: record.id,
    file: record.file,
    status: record.status,
    result: record.result,
    warnings: record.warnings,
    extractionBlockers: record.extractionBlockers,
    error: record.error,
    mismatchBannerDismissed: record.mismatchBannerDismissed,
    fidelityBannerDismissed: record.fidelityBannerDismissed,
    codingExportFidelityAck: record.codingExportFidelityAck,
    sourcePaneCollapsed: record.sourcePaneCollapsed,
    sourceDocumentId: record.sourceDocumentId,
    sourcePageRange: record.sourcePageRange,
    splitPartLabel: record.splitPartLabel,
    forceSingleModel: record.forceSingleModel,
    promptVersion: record.promptVersion,
    promptVariant: record.promptVariant,
    modelId: record.modelId,
  };
}


export /**
 * Resolve `LogicModel.possiblyMissedRegions` (Gemini's own self-report; see
 * `shared/extractionFidelity.ts`) down to plain fractions for `SourceDocumentPane`. `xStart`/`xEnd`
 * are Gemini's own estimate of the region's horizontal span — a region it couldn't estimate one for
 * has no `xStart`/`xEnd` and is dropped rather than drawn as a full-page box, since that would convey
 * nothing the page-jump chip doesn't already say. (The chip itself still shows for every flagged page
 * regardless.)
 */
function resolveHighlightRegions(file: ProcessingFile): HighlightRegion[] {
  const regions = file.result?.possiblyMissedRegions;
  if (!regions || regions.length === 0) return [];
  return regions
    .filter(region => typeof region.xStart === 'number' && typeof region.xEnd === 'number')
    .map(region => ({
      page: region.page,
      leftFrac: region.xStart!,
      widthFrac: Math.max(0, region.xEnd! - region.xStart!),
      note: region.note,
    }));
}
