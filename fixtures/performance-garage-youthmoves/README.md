# Gold fixture — Performance Garage YouthMoves

Calibration file for multi-column extract fidelity (`docs/specs/tech-multi-column-extract.md`).

## Source document

Owner-held PDF: `Performance Garage Logic Model Template.pptx.pdf` (not committed).

## Files

| File | Purpose |
|------|---------|
| `expected-domains.json` | Placement assertions (domain, group, content substrings) |
| `extract-snapshot.json` | *(optional)* Full `LogicModel` from successful re-run — commit after AC pass |

## Refresh

1. Run extract on source PDF with current prompt.
2. Save result to `extract-snapshot.json`.
3. Run `npm test` — `extractPlacement.test.ts` should pass.

## Status (2026-09-19)

No snapshot committed yet — this session doesn't have the source PDF on disk. The corresponding
test now reports as an explicit `# SKIP` in `npm test` output (was a silent `console.log` + early
return that reported as passing — `docs/specs/codebase-audit-2026-09-19.md` #5), so its
not-yet-validated status is visible rather than hidden.
