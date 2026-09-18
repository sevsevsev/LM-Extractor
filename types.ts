/** Document-level extraction fidelity. */
export type ExtractionStatus = 'ok' | 'partial' | 'abstained';
export type ExtractionConfidence = 'high' | 'medium' | 'low';
/**
 * Gemini's self-report on whether the source looks like a logic model at all, vs. a partner
 * submitting an overlapping-but-different document (theory of change, impact report, etc.).
 * `not_logic_model` / `unclear` never abstain the extraction — best-effort extraction still runs
 * for any genuinely overlapping content, this just flags the file for a human to confirm.
 */
export type DocumentTypeAssessment = 'logic_model' | 'not_logic_model' | 'unclear';

export interface ExtractionFidelity {
  status: ExtractionStatus;
  confidence: ExtractionConfidence;
  /** 0–4 plain-language reasons; empty when ok + high with nothing to note */
  blockers: string[];
}

export interface LogicModelItem {
  text: string;
  /**
   * Provenance flags — see docs/specs/extraction-provenance-and-color.md.
   * `verbatim: false` means the wording was paraphrased, reconstructed, or read from
   * low-legibility / clipped source and should be verified against the original.
   */
  verbatim?: boolean;
  /** Short note on any transcription uncertainty (e.g. "source text appears clipped"). */
  sourceNote?: string;
  /**
   * Model-reported box fill colour (name or hex) when items are visually colour-coded.
   * Colour is a secondary categorization axis whose meaning is author-defined and may be unknown;
   * it is metadata only and must never change column assignment.
   */
  fillColor?: string;
  /** Model-reported border colour when it differs from the fill (often a second category marker). */
  borderColor?: string;
  /** Author section / column label from source when known. See docs/specs/source-aware-mapping-v1.md */
  sourceSection?: string;
  sourceHeader?: string;
  mappingConfidence?: 'synonym' | 'spatial' | 'subbucket' | 'user' | 'unmapped';
  mappedBy?: 'auto' | 'user';
  /** Optional human note when assigning/remapping domains. */
  mappingNote?: string;
  /**
   * 1-based document page/slide index into session `sourcePreviewImages` / `DocumentBundle.previewImages`.
   * Immutable after extract (edits/remaps must not clear). See `source-review-v1.md`.
   */
  sourcePage?: number;
  /** 1-based column band when known (e.g. from column tiling); omit when unknown. */
  sourceColumn?: number;
}

export type LayoutFamily =
  | 'vertical_columns'
  | 'horizontal_rows'
  | 'diagram'
  | 'prose_sections'
  | 'unknown';

/** Append-only log of human mapping actions for iterative ingestion improvement. */
export interface MappingCorrectionEvent {
  at: string;
  fileId: string;
  action:
    | 'assign_domain'
    | 'remap_domain'
    | 'return_unmapped'
    | 'dismiss_mismatch_banner'
    | 'note_edit';
  itemKey: string;
  itemText: string;
  fromDomain: string | null;
  toDomain: string | null;
  sourceSection?: string;
  sourceHeader?: string;
  note?: string;
  autoSuggestedDomain?: string | null;
  mismatchScore?: number;
  layoutFamily?: string;
}

export interface LogicModelGroup {
  name: string;
  items: LogicModelItem[];
}

export interface LogicModelField<T> {
  content: T;
}

