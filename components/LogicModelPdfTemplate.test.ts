import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const templatePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'LogicModelPdfTemplate.tsx'
);

/**
 * Tailwind v4 compiles its numbered palette to oklch(), which html2canvas 1.4.1
 * refuses to parse — it throws and the PDF export fails silently for the user.
 * bg-white, text-white and the shadow utilities stay safe because they resolve
 * to rgb/rgba, so only the numbered shades are banned here.
 */
const NUMBERED_PALETTE_UTILITY =
  /\b(?:text|bg|border|ring|divide|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

test('PDF template avoids Tailwind palette colors that html2canvas cannot parse', () => {
  const source = readFileSync(templatePath, 'utf8');
  const matches = source.match(NUMBERED_PALETTE_UTILITY) ?? [];

  assert.deepEqual(
    matches,
    [],
    `Found Tailwind palette utilities in the PDF template: ${[...new Set(matches)].join(', ')}. ` +
      'These compile to oklch() and make html2canvas throw during export. Use an explicit hex value instead.'
  );
});
