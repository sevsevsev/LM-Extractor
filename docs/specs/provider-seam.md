# The provider seam

**Status:** draft, Gemini path shipped and measured, Anthropic path written and never run.
**Date:** 2026-10-08.

## What this is

`LM_EXTRACT_PROVIDER` chooses which vendor answers the two calls this app makes. Default `gemini`,
which is the shipped and measured behaviour; `anthropic` is the second implementation, behind the
same interface.

```
LM_EXTRACT_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run dev
LM_EXTRACT_PROVIDER=anthropic npm run benchmark:accuracy
```

| Variable | Default (gemini) | Default (anthropic) |
|---|---|---|
| `LM_EXTRACT_PROVIDER` | `gemini` | — |
| `LM_EXTRACT_MODEL` | `gemini-flash-latest` | `claude-opus-5-5` |
| `LM_DETECT_MODEL` | `gemini-flash-latest` | `claude-haiku-5-5` |
| API key | `GEMINI_API_KEY` | `ANTHROPIC_API_KEY` |
| `LM_EXTRACT_THINKING_LEVEL` | unset (model default) | not used |
| `LM_EXTRACT_EFFORT` | not used | unset (model default) |

Neither Anthropic default has been scored by this repo's benchmark through this code path. They
are a starting point for a measurement, not a recommendation.

## Why it exists

`server/geminiModelConfig.ts` (PR #39) made the *model* a setting. It did not make the *provider*
one: `server/apiCore.ts` imported the Gemini implementation directly and read `GEMINI_API_KEY` by
name, so running on another vendor still required the first vendor's key to be present, which is
not a seam.

The question came due on 2026-10-07. On the 17 invented benchmark decks — same prompt text, same
response schema, same post-processing, the same scorer, the same bundles captured that day:

| | recall | precision | placement | items |
|---|---|---|---|---|
| `gemini-flash-latest` → `gemini-3.8-flash`, pass 1 | 89.1% | 100% | 100% | 222 / 220 |
| same, pass 2 | 89.1% | 100% | 100% | 222 / 220 |
| Claude, hand-run, one pass | 100.0% | 100% | 100% | 247 / 220 |

Fifteen decks tied at 100%. The entire gap is two decks — `inline-colon-labels` (Gemini 1 of 15)
and `theory-of-change-own-voice` (Gemini 1 of 11), which are the two the open collapse bug already
affects.

### What that measurement does not establish

Stated here because the number will outlive the memory of how it was taken.

- **The Claude side was not an API call.** There was no Anthropic key in the container, so the
  extraction was performed by hand from the same bundles under the same prompt, then scored with
  `shared/extractionScore.ts`. It is one pass and cannot be resampled the way an API call can.
- **Those two decks were contaminated.** Gemini's pass-1 output printed its `MISS` lines, with
  expected item text and expected domain, before the Claude extraction was produced — six items on
  each of exactly the two decks where the sides differ. The wording was already in the text track,
  so only the domain placement leaked, but the one result that differs is the one result that is
  not blind.
- **Nothing about real documents.** The invented decks reproduce neither of the two real-document
  failures found in the week before, except the two PR #38 added. A good benchmark score has
  already let one bad change through (PR #36, reverted by #37).
- **The prompt is an artifact of Gemini's failure history.** Most of its rules exist because one
  model did one wrong thing once. Anthropic's guidance on current models is that prompts written
  for an earlier model are often too prescriptive and reduce quality, so a fair trial of the other
  vendor probably means removing rules rather than porting all of them.
- **Cost was measured separately and is not the deciding factor at this corpus size.** Measured
  from `usageMetadata` over the same 17 decks: mean 8,708 input and 2,185 billed output tokens per
  document. Over 103 documents that is about $1.52 on Gemini 3.8 Flash and about $3.07 on Claude
  Sonnet 5.5 with the prompt cached. Google's introductory rate doubles on 2027-01-01.

## Shape

```
apiCore.handleExtractRequest
  → extractionProviderId()            server/extractionProvider.ts   (config + types, no vendors)
  → getExtractionProvider()           server/extractionProviders.ts  (the one table)
  → provider.extract(apiKey, bundle)  server/geminiLogicModel.ts | server/anthropicLogicModel.ts
  → parseLogicModelResponse → normalizeExtractedLogicModel          (unchanged, provider-blind)
```

Everything below the seam is a pure function of what came back and never learns there was a
choice. The extract response now also carries `provider`, for the same reason it carries
`servedModelId`: a number filed without the (provider, model, prompt) triple it came from is a
number nobody can use later.

## The seed, which is the one real difference

Gemini takes `config.seed`, and `server/geminiSeed.ts` derives one from the document content, so
the same document re-run gets the same seed. The Messages API has no seed parameter and no
equivalent.

`npm run census` and `npm run regression:check` both rest on "same document, same answer" — the
census compares two runs with each other, the regression set diffs today's output against a
blessed snapshot. On a provider where `supportsSeed` is `false`, both are measuring something
weaker: agreement is a weaker signal and disagreement is not by itself a regression.

The decision taken here is to **report that, not paper over it**. `ExtractionProvider.supportsSeed`
is a capability, the benchmark prints a line saying passes were not pinned when it is false, and
nothing invents a substitute. For a utility whose output a person signs off in front of a client,
losing reproducibility is a real cost that no accuracy number shows.

## Known gaps in this draft

1. **The Anthropic path has never made a live call.** It is written against Anthropic's documented
   request and response shapes and typechecks; `server/anthropicLogicModel.test.ts` covers request
   construction and response reading, which is the only part a test here can honestly cover. The
   first real run needs a machine with a key.
2. **It uses `fetch`, not `@anthropic-ai/sdk`.** `AGENTS.md` makes a new npm package an escalation,
   and this landed as a draft rather than with a dependency already added. The SDK is the better
   home once that is agreed; the swap is contained to one file.
3. **`shared/friendlyError.ts` still names Gemini** in its key and rate-limit messages. It is a
   client module and cannot see the server's provider, so a missing `ANTHROPIC_API_KEY` reaches the
   user as the server's own (correct) message, but a 401 or 429 from Anthropic would be described
   as a Gemini problem. Worth a pass before anyone runs on Anthropic in front of a client.
4. **Only extraction has been reasoned about carefully.** The page-group pre-pass is ported for
   completeness so that switching provider does not still require a Gemini key, but it has had no
   measurement at all on the Anthropic side.
