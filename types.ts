export type QualityRating = 'Strong' | 'Adequate' | 'Weak';

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
}
