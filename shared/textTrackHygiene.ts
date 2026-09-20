/**
 * Track A hygiene: keep binary payloads out of the text we send to Gemini.
 *
 * WHY THIS EXISTS: a DOCX with embedded images produced a 38,994-character text track of which
 * 33,837 — 87% — were `data:image/...;base64` blobs and the image URLs used as their alt text
 * (friction-log session 20, 1812 Productions). That is roughly 8,400 tokens of noise sent on every
 * extraction call for that document.
 *
 * Base64 cannot be read as text by any model, so it buys nothing, and the same images already
 * reach Gemini as Track B page rasters, so stripping them loses no information at all. It was
 * invisible: no warning, no failure, just a silently larger bill on documents that happen to
 * embed a logo.
 *
 * `createDocxTurndown` drops image nodes so the DOCX path never emits these in the first place.
 * This function is the backstop applied to EVERY bundle in `assembleDocumentBundle`, so the
 * invariant "Track A contains no binary payloads" holds for any current or future converter
 * rather than for the one path we happened to fix.
 */

/** A markdown image whose source is a data URI — `![alt](data:image/png;base64,...)`. */
const MARKDOWN_IMAGE_DATA_URI = /!\[[^\]]*\]\(\s*data:[^)]*\)/g;
/** A markdown link wrapping a data URI — keep the link TEXT, drop the payload. */
const MARKDOWN_LINK_DATA_URI = /\[([^\]]*)\]\(\s*data:[^)]*\)/g;
/**
 * A bare data URI sitting in the text, in or out of any markup.
 *
 * The payload class deliberately excludes whitespace. An earlier version allowed `\s` inside it,
 * to catch base64 wrapped across lines, and the greedy match then swallowed the ordinary words
 * that followed the blob — caught by the "bare data URI" test below. Wrapped payloads inside
 * markdown are handled by the two rules above, which match to the closing paren, so the cost of
 * this restriction is a possible harmless residue and the benefit is never eating real text.
 */
const BARE_DATA_URI = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+\s*;\s*base64\s*,\s*[A-Za-z0-9+/=]{40,}/gi;
/** Three or more newlines left where a payload used to be. */
const EXCESS_BLANK_LINES = /\n{3,}/g;

/**
 * Remove binary payloads from a Track A string, preserving everything readable.
 *
 * Deliberately unconditional: there is no size threshold below which a base64 blob becomes worth
 * sending, so a small one is stripped the same as a large one.
 */
export function stripBinaryPayloads(textTrack: string): string {
  if (!textTrack || !textTrack.includes('data:')) return textTrack;
  return textTrack
    .replace(MARKDOWN_IMAGE_DATA_URI, '')
    .replace(MARKDOWN_LINK_DATA_URI, '$1')
    .replace(BARE_DATA_URI, '')
    .replace(EXCESS_BLANK_LINES, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/**
 * Characters removed by `stripBinaryPayloads`. Reporting only — nothing branches on this; it
 * exists so the saving is measurable rather than asserted.
 */
export function binaryPayloadChars(textTrack: string): number {
  return textTrack.length - stripBinaryPayloads(textTrack).length;
}