export interface LogicModel {
  organization: string;
  program: string;
  /** Explicit labeled Impact Statement in source — optional; see docs/specs/tech-multi-column-extract.md */
  impactStatement?: LogicModelField<string>;
  mission: LogicModelField<string>;
  targetPopulation: LogicModelField<string>;
  inputs: LogicModelField<LogicModelGroup[]>;
  activities: LogicModelField<LogicModelGroup[]>;
  outputs: LogicModelField<LogicModelGroup[]>;
  shortTermOutcomes: LogicModelField<LogicModelGroup[]>;
  mediumTermOutcomes: LogicModelField<LogicModelGroup[]>;
  longTermOutcomes: LogicModelField<LogicModelGroup[]>;
  /**
   * Outcomes from a source document that doesn't distinguish short/medium/long-term — either one
   * combined outcomes column/section (e.g. a single "Outcomes" header), or multiple outcome
   * columns on a different organizing axis entirely (e.g. "Attitudes" / "Behaviors" / "Conditions").
   * In the latter case each source column's own header is kept as its `LogicModelGroup.name`
   * (see COLUMN FIDELITY rule 7b in constants.ts) rather than collapsed to "General", so a coder
   * can see the source's own categorization while still assigning a real time horizon. Not a
   * Gemini-required field; absent/empty when the source does distinguish time horizons.
   * Deliberately separate from `unmapped` — these are confirmed outcomes, just without a known
   * time horizon, and are expected to reach human review (coding export) for that assignment.
   */
  generalOutcomes?: LogicModelField<LogicModelGroup[]>;
  impact: LogicModelField<LogicModelGroup[]>;
  /**
   * Free-text capture of a colour key/legend when the source document explicitly provides one
   * (e.g. "Orange = students; Purple = families"). Empty/absent when no legend is shown — colours
   * are then recorded per item without an inferred meaning. See docs/specs/extraction-provenance-and-color.md.
   */
  colorLegend?: string;
  /**
   * Items whose source header did not synonym-map (or were returned by the user).
   * Not a Gemini-required field — filled by source-aware mapping / human assignment.
   */
  unmapped?: LogicModelField<LogicModelGroup[]>;
  /** Coarse layout hint when known; defaults to vertical_columns after mapping pass. */
  layoutFamily?: LayoutFamily;
  /** Session correction log for offline review / synonym iteration. */
  mappingCorrections?: MappingCorrectionEvent[];
  /**
   * Extraction fidelity. See `extraction-confidence-v1.md`.
   * Flat fields for Gemini schema / CSV; use helpers in `shared/extractionFidelity.ts`.
   */
  extractionStatus?: ExtractionStatus;
  extractionConfidence?: ExtractionConfidence;
  extractionBlockers?: string[];
  /**
   * Gemini's self-reported document-type check (see `DocumentTypeAssessment`). Absent/`logic_model`
   * means no concern; `not_logic_model`/`unclear` feed into `reconcileExtractionFidelity` as a
   * (partial/medium, never hard-stop) review flag — see `shared/extractionFidelity.ts`.
   */
  documentTypeAssessment?: DocumentTypeAssessment;
  /** Brief reason for a non-`logic_model` assessment (e.g. "reads as a Theory of Change narrative"). */
  documentTypeNote?: string;
  /**
   * Pages (and, when known, the horizontal span on that page) that may contain content the
   * extraction missed — drives the "spot-check for missed content" fidelity blocker's
   * source-pane highlight. See `shared/extractionFidelity.ts` / `shared/completenessCheck.ts`.
   * Unvalidated signal, same trust level as `possiblyIncomplete` in `extractionBlockers` — never
   * used to hard-stop or gate anything, purely a "look here" cue.
   */
  possiblyMissedRegions?: PossiblyMissedRegion[];
}

export interface PossiblyMissedRegion {
  /** 1-based, matches `sourcePage` / `DocumentBundle.previewImages` indexing. */
  page: number;
  /**
   * Approximate horizontal span [0,1] of the page width, when Gemini could estimate one by eye
   * (it's shown the whole page, not a cropped tile — there's no retained geometry to look up).
   * Omit both when unknown; the UI falls back to highlighting the full page width.
   */
  xStart?: number;
  xEnd?: number;
  /** Short human-readable reason, when available (e.g. from Gemini's self-report). */
  note?: string;
}

/** Locates one extract JPEG within the source document (1-based page / column). */
export interface SourceImageRef {
  page: number;
  column?: number;
}

/**
 * One page range Gemini identified as containing a single, complete logic model, from the
 * `detect-logic-models` pre-pass (see `docs/specs/multi-logic-model-pdf-v1.md`). 1-based,
 * inclusive, matching `DocumentBundle.previewImages` indexing for the *original*, unsliced
 * document. Groups from one detection call always cover every page exactly once, in order —
 * see `shared/logicModelPageGroups.ts`.
 */
export interface LogicModelPageGroup {
  startPage: number;
  endPage: number;
  /** Organization/program name for this range, only when confidently legible — UI label only. */
  label?: string;
}

/**
 * Dual-track handoff from format adapters → Gemini extract.
 * Track A = `textTrack` (Markdown / structural text); Track B = `images` (page rasters).
 */
