import type { LogicModelPageGroup } from '../types';

const MAX_GROUPS = 20;

/**
 * Validate/repair Gemini's raw `detect-logic-models` response. Any malformation — bad ranges,
 * gaps, overlaps, out-of-bounds pages, coverage that doesn't start at 1 or end at `pageCount` —
 * collapses to a single group spanning the whole document. This is the same "when unsure, don't
 * split" posture the detection prompt itself is built around, enforced again in code so a
 * malformed or inconsistent response can never fragment a document that should have stayed one
 * logic model. See docs/specs/multi-logic-model-pdf-v1.md.
 */
export function normalizeLogicModelPageGroups(raw: unknown, pageCount: number): LogicModelPageGroup[] {
  const fallback: LogicModelPageGroup[] = [{ startPage: 1, endPage: Math.max(1, pageCount) }];
  if (pageCount < 1) return fallback;
  if (!Array.isArray(raw) || raw.length === 0) return fallback;

  const groups: LogicModelPageGroup[] = [];
  for (const entry of raw.slice(0, MAX_GROUPS)) {
    if (!entry || typeof entry !== 'object') return fallback;
    const rec = entry as Record<string, unknown>;
    const startPage = rec.startPage;
    const endPage = rec.endPage;
    if (typeof startPage !== 'number' || typeof endPage !== 'number') return fallback;
    if (!Number.isFinite(startPage) || !Number.isFinite(endPage)) return fallback;
    const s = Math.round(startPage);
    const e = Math.round(endPage);
    if (s < 1 || e < s || e > pageCount) return fallback;
    const labelRaw = rec.label;
    const label = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim().slice(0, 120) : undefined;
    groups.push({ startPage: s, endPage: e, label });
  }

  groups.sort((a, b) => a.startPage - b.startPage);
  if (groups[0].startPage !== 1) return fallback;
  for (let i = 1; i < groups.length; i++) {
    if (groups[i].startPage !== groups[i - 1].endPage + 1) return fallback; // gap or overlap
  }
  if (groups[groups.length - 1].endPage !== pageCount) return fallback;

  return groups;
}
