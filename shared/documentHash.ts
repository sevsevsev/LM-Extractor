/**
 * A content fingerprint for an uploaded document, so the same document submitted twice under two
 * different filenames is visible in the exports rather than inferred.
 *
 * WHY: the 2026-10-02 batch of 179 documents contained 29 uploaded more than once and 23% duplicate
 * rows, and the only handle any export carried was the filename — which is exactly what differs
 * between two submissions of the same document. Filenames are the operator's own identifier (and
 * now carry partner/program ids as a prefix); this is the one thing the filename cannot tell you.
 *
 * NOT an identity for the logic model. Two re-saves or re-scans of the same document hash
 * differently, and a revision of a logic model is a different document by design. It answers one
 * question only: are these two uploads byte-for-byte the same file?
 */

/**
 * 16 hex characters — the first 64 bits of the SHA-256 digest.
 *
 * Full 64-char digests repeat on every row of a CSV someone reads by eye, and 64 bits is far more
 * than this needs: over a few hundred documents the chance of two distinct documents colliding is
 * around 1 in 10^15. Equality of this prefix means "same file" for every practical purpose here,
 * and it is still a SHA-256 prefix, so it can be recomputed from a file with one shell command.
 */
const HASH_HEX_CHARS = 16;

/**
 * Hex fingerprint of these bytes, or `undefined` when the platform cannot compute one.
 *
 * `crypto.subtle` exists only in a secure context (https, or localhost) — so it is present in
 * production and in local dev, and absent if the app is ever served over plain http from another
 * host. That case returns `undefined` rather than throwing, and the exports then carry an empty
 * cell: empty means UNKNOWN, never "no duplicate" — the same convention `served_model_id` follows
 * in the extraction log.
 */
export async function documentHashFromBytes(bytes: ArrayBuffer): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  try {
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, HASH_HEX_CHARS);
  } catch {
    return undefined;
  }
}

/**
 * Hash a `File`, never throwing: a fingerprint is a diagnostic, so a failure to read the blob must
 * not take the extraction of that document down with it.
 */
export async function documentHashFromFile(file: Blob): Promise<string | undefined> {
  try {
    return await documentHashFromBytes(await file.arrayBuffer());
  } catch {
    return undefined;
  }
}
