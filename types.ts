export type QualityRating = 'Strong' | 'Adequate' | 'Weak';

/** Document-level extraction fidelity — not LM document quality (`overallQuality`). */
export type ExtractionStatus = 'ok' | 'partial' | 'abstained';
export type ExtractionConfidence = 'high' | 'medium' | 'low';

export interface ExtractionFidelity {
  status: ExtractionStatus;
  confidence: ExtractionConfidence;
  /** 0–4 plain-language reasons; empty when ok + high with nothing to note */
  blockers: string[];
}

export interface LogicModelItem {
  text: string;
  critique?: string;
  rating?: QualityRating;
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
  critique?: string;
  rating?: QualityRating;
}

/** Model-level qualitative assessment — see docs/specs/lm-quality-rubric.md */
export interface OverallQuality {
  rating: QualityRating;
  rationale: string[];
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
  impact: LogicModelField<LogicModelGroup[]>;
  /**
   * Free-text capture of a colour key/legend when the source document explicitly provides one
   * (e.g. "Orange = students; Purple = families"). Empty/absent when no legend is shown — colours
   * are then recorded per item without an inferred meaning. See docs/specs/extraction-provenance-and-color.md.
   */
  colorLegend?: string;
  overallQuality?: OverallQuality;
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
   * Extraction fidelity (separate from overallQuality). See `extraction-confidence-v1.md`.
   * Flat fields for Gemini schema / CSV; use helpers in `shared/extractionFidelity.ts`.
   */
  extractionStatus?: ExtractionStatus;
  extractionConfidence?: ExtractionConfidence;
  extractionBlockers?: string[];
}

/** Locates one extract JPEG within the source document (1-based page / column). */
export interface SourceImageRef {
  page: number;
  column?: number;
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

/** Canonical warning when image-dominant / flattened pages are present (drives extract prompt). */
export const LOW_LEGIBILITY_WARNING =
  'Source includes flattened-raster page(s); small text may be misread.';

export function bundleImpliesLowLegibility(bundle: Pick<DocumentBundle, 'warnings'>): boolean {
  return bundle.warnings.some(
    w => w.includes('flattened-raster') || /low resolution/i.test(w)
  );
}

export interface ProcessingFile {
  id: string;
  file: File;
  status: 'pending' | 'converting' | 'extracting' | 'analyzing' | 'editing' | 'completed' | 'error';
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
}
