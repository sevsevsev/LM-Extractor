export interface LogicModelItem {
  text: string;
  critique?: string;
  rating?: 'Strong' | 'Adequate' | 'Weak';
}

export interface LogicModelGroup {
  name: string;
  items: LogicModelItem[];
}

export interface LogicModelField<T> {
  content: T;
  critique?: string;
  rating?: 'Strong' | 'Adequate' | 'Weak';
}

export interface LogicModel {
  organization: string;
  program: string;
  mission: LogicModelField<string>;
  targetPopulation: LogicModelField<string>;
  inputs: LogicModelField<LogicModelGroup[]>;
  activities: LogicModelField<LogicModelGroup[]>;
  outputs: LogicModelField<LogicModelGroup[]>;
  shortTermOutcomes: LogicModelField<LogicModelGroup[]>;
  mediumTermOutcomes: LogicModelField<LogicModelGroup[]>;
  longTermOutcomes: LogicModelField<LogicModelGroup[]>;
  impact: LogicModelField<LogicModelGroup[]>;
}

export interface ProcessingFile {
  id: string;
  file: File;
  status: 'pending' | 'converting' | 'extracting' | 'analyzing' | 'editing' | 'completed' | 'error';
  progressMsg?: string;
  error?: string;
  result?: LogicModel;
}
