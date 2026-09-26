# Post-processing fixtures

Real Gemini answers to the synthetic benchmark documents, captured at the seam between the model's
reply and `normalizeExtractedLogicModel`, with the blessed output of running our six
post-processing passes over each.

`raw/<id>.json` is the model's answer plus the three bundle-derived options normalization takes.
`expected/<id>.json` is what our code makes of it today.

Normalization is a pure function of those two things, so replaying it offline costs nothing and a
diff is attributable to your change alone — unlike a census run, where Gemini's own run-to-run
wobble sits on top of whatever you changed.

```bash
npm run replay              # diff against the blessed output
npm run replay -- --score   # …and score each result against its benchmark answer
npm run replay -- --bless   # accept the current output; say why in the commit message
```

`shared/normalizePipeline.test.ts` asserts the same thing in CI, with no key and no network, and
also that normalization is idempotent — `App.tsx` runs it a second time on the client, so a pass
that is not idempotent would quietly produce a third answer.

Collecting these is described in the header of `scripts/normalize-replay.ts`. Only the synthetic
benchmark documents may be collected: a raw answer carries the document's own wording, and a
client document's wording must never enter the repository.
