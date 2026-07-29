import type { LogicModel, OverallQuality, QualityRating } from '../types';

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

const QUALITY_RATINGS: readonly QualityRating[] = ['Strong', 'Adequate', 'Weak'];

export function isQualityRating(value: unknown): value is QualityRating {
  return typeof value === 'string' && (QUALITY_RATINGS as readonly string[]).includes(value);
}

/** Normalize and validate overallQuality. When required, missing/invalid throws. */
export function parseOverallQuality(value: unknown, required: boolean): OverallQuality | undefined {
  if (value == null) {
    if (required) throw new Error('AI response missing overallQuality.');
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('overallQuality must be an object with rating and rationale.');
  }
  const raw = value as Record<string, unknown>;
  if (!isQualityRating(raw.rating)) {
    throw new Error('overallQuality.rating must be Strong, Adequate, or Weak.');
  }
  if (!Array.isArray(raw.rationale)) {
    throw new Error('overallQuality.rationale must be an array of strings.');
  }
  const rationale = raw.rationale
    .map(item => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter(Boolean)
    .slice(0, 4);
  if (rationale.length < 2) {
    throw new Error('overallQuality.rationale must include at least 2 non-empty bullets.');
  }
  return { rating: raw.rating, rationale };
}

export function validateLogicModel(
  parsed: unknown,
  options: { requireOverallQuality?: boolean } = {}
): LogicModel {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI response is not a valid LogicModel object.');
  }

  const model = parsed as Record<string, unknown>;
  const missing = REQUIRED_LOGIC_MODEL_KEYS.filter(key => !(key in model) || model[key] == null);
  if (missing.length > 0) {
    throw new Error(`AI response missing required LogicModel fields: ${missing.join(', ')}`);
  }

  const requireOverall = options.requireOverallQuality === true;
  const overallQuality = parseOverallQuality(model.overallQuality, requireOverall);
  if (overallQuality) {
    model.overallQuality = overallQuality;
  } else {
    delete model.overallQuality;
  }

  return parsed as LogicModel;
}

export function parseLogicModelResponse(
  text: string | undefined,
  options: { requireOverallQuality?: boolean } = {}
): LogicModel {
  if (!text) throw new Error('No response from AI.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AI response was not valid JSON.');
  }
  return validateLogicModel(parsed, options);
}
