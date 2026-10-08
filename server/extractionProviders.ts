/**
 * The registry: provider id → implementation.
 *
 * Separate from `server/extractionProvider.ts` on purpose. That module is configuration and types,
 * and is imported by scripts and tests that have no business pulling a vendor client into their
 * process; this one is the only place that imports both implementations, so the dependency runs in
 * one direction and adding a third provider touches one table.
 */
import { extractLogicModelOnServer } from './geminiLogicModel.js';
import { detectLogicModelGroupsOnServer } from './geminiLogicModelGroups.js';
import {
  detectLogicModelGroupsOnAnthropic,
  extractLogicModelOnAnthropic,
} from './anthropicLogicModel.js';
import {
  apiKeyVarFor,
  extractionProviderId,
  type ExtractionProvider,
  type ProviderId,
} from './extractionProvider.js';

const gemini: ExtractionProvider = {
  id: 'gemini',
  apiKeyVar: apiKeyVarFor('gemini'),
  // `config.seed`, derived from the document by `server/geminiSeed.ts`. Google's own contract is
  // "mostly deterministic... not a guaranteed absolute deterministic behavior", which is what the
  // census measures rather than assumes.
  supportsSeed: true,
  extract: extractLogicModelOnServer,
  detectLogicModelGroups: detectLogicModelGroupsOnServer,
};

const anthropic: ExtractionProvider = {
  id: 'anthropic',
  apiKeyVar: apiKeyVarFor('anthropic'),
  // The Messages API has no seed parameter. Nothing is invented in its place — see the
  // `supportsSeed` doc comment in `server/extractionProvider.ts` for what that costs.
  supportsSeed: false,
  extract: extractLogicModelOnAnthropic,
  detectLogicModelGroups: detectLogicModelGroupsOnAnthropic,
};

const PROVIDERS: Record<ProviderId, ExtractionProvider> = { gemini, anthropic };

/** The configured provider, or a named one — the latter is for tests and for the benchmark. */
export function getExtractionProvider(id: ProviderId = extractionProviderId()): ExtractionProvider {
  return PROVIDERS[id];
}
