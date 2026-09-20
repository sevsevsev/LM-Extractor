# Random sample, batch 2 — invention and completeness

**Date:** 2026-09-20 · **Prompt:** 2026-09-20.6 · **Arm:** vision+text, one pass each · **5 Gemini calls**

## Result

| Document | Source items | Extracted | Invented | Missed |
|---|---|---|---|---|
| Philadelphia Ballet — Dance Chance | 16 | 16 | 0 | 0 |
| Achieve Now | 52 | 52 | 0 | 0 |
| Rock School — RockReach | 63 (vs Track A) | 63 | 0 | 0 |
| 1812 Productions — 1812 Education | 36 | 36 | 0 | 0 |
| Mamadêlê Foundation — Axé Puro | 80 | 80 | 0 | 0 |

**Invention: 0 of 247 items. Completeness: no misses found.**

Combined with batch 1: **0 inventions in 335 items across 9 documents.**

## Method note — the audit instrument was the weak link, again

Three times across sessions 5, 19 and 20 I reported something ABSENT that was present, each time
because the probe was weaker than the data: a single-line grep against multi-line output; a
flattener that walked only group-bearing fields; an exact-substring search against a text track
with hard line breaks mid-phrase.

Absence is the claim a weak instrument manufactures. So this batch used `coverage.mjs`, which
normalises whitespace and quote characters on both sides and checks every item AND the scalar
fields against Track A. It reduced 247 items to 9 strings needing human eyes. All 9 resolved to
correct behaviour. A miss in that tool is not an invention — Track A can legitimately lack what
only the image carries — it means *look at the image*.

## What each document exercised

**Philadelphia Ballet** — the ArtWell template again, with the instruction text replaced by real
content. A stray empty `-` bullet at the foot of Resources was correctly not emitted. The impact
statement, which the rasteriser mangles into overlapping clipped lines, came out complete and
verbatim from Track A.

**Achieve Now** — two things worth keeping. The source genuinely reads `Hjgh rate of volunteer
retention`, typo and all, and the extraction preserved it rather than repairing to "High": this
is the never-repair rule doing exactly the job it exists for, on a case where repairing would
have looked like an improvement. And one Long-Term box renders as pure mojibake
(`! "#$%&''()*+%,*)&$ , '%&)*('-'./'*`) because its font failed to embed; the extraction
recovered the real string, `Volunteers and students receive stronger, more targeted support`,
from Track A. A stray orphan fragment in the PDF's text layer (`Financial / - / Students have a`)
that appears in Track A but nowhere in the visible page was correctly NOT emitted.

**Rock School** — the most demanding document in the corpus so far, and the clearest evidence
that the dual track earns its keep. **Every one of its 5 page images is unreadable mojibake** —
the whole document's font failed to map, so Track B contributed nothing. All 63 items came from
Track A alone, at `partial`/`medium` with a warning. Two of those items are phrases the source
splits across a page boundary with roughly 1,400 characters of unrelated column text between the
halves (`An improved growth` + `mindset, increase in tenacity, confidence, and curiosity`;
`Social emotional learning` + `through community and citizenship`); both were correctly
reassembled. The 5-column School District template (RESOURCES/INPUTS, ACTIVITIES, OUTPUTS,
OUTCOMES, IMPACT) mapped correctly, with the unqualified OUTCOMES column going to
`generalOutcomes` and IMPACT to `impact`.

**1812 Productions** — preserved four source typos verbatim (`Widerner`, `creativty`,
`empowring`, `innaugural`). PROBLEM STATEMENT and CONTEXT / RATIONALE went to `unmapped` with
their headings, which is the 2026-09-20.4 behaviour working.

**Mamadêlê** — the hardest grouping case in the corpus: a 6x6 matrix whose ROWS are core values
(Cultural Preservation, Excellence in Arts & Education, Global Collaboration, Community
Empowerment, Respect for Tradition & Innovation, Diversity & Inclusion) and whose COLUMNS are
logic-model domains. All six row bands became group names inside all six domains, 80 items, no
losses. `Intermediate-Term Outcomes` was correctly read as `mediumTermOutcomes`. The
organisation name kept its diacritics, and no program name was invented from the filename even
though the filename carries one.

## Findings (reported, not fixed)

Four, none of them extraction-quality. See friction log session 20.

1. **DOCX text tracks carry base64 image payloads.** 1812's Track A is 38,994 characters of
   which 33,837 — **87%** — are `data:image/...;base64` blobs and Google-hosted image URLs,
   about 8,400 tokens of noise sent on every extraction call for that document. Root cause:
   `mammoth.convertToHtml` inlines embedded images as data URIs and Turndown renders them into
   the Markdown (`services/fileService.ts:879`); nothing strips them. Base64 cannot be read as
   text by any model, and the same images already go as Track B rasters, so this is pure waste.
   One-line fix available; not applied.

2. **Scalar fields are synthesised, not transcribed, and nothing records that.** 1812's
   `targetPopulation` is a composed sentence stitching a span of PROBLEM STATEMENT to a span of
   CONTEXT / RATIONALE with connective words present in neither. ArtWell's and Philadelphia
   Ballet's were derived from their impact statements. That is 4 of 9 documents. Items carry
   `mappedBy` and `mappingConfidence`; scalars carry nothing, so a downstream reader treating
   `targetPopulation` as quoted text would be wrong and has no way to know.

3. **Model-authored text reaches the operator in the same channel as app-vetted text.** Rock
   School's warning — "This image is low resolution and the grid is dense, so small text may be
   misread" — matches neither `FIDELITY_BLOCKERS.lowRes` nor `lowLegibilityPartial`. Gemini
   wrote it, as `constants.ts:699` asks it to, and `normalizeBlockers` only trims, dedupes and
   caps at 4. The advice is right and the plain-language style holds, but the stated cause is
   wrong (the page is not low-resolution; the font failed to embed, so it is unreadable at any
   DPI) and nothing distinguishes vetted strings from generated ones.

4. **Nothing detects "images present but contributed nothing."** Rock School had 5 page images,
   all useless, and was still handled as a vision extraction. There is a `textOnlyFallback`
   concept for documents with no images, but no signal for images that rendered to garbage. The
   honest label for that document is "read from the text layer; page images could not be
   rendered."

Also observed, too small to act on alone: Achieve Now's Outputs contain two items with identical
text (`Avg Student Gains`), identical group (`General`) and identical every other field. In the
source they sit in two different unnamed boxes, one under the 1:1-model metrics and one under the
small-group metrics. The source boxes have no headings, so there is no sub-heading for the
GROUPING GATE to use, and the distinction survives only as row order.
