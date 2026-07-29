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
