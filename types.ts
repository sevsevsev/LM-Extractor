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
  markdown?: string;
  images?: string[]; // For PDF vision processing
  result?: LogicModel;
}

export enum LogicModelColumnId {
  ORGANIZATION = 'organization',
  PROGRAM = 'program',
  MISSION = 'mission',
  TARGET_POPULATION = 'targetPopulation',
  INPUTS = 'inputs',
  ACTIVITIES = 'activities',
  OUTPUTS = 'outputs',
  SHORT_TERM_OUTCOMES = 'shortTermOutcomes',
  MEDIUM_TERM_OUTCOMES = 'mediumTermOutcomes',
  LONG_TERM_OUTCOMES = 'longTermOutcomes',
  IMPACT = 'impact'
}

declare global {
  interface Window {
    pdfjsLib: any;
    mammoth: any;
    JSZip: any;
    TurndownService: any;
  }
}