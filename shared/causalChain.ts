import type {
  CausalChainCoherence,
  CausalRole,
  LogicModel,
  LogicModelGroup,
} from '../types';
import { groupedDomainHasContent } from './domainPresence.js';

const OUTCOME_DOMAINS: readonly (keyof LogicModel)[] = [
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
];

const DOMAIN_LABELS: Record<string, string> = {
  shortTermOutcomes: 'Short-Term Outcomes',
  mediumTermOutcomes: 'Medium-Term Outcomes',
  longTermOutcomes: 'Long-Term Outcomes',
};

const CAUSAL_ROLES: readonly CausalRole[] = ['outcome', 'mechanism_leak', 'context_leak', 'unclear'];
const LEAK_ROLES: readonly CausalRole[] = ['mechanism_leak', 'context_leak'];
const COHERENCES: readonly CausalChainCoherence[] = ['holds', 'weak', 'broken'];

export function isCausalRole(value: unknown): value is CausalRole {
  return typeof value === 'string' && (CAUSAL_ROLES as readonly string[]).includes(value);
}

export function isCausalChainCoherence(value: unknown): value is CausalChainCoherence {
  return typeof value === 'string' && (COHERENCES as readonly string[]).includes(value);
}

export interface CausalChainGuardrailThresholds {
  /** Absolute count of leak-classified present-outcome items that forces the ceiling. */
  minLeakCount: number;
  /** Share of leak-classified present-outcome items that forces the ceiling. */
  minLeakRatio: number;
}

/** Illustrative defaults — tune from real-doc friction log, same posture as extraction-confidence thresholds. */
export const DEFAULT_CAUSAL_CHAIN_THRESHOLDS: CausalChainGuardrailThresholds = {
  minLeakCount: 2,
  minLeakRatio: 0.25,
};

interface FlaggedItem {
  domain: string;
  text: string;
  role: CausalRole;
}

interface CausalLeakSummary {
  total: number;
  leaks: number;
  flagged: FlaggedItem[];
}

/** Count items (and leaks) across present outcome domains only. */
export function countCausalLeaks(model: LogicModel): CausalLeakSummary {
  let total = 0;
  const flagged: FlaggedItem[] = [];

  for (const domain of OUTCOME_DOMAINS) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    if (!groupedDomainHasContent(field?.content)) continue;
    for (const group of field?.content ?? []) {
      for (const item of group.items) {
        if (!item.text?.trim()) continue;
        total += 1;
        const role = isCausalRole(item.causalRole) ? item.causalRole : undefined;
        if (role && LEAK_ROLES.includes(role)) {
          flagged.push({ domain: DOMAIN_LABELS[domain] ?? domain, text: item.text.trim(), role });
        }
      }
    }
  }

  return { total, leaks: flagged.length, flagged };
}

/** Count present outcome horizons (Short/Medium/Long) — used to sanity-check chain-coherence claims. */
export function countPresentOutcomeHorizons(model: LogicModel): number {
  return OUTCOME_DOMAINS.filter(domain => {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    return groupedDomainHasContent(field?.content);
  }).length;
}

function roleLabel(role: CausalRole): string {
  return role === 'mechanism_leak' ? 'mechanism (program action), not a participant outcome' : 'context/precondition, not a participant outcome';
}

function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Deterministic downgrade-only guardrail on `overallQuality.rating`, driven by structured
 * CMO-lens signals (`causalRole` leaks, `causalChainAssessment.coherence`). Never upgrades a
 * model-assigned Weak/Adequate — only caps a model-claimed Strong when the evidence contradicts it.
 * Mirrors the "server may upgrade severity, never downgrade" asymmetry used for extraction fidelity,
 * applied in the opposite direction (code hardens quality, never softens it).
 * See docs/specs/causal-chain-critique-v1.md.
 */
export function applyCausalChainGuardrail(
  model: LogicModel,
  thresholds: CausalChainGuardrailThresholds = DEFAULT_CAUSAL_CHAIN_THRESHOLDS
): LogicModel {
  if (!model.overallQuality || model.overallQuality.rating !== 'Strong') return model;

  const { total, leaks, flagged } = countCausalLeaks(model);
  const ratio = total > 0 ? leaks / total : 0;
  const leakThresholdHit = total > 0 && (leaks >= thresholds.minLeakCount || ratio >= thresholds.minLeakRatio);

  // Defensive: only trust a `broken` coherence claim when the model actually had ≥2 present
  // horizons to compare — matches the prompt instruction to omit the field otherwise.
  const coherence = isCausalChainCoherence(model.causalChainAssessment?.coherence)
    ? model.causalChainAssessment?.coherence
    : undefined;
  const brokenChain = coherence === 'broken' && countPresentOutcomeHorizons(model) >= 2;

  if (!leakThresholdHit && !brokenChain) return model;

  model.overallQuality.rating = 'Adequate';

  const firstLeak = flagged[0];
  const bullet = firstLeak
    ? `Causal-chain check: "${truncate(firstLeak.text)}" in ${firstLeak.domain} reads as a ${roleLabel(firstLeak.role)} — rating capped below Strong.`
    : 'Causal-chain check: outcome progression across present horizons does not hold — rating capped below Strong.';

  // Keep the rubric's 2-4 bullet cap; guarantee the causal-chain evidence bullet is always visible
  // rather than risking it getting sliced off a full 4-bullet rationale.
  const existing = model.overallQuality.rationale.slice(0, 3);
  model.overallQuality.rationale = [...existing, bullet];

  return model;
}
