export type QualityRating = 'Strong' | 'Adequate' | 'Weak';

export interface LogicModelItem {
  text: string;
  critique?: string;
  rating?: QualityRating;
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
  overallQuality?: OverallQuality;
}

export interface ProcessingFile {
  id: string;
  file: File;
  status: 'pending' | 'converting' | 'extracting' | 'analyzing' | 'editing' | 'completed' | 'error';
  progressMsg?: string;
  error?: string;
  result?: LogicModel;
}
