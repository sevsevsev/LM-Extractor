/**
 * Minimal XLSX (SpreadsheetML) reader: worksheet XML -> cell grid -> Markdown table.
 *
 * Why Markdown tables and not a flat text dump: a logic model in a spreadsheet IS a grid, and the
 * column a value sits in is the whole signal. Drive's own text rendering of a real partner file
 * (Puentes de Salud, "Results Framework") flattens `WELLNESS | CULTURAL | ACADEMIC` and the three
 * activity descriptions beneath them into one comma run, which destroys exactly the structure the
 * extraction prompt reads. A Markdown table keeps the alignment, and Track A already teaches the
 * model to read Markdown structure.
 *
 * These functions are deliberately pure and string-in/string-out so they can be unit-tested in
 * Node without a browser or a zip — `services/fileService.ts` does the unzipping.
 *
 * Scope: values only. Formulas are read as their cached result, and styling, merges, dates and
 * number formats are ignored — none of them change which column a logic-model item is in.
 */

/** `A1` / `BC12` -> zero-based column index. Returns -1 when the ref is unusable. */
export function columnIndexFromRef(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1];
  if (!letters) return -1;
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&'); // last, so "&amp;lt;" does not become "<"
}

/** Concatenate every `<t>` inside a fragment — rich-text runs split one string across many. */
function textOf(fragment: string): string {
  const parts: string[] = [];
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) parts.push(decodeXmlEntities(m[1]));
  return parts.join('');
}

/** `xl/sharedStrings.xml` -> the shared string table, indexed as cells reference it. */
export function parseSharedStrings(xml: string): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] ? textOf(m[1]) : '');
  return out;
}

/**
 * `xl/worksheets/sheetN.xml` -> a dense grid of cell strings.
 *
 * Sparse sheets are filled with '' so column positions survive: a row that defines only A and D
 * must still put its D value in the fourth column, or the grid silently shifts left and every
 * downstream column assignment is wrong.
 */
export function parseSheetGrid(sheetXml: string, sharedStrings: string[]): string[][] {
  if (!sheetXml) return [];
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    const rowBody = rowMatch[1] ?? '';
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    let autoIndex = 0;

    while ((cellMatch = cellRe.exec(rowBody)) !== null) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const index = ref ? columnIndexFromRef(ref) : autoIndex;
      autoIndex = (index >= 0 ? index : autoIndex) + 1;

      let value = '';
      if (type === 's') {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const i = raw !== undefined ? Number(raw) : Number.NaN;
        value = Number.isInteger(i) && i >= 0 && i < sharedStrings.length ? sharedStrings[i] : '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        value = raw !== undefined ? decodeXmlEntities(raw) : '';
        if (type === 'b') value = value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value;
      }

      if (index >= 0) {
        while (cells.length < index) cells.push('');
        cells[index] = value;
      }
    }
    rows.push(cells);
  }
  return rows;
}

/** Drop fully-empty trailing rows and columns — partner sheets carry a lot of formatting-only padding. */
export function trimGrid(grid: string[][]): string[][] {
  const isBlank = (v: string | undefined) => !v || !v.trim();
  let lastRow = -1;
  let lastCol = -1;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (!isBlank(grid[r][c])) {
        if (r > lastRow) lastRow = r;
        if (c > lastCol) lastCol = c;
      }
    }
  }
  if (lastRow < 0) return [];
  const out: string[][] = [];
  for (let r = 0; r <= lastRow; r++) {
    const row: string[] = [];
    for (let c = 0; c <= lastCol; c++) row.push(grid[r]?.[c] ?? '');
    out.push(row);
  }
  return out;
}

function escapeCell(value: string): string {
  // Newlines inside a cell would break the table row; pipes would fake a column boundary.
  return value.replace(/\s*\r?\n\s*/g, ' — ').replace(/\|/g, '\\|').trim();
}

/**
 * Render a grid as a Markdown table, using the first non-empty row as the header.
 *
 * Markdown needs a header row, and in these documents the first populated row genuinely is one
 * (column titles like WELLNESS / CULTURAL / ACADEMIC). When it isn't, the model still sees every
 * value in its correct column, which is what matters.
 */
export function gridToMarkdownTable(grid: string[][]): string {
  const trimmed = trimGrid(grid);
  if (trimmed.length === 0) return '';
  const width = trimmed[0].length;
  const headerIndex = trimmed.findIndex(row => row.some(cell => cell.trim()));
  if (headerIndex < 0) return '';

  const lines: string[] = [];
  const header = trimmed[headerIndex];
  lines.push(`| ${header.map(escapeCell).join(' | ')} |`);
  lines.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
  for (let r = headerIndex + 1; r < trimmed.length; r++) {
    const row = trimmed[r];
    if (!row.some(cell => cell.trim())) continue; // skip spacer rows
    lines.push(`| ${row.map(escapeCell).join(' | ')} |`);
  }
  return lines.join('\n');
}

export interface XlsxSheet {
  name: string;
  grid: string[][];
}

/**
 * Assemble one or more sheets into a Track A document.
 *
 * Real partner workbooks carry many mostly-empty sheets (one file in the corpus has eight), so
 * blank ones are dropped rather than emitted as empty headings that would read to the model as
 * real but contentless sections.
 */
export function sheetsToMarkdown(sheets: XlsxSheet[]): string {
  const blocks: string[] = [];
  for (const sheet of sheets) {
    const table = gridToMarkdownTable(sheet.grid);
    if (!table) continue;
    blocks.push(`## Sheet: ${sheet.name}\n\n${table}`);
  }
  return blocks.join('\n\n');
}

/** `xl/workbook.xml` -> sheet names in workbook order. */
export function parseSheetNames(workbookXml: string): string[] {
  if (!workbookXml) return [];
  const names: string[] = [];
  const re = /<sheet\b[^>]*\bname="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(workbookXml)) !== null) names.push(decodeXmlEntities(m[1]));
  return names;
}
