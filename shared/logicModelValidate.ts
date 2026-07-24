import type { LogicModel } from '../types';

export const REQUIRED_LOGIC_MODEL_KEYS: (keyof LogicModel)[] = [
  'organization',
  'program',
  'mission',
  'targetPopulation',
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'impact',
];

export function validateLogicModel(parsed: unknown): LogicModel {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI response is not a valid LogicModel object.');
  }

  const model = parsed as Record<string, unknown>;
  const missing = REQUIRED_LOGIC_MODEL_KEYS.filter(key => !(key in model) || model[key] == null);
  if (missing.length > 0) {
    throw new Error(`AI response missing required LogicModel fields: ${missing.join(', ')}`);
  }

  return parsed as LogicModel;
}

export function parseLogicModelResponse(text: string | undefined): LogicModel {
  if (!text) throw new Error('No response from AI.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AI response was not valid JSON.');
  }
  return validateLogicModel(parsed);
}