export interface DocumentBundle {
  /** Base64 JPEGs for Track B / vision (no data-URL prefix). May be full pages or column tiles. */
  images: string[];
  /**
   * Parallel to `images` when known — document page (and optional column) for each extract JPEG.
   * Used to label images for Gemini so `sourcePage` / `sourceColumn` on items refer to real pages.
   */
  imageRefs?: SourceImageRef[];
  /**
   * One JPEG per document page/slide for in-app source review (content crop).
   * Empty/omitted for text-only bundles. Indexes match 1-based `sourcePage` on items.
   */
  previewImages?: string[];
  /** Markdown or structural text for Track A / text-layer hints / fallback. */
  textTrack: string;
  /** Non-blocking fidelity notes (e.g. low resolution, truncated pages). */
  warnings: string[];
  sourceFormat: 'pdf' | 'docx' | 'pptx';
}

/**
 * Input to the `detect-logic-models` pre-pass — deliberately narrower than `DocumentBundle`: it
 * needs one whole-page image per page (`previewImages`, already computed for the source-review
 * pane), not Track B's possibly column-tiled `images`.
 */
export interface DetectLogicModelGroupsInput {
  previewImages: string[];
  textTrack: string;
  sourceFormat: DocumentBundle['sourceFormat'];
}

/** Canonical warning when image-dominant / flattened pages are present (drives extract prompt). */
export const LOW_LEGIBILITY_WARNING =
  'Source includes flattened-raster page(s); small text may be misread.';

export function bundleImpliesLowLegibility(bundle: Pick<DocumentBundle, 'warnings'>): boolean {
  return bundle.warnings.some(
    // `[- ]` catches both "low resolution" and "low-resolution" — found via real-batch log
    // analysis that the DOCX embedded-image warning (services/fileService.ts) uses the hyphenated
    // form while this regex only matched the spaced form, so it silently never fired.
    w => w.includes('flattened-raster') || /low[- ]resolution/i.test(w)
  );
}

/**
 * True when Track B (page rasters) is empty — extraction ran on text alone, with no vision pass
 * to verify layout, columns, or anything visual. Structural (checks `images.length`), not a
 * warning-text match, so it can't silently break the way `bundleImpliesLowLegibility` did above.
 */
export function bundleUsedTextOnlyFallback(bundle: Pick<DocumentBundle, 'images'>): boolean {
  return bundle.images.length === 0;
}

export interface ProcessingFile {
  id: string;
  file: File;
  status: 'pending' | 'converting' | 'detecting' | 'extracting' | 'editing' | 'completed' | 'error';
  progressMsg?: string;
  error?: string;
  result?: LogicModel;
  /** Non-blocking fidelity warnings from document conversion (e.g. low source resolution). */
  warnings?: string[];
  /** User dismissed the mismatch / unmapped review banner for this file. */
  mismatchBannerDismissed?: boolean;
  /** Session: user dismissed the extraction-fidelity banner for this file. */
  fidelityBannerDismissed?: boolean;
  /**
   * Session: user confirmed coding export despite partial/low fidelity.
   * Reset on re-extract / Retry.
   */
  codingExportFidelityAck?: boolean;
  /**
   * When extract abstains: structured blockers for the error panel.
   * `status` is `error`; `result` stays undefined (not editable).
   */
  extractionBlockers?: string[];
  /**
   * Session-only page rasters for side-by-side source review (from `DocumentBundle.previewImages`).
   * Cleared on Remove. Not exported.
   */
  sourcePreviewImages?: string[];
  /** User collapsed the source pane for this file (session). */
  /** When true (or undefined treated as collapsed in UI), source preview is hidden. Default collapsed. */
  sourcePaneCollapsed?: boolean;
  /**
   * Multi-logic-model split (see `docs/specs/multi-logic-model-pdf-v1.md`). Set together — a file
   * carries all three, or none. `sourceDocumentId` groups siblings split from the same upload
   * (the original upload's own `id`, reused as the group key); `sourcePageRange` is 1-based,
   * inclusive, and refers to page numbers in the *original* uploaded document (not this entry's
   * own re-numbered bundle); `splitPartLabel` is a display string like `"Part 2 of 7"`.
   */
  sourceDocumentId?: string;
  sourcePageRange?: { start: number; end: number };
  splitPartLabel?: string;
  /**
   * Set by the "Treat as one logic model" revert action (or could be set some other way in
   * future) — when a file with this flag reaches conversion, the multi-logic-model detection
   * pre-pass is skipped entirely and it's extracted as a single logic model, exactly like the
   * pipeline behaved before this feature existed.
   */
  forceSingleModel?: boolean;
}
