/**
 * The byte-order mark every CSV download starts with.
 *
 * Excel on Windows does not read the `charset=utf-8` in a blob's MIME type. Without a BOM it
 * decodes the file in the machine's legacy code page, and every character above ASCII in the
 * extracted wording comes out as mojibake: an apostrophe as â€™, an em dash as â€”, the accent in
 * an organisation's name as two wrong letters. 15 of the 17 blessed regression snapshots contain
 * such characters, because Gemini transcribes the document's own typography, so this is the normal
 * case rather than an edge one. Excel, LibreOffice and Google Sheets all read a BOM correctly and
 * do not show it as content, and the downstream coder's intake reads the same file.
 *
 * It is a prefix to the text, not a column, so no header or row changes.
 */
export const CSV_BOM = '﻿';

/** One CSV blob, made the same way for every export. */
export function csvBlob(csv: string): Blob {
  return new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8;' });
}
