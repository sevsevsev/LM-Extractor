/**
 * The one funnel every converter's DocumentBundle passes through.
 *
 * Extracted from `services/fileService.ts` for testing. Two invariants live here and nowhere else,
 * and both were bugs once: the low-legibility warning is deduped against `bundleImpliesLowLegibility`'s
 * own matcher rather than a second copy of it, and every Track A is stripped of binary payloads on
 * the way out. A converter that bypassed this function would lose both.
 */
import {
  bundleImpliesLowLegibility,
  LOW_LEGIBILITY_WARNING,
  type DocumentBundle,
  type SourceImageRef,
} from '../types.js';
import { stripBinaryPayloads } from './textTrackHygiene.js';

export function assembleDocumentBundle(
  sourceFormat: DocumentBundle['sourceFormat'],
  images: string[],
  warnings: string[],
  lowLegibility: boolean,
  textTrack: string,
  previewImages?: string[],
  imageRefs?: SourceImageRef[]
): DocumentBundle {
  const mergedWarnings = [...warnings];
  // Dedupe against `bundleImpliesLowLegibility`'s own matcher (types.ts) rather than a second,
  // independent one — a hyphen-only/case-sensitive copy here previously missed the DOCX embedded-image
  // warning's spaced "low resolution" wording, so this pushed LOW_LEGIBILITY_WARNING on top of it
  // instead of deduping — found via codebase audit (docs/specs/codebase-audit-2026-09-19.md #9).
  if (lowLegibility && !bundleImpliesLowLegibility({ warnings: mergedWarnings })) {
    mergedWarnings.push(LOW_LEGIBILITY_WARNING);
  }
  const previews =
    previewImages && previewImages.length > 0
      ? previewImages
      : images.length > 0
        ? images
        : undefined;
  const refs =
    imageRefs && imageRefs.length === images.length
      ? imageRefs
      : images.map((_, i) => ({ page: i + 1 }));
  return {
    images,
    imageRefs: images.length ? refs : undefined,
    previewImages: previews,
    // Every converter's Track A funnels through here, so this is where the invariant "no binary
    // payloads in the text we send to Gemini" is enforced for all of them at once rather than for
    // whichever path was fixed last. See `shared/textTrackHygiene.ts`.
    textTrack: stripBinaryPayloads(textTrack),
    warnings: mergedWarnings,
    sourceFormat,
  };
}
