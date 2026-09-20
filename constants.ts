/**
 * Extraction prompt — the single largest lever on output quality in this app.
 *
 * ## How to change this file
 *
 * Rules here were tuned from expensive real-document batch runs, not from first principles.
 * Each section below carries an EVIDENCE note naming the document and friction-log session that
 * motivated it, so a rule can be judged — and retired — on its record rather than kept forever
 * because nobody remembers why it exists. See `docs/specs/friction-log.md`.
 *
 * Working agreement (see the revision approach agreed 2026-09-19):
 * 1. **One themed change per batch run.** Changing four things at once makes the next batch's
 *    results unattributable, and a batch is expensive.
 * 2. **Bump `PROMPT_VERSION`** on any wording change, then run `npm run prompt:snapshot` and
 *    review the snapshot diff — that diff is the real record of what Gemini's input became.
 * 3. **Prefer procedures to prohibitions.** A rule the model can't verify it's obeying ("never
 *    fabricate a name") has repeatedly failed; a rule with an observable output ("transcribe what
 *    you can read, set `verbatim: false`, add a `sourceNote`") has worked. See the LOW-RESOLUTION
 *    block, which is the pattern that measurably stuck (friction-log session 3).
 * 4. **Prune before adding.** These prompts run 20–25k characters; rules compete for attention.
 */

/**
 * Bump on ANY change to extraction prompt wording. Emitted into the extraction-log CSV
 * (`services/extractionLogExport.ts`) so a batch's results can be attributed to the exact prompt
 * that produced them. Format: `YYYY-MM-DD.N`.
 */
export const PROMPT_VERSION = '2026-09-20.1';

/** Same contract as `PROMPT_VERSION`, versioned separately — different call, different failure mode. */
export const DETECT_PROMPT_VERSION = '2026-09-19.1';

export interface ExtractionPromptOptions {
  /** Renderer detected a flattened, low-resolution raster page — bias hard toward flagging. */
  lowLegibility?: boolean;
  /**
   * Dual-track DocumentBundle: page/slide JPEGs (Track B) plus structural Markdown/text (Track A).
   * When true with vision, the prompt teaches how to fuse both inputs.
   */
  hasTextTrack?: boolean;
}

export interface PromptVariantInput {
  isVision: boolean;
  hasTextTrack: boolean;
  lowLegibility?: boolean;
}

/**
 * Short label for the prompt variant a document actually received.
 *
 * `getAiExtractionPrompt` emits materially different text depending on these flags (currently 6
 * reachable combinations, 20.5k–24.7k characters). Pooling documents that got different prompts
 * into one error rate makes that rate uninterpretable, so this label ships in the extraction-log
 * CSV and analysis should group by it. `constants.test.ts` asserts one label ↔ one prompt text.
 */
export function promptVariantLabel(v: PromptVariantInput): string {
  const base = v.isVision ? (v.hasTextTrack ? 'vision+text' : 'vision-only') : 'text-only';
  return v.lowLegibility ? `${base}+lowleg` : base;
}

/**
 * Renderer-triggered block for flattened, low-DPI raster pages.
 *
 * EVIDENCE: Oxford Circle CCDA (friction-log session 3, 2026-07-30) — page 2 is a ~142 DPI
 * embedded raster; the model rewrote small print fluently and reported confidence
 * ("Arts & crafts supplies" → "Therapy curriculum"), flagging 1 of 45 rows against ~11 misreads.
 * This block is the project's most successful rule shape: it states a *procedure* with an
 * observable output rather than a prohibition. Session 3 confirmed the polarity/scope rules from
 * the same round actually held.
 * RETIRE IF: two consecutive batches show no fluent-rewrite errors on low-DPI documents.
 */
const lowLegibilitySection = (on: boolean): string =>
  on
    ? `
    **⚠ LOW-RESOLUTION SOURCE (renderer-detected) — FLAGGING IS MANDATORY**:
    This document contains at least one **flattened, low-resolution image page**. At this resolution you
    **cannot** reliably read small text, so confident-looking guesses are the main risk.
    - **Default \`verbatim\` to \`false\`** for any item that contains a proper noun (organization, person,
      institution, curriculum, or program name), a number/quantity, or a duration. Only set
      \`verbatim: true\` when the glyphs are genuinely unambiguous at this resolution.
    - Add a short \`sourceNote\` on every flagged item (e.g. "low-resolution source — verify name").
    - **Prefer a partial transcription over a complete-looking guess.** If a bullet is only half legible,
      transcribe the legible half and flag it; do not produce a fluent phrase you cannot actually read.
    - Never "repair" an odd-looking phrase into a more idiomatic one. Odd wording is usually the real wording.
`
    : '';

/**
 * Input-shape section: how to fuse Track A (structural text) and Track B (page rasters), or what
 * to do when only one is present.
 *
 * EVIDENCE: dual-track ingest spec, `docs/specs/tech-multi-column-extract.md`. Track A exists
 * because vision alone mis-transcribes dense grids; Track B exists because text alone loses
 * column position and colour.
 */
const inputTracksSection = (isVision: boolean, hasTextTrack: boolean): string =>
  isVision && hasTextTrack
    ? `
    ---
    ## DUAL-TRACK INPUT (DocumentBundle) — READ BEFORE EXTRACTING

    You receive **two complementary tracks** of the **same** document. Fuse them; do not pick only one.

    ### Track A — Structural text / Markdown (\`textTrack\`)
    Appears in a labeled **TRACK A** block in this message (headings, lists, bold markers, slide/page prose).
    **Rely on Track A for:**
    - **Exact string matching** — prefer Track A wording for item \`text\` when it matches what you see on the page
      (especially Impact Statement, Mission, headers, and long prose). Copy strings; do not "improve" them.
    - **Hierarchical structure** — Markdown headings (\`#\` / \`##\` / \`###\`), list nesting, and \`**bold**\` /
      \`*italic*\` markers indicate section labels, group names, and emphasis. Use those labels when they align
      with a visible column/section in the images.
    - **Completeness check** — if Track A lists a bullet or labeled section that is hard to read in the images,
      still extract it (set \`verbatim: false\` + \`sourceNote\` when the image is unclear).

    ### Track B — Page / slide images (\`images\`)
    JPEG rasters (full pages, slides, and/or zoomed column crops).
    **Rely on Track B for visual semantics that text alone cannot provide:**
    - **Spatial layout** — column lanes, row bands, which bullet sits under which header (position still wins).
    - **Cell / box fill colour** — if a cell or box has a coloured fill (e.g. blue, orange, purple), record it in
      that item's \`fillColor\` metadata (plain colour name or hex). Example: blue fill → \`"fillColor": "blue"\`.
      Colour never changes column assignment.
    - **Border colour** — if the outline differs from the fill, record \`borderColor\`.
    - **Colour legend** — if a key is visible on the page, copy it into top-level \`colorLegend\`; otherwise leave "".
    - **Visual emphasis** — text that is **visually bold**, heavier weight, or clearly header-styled on the page
      is a **key entity**: prefer it as a column/section header, \`Group.name\`, or high-salience item label —
      never invent a new JSON field for bold. If Track A marks the same phrase with \`**bold**\`, treat that as
      confirming emphasis.
    - **Charts, icons, colour blocks, and table grid lines** — use images when Track A omits them.

    ### Conflict resolution
    1. **Wording:** Track A exact strings win when they clearly refer to the same visible cell/bullet as Track B.
    2. **Column / domain assignment:** Track B spatial position (header above the cell) wins over Track A order alone.
    3. **Colour / bold / layout chrome:** Track B only — Track A has no reliable colour.
    4. **Never fabricate** to reconcile tracks. If tracks disagree and you cannot resolve, transcribe the clearer
       source, set \`verbatim: false\`, and note the conflict briefly in \`sourceNote\`.
`
    : isVision
      ? `
    ---
    ## VISION INPUT
    You receive page/slide images only (no separate text track). Extract from what is visible. For coloured
    boxes, set \`fillColor\` / \`borderColor\`. Treat visually bold/header-styled text as key entities (headers or
    group names), not as a new schema field.
`
      : `
    ---
    ## TEXT-ONLY INPUT (Track A)
    You receive structural document text / Markdown only (no page images). Extract from headings, lists, and
    emphasis in the text. Leave \`fillColor\` / \`borderColor\` / \`colorLegend\` empty unless the text explicitly
    states a colour key. Bold Markdown (\`**…**\`) marks key entities / headers.
`;

/**
 * Goal + presence-first policy (don't invent domains to fill the schema).
 *
 * EVIDENCE: `docs/specs/structure-aware-extract.md` (owner decisions 2026-07-28). Forcing a full
 * template was producing invented Mission / Medium-Term / Impact content on documents that simply
 * don't have those columns.
 */
const goalAndPresenceFirstSection = `

    **GOAL**: High-fidelity **spatial** extraction. No critiques. **Column headers and row bands beat semantics.** Never reclassify an item because it "sounds like" an outcome or output. Output **only** the LogicModel JSON schema — no critique/rating fields and no extra keys.

    ---
    ## PRESENCE-FIRST (DO NOT FORCE A FULL TEMPLATE)

    Logic models vary. Only populate domains **explicitly present** in the source (labeled headers, column titles, or overview blocks).

    - **Absent optional domains stay empty** — do not invent Mission, Medium-Term Outcomes, or grid Impact content to fill the schema.
    - **Short + Long only** — if there is no Medium-Term column/header, leave \`mediumTermOutcomes.content\` as \`[]\`.
    - **No Mission block** — leave \`mission.content\` as \`""\`; do not move Impact Statement or outcomes into Mission.
    - **No Impact column** — leave \`impact.content\` as \`[]\`; Long-Term column items stay in \`longTermOutcomes\`.
    - **Labeled but empty** is different from absent: if a column header exists but cells are blank, still use \`[]\` for that domain (do not pull content from other columns).
`;

/**
 * Phase A — build a layout map (column header inventory, row/track inventory) before extracting.
 *
 * EVIDENCE: Performance Garage YouthMoves + Oxford Circle (friction-log sessions 1–3). Session 1's
 * worst failure was inventing horizontal "tracks" from colour coding and copying the Resources
 * column's sub-headings across every other column. The "colour is NOT proof of a track" rule and
 * the "most logic models have NO tracks" default both come directly from that.
 * The alternate-outcome-taxonomy guidance (Attitudes/Behaviors/Conditions) was added later for
 * sources that split outcomes on a non-time axis.
 */
const phaseALayoutMapSection = (isVision: boolean, hasTextTrack: boolean): string => `
    ---
    ## PHASE A — LAYOUT MAP (DO THIS FIRST — BEFORE ANY CONTENT EXTRACTION)

    Mentally (or privately) build a layout map. Do **not** skip this phase.

    0. **Image set / tracks**
       You may receive multiple images for one document: full pages, slides, and/or **zoomed single-column crops**
       (each crop is one column, top-to-bottom, including that column's header, given left→right). Treat
       every image as part of the **same** document. Do **not** count an item twice if it appears in more
       than one image (e.g. both a full page and a column crop of that page).
${
  isVision && hasTextTrack
    ? `       When Track A is present, skim it for heading inventory and exact strings, then map those labels onto
       Track B column positions. Do not assign domains from Track A reading order alone.
`
    : ''
}
    1. **Page roles**
       - Which page(s) have overview prose (Impact Statement / Mission)?
       - Which page(s) have the multi-column logic-model **grid**?

    2. **Column header inventory (left → right)**
       List every visible grid column header in order. Typical set:
       Resources/Inputs | Activities | Outputs | Short-Term Outcomes | Medium-Term Outcomes | Long-Term Outcomes | (optional) Impact
       Record **exactly** which headers exist. If the rightmost header is **"Long-Term Outcomes"** and there is **no** column titled **"Impact"**, then there is **no Impact column**.
       **Outcome columns that are not short/medium/long-term** — a single combined "Outcomes" header,
       or a different organizing axis entirely (e.g. "Attitudes" / "Behaviors" / "Conditions") — are
       still outcomes. Record each header exactly as written and route them per COLUMN FIDELITY 7/7b
       below; **do not guess** a time horizon here.
${hasTextTrack ? '       Cross-check header strings against Track A headings when present.\n' : ''}
    3. **Row / track inventory (top → bottom) — ONLY IF REAL**
       A "track" is a horizontal band with the **same label** that lines up across MULTIPLE columns
       (e.g., "YouthMoves at FLC", "Summer Intensive", "Student Produced Concert" appearing in
       Activities AND Outputs AND outcomes at the same vertical row).
       - **Most logic models have NO tracks.** If you cannot point to a repeated band label that spans
         several columns, there are **no tracks** — do not invent them.
       - **Colour is NOT proof of a track.** Boxes are often colour-coded by a *cross-cutting* dimension
         (e.g. population: students vs. parents vs. staff) that runs **vertically within a column**, not by
         horizontal row. Never turn a colour into a track band. Capture colour separately (see COLOUR CODING).
       - A sub-heading that appears in **one column only** (e.g. resource buckets inside the Resources
         column) is that column's internal grouping — it is **NOT** a track and must never be copied into
         other columns.

    4. **Only after** headers and tracks are identified, extract cell bullets into the matching domain + group.
`;

/**
 * Phase B extraction rules 1–5 (granularity, transcription/legibility/proper-nouns, polarity,
 * positional assignment).
 *
 * EVIDENCE: proper-noun and polarity discipline were added in friction-log session 2 after Oxford
 * Circle produced "(Joseph J. Peter Institute)" → "(St. Christopher's, Peter's Place)" and
 * "Sustained reduction in trauma-related behaviors" → "Sustained use of…". Session 3 confirmed the
 * polarity rule held but the proper-noun rule did not — the same fabrication persisted, unflagged,
 * even though that rule already asked for `verbatim: false` on an unclear name.
 * STATUS (2026-09-19, batch of 10 real documents via fixtures/regression-set/): item-level
 * verbatim:false/sourceNote fired on 1 of 436 items total — confirming the diagnosis at real-document
 * scale, not just the earlier 17-doc census (docs/specs/friction-log.md session 4: 0/718). The old
 * rules 3/4 already had an observable-output shape (they asked for `verbatim: false`) but treated it
 * as the exception to reach for on obvious failure, not the default.
 *
 * 2026-09-19.3 tried to fix that by defaulting `verbatim` to `false` on EVERY item. That version was
 * withdrawn unrun: `verbatim: false` is not just a note to a human, it is the input to the fidelity
 * rollup in `shared/extractionFidelity.ts`, whose thresholds were tuned when `false` was rare.
 * `nonVerbatim / total >= 0.15` pushes `ok` -> `partial`; `>= 0.40` drives confidence to `low`;
 * `low` is `shouldHardStopExtraction`, and `App.tsx` turns a hard stop into `status: 'error'` with
 * `result: undefined` — the extraction is DISCARDED. Replaying the ten committed baselines through
 * the real rollup with every item flagged puts 9 of 10 into that state. So .3 had no safe operating
 * point: under 15% flagging it changes nothing, at 40% it throws the batch away, and it asked for
 * 100%. The more it worked, the worse the outcome.
 *
 * Rule 3 here (2026-09-19.4) keeps the .3 insight — flagging is a procedure, not a last resort —
 * but bounds the trigger to something the model can actually perceive: "did I read this, or did I
 * reconstruct it?". That matters because the file header's prohibition-vs-procedure framing is
 * slightly too broad. Rule 4 (polarity) is a pure prohibition and session 3 confirmed it HELD,
 * because "reduction" vs "increase" is a discrete, visible lexical choice. "Never fabricate" fails
 * not because it is a prohibition but because its trigger is imperceptible. Reconstruction is
 * perceptible; fabrication-in-the-abstract is not.
 * REVISE IF a batch shows the flagging rate still ~0, or shows it above ~0.4 on documents that were
 * actually legible (that would mean the trigger is reading as "any uncertainty" again, and the
 * rollup arithmetic above applies).
 */
const phaseBExtractionRulesSection = (hasTextTrack: boolean): string => `
    ---
    ## PHASE B — FILL JSON USING THE LAYOUT MAP

    **EXTRACTION RULES**:
    1. **Granularity**: Every bullet / distinct idea = separate item string.
    2. **Transcribe, do not invent (CRITICAL)**: Copy wording as close to the source as possible; do not
       summarize, rephrase, or "improve" it.${
         hasTextTrack
           ? ' Prefer Track A exact strings when they match the same visible cell.'
           : ''
       } **Never add items, partner names, organizations, numbers, or
       details that are not present in the source.** If you are unsure whether something is there,
       leave it out. Inventing plausible-sounding content is the worst possible error.
    3. **Flag every item you reconstructed rather than read.** After writing each item's \`text\`, ask
       one question: did you read every character of it, or did you reconstruct part of it — from
       context, from a familiar real-world name, or from what the phrase "should" say? If any part
       was reconstructed, set \`verbatim: false\` and add a short \`sourceNote\` naming the unclear part
       (e.g. "second word unclear", "partner name not fully legible"). If you read all of it, set
       \`verbatim: true\`. Judge this per item, not per document — a crisp render can still contain a
       small, blurry, or partially clipped box, and proper nouns, numbers, and durations are where
       reconstruction is most likely and most costly.
       - **Clipped or illegible text**: transcribe only what is legible${
         hasTextTrack ? ' (or the matching Track A string if reliable)' : ''
       } — do **not** guess the missing part.
       - **Proper nouns & numbers**: transcribe your best literal reading. **Never replace an unclear
         name with a more familiar real-world one** — a plausible-sounding correction is a worse error
         than an odd-looking verbatim string.
       - **Never "repair" odd-looking wording into something more idiomatic.** Odd wording is usually
         the real wording.
    4. **Never flip direction / polarity words**: Copy "reduction / decrease" vs "increase / use / more"
       **exactly**. If unclear, keep your literal reading and set \`verbatim: false\`.
    5. **Assign by position**: A bullet belongs to the column whose header sits **directly above** it.
`;

/**
 * Header extraction + the overview fields that sit outside the grid (impactStatement, mission,
 * targetPopulation).
 *
 * EVIDENCE: the impactStatement synonym list and the "decide by heading, not by wording" rule come
 * from repeated confusion between a page-level Impact Statement, a grid "Impact" column, and an
 * ordinary Mission statement. The "No heading at all → mission" rule was added after Imagine That
 * Philly had mission prose harvested into impactStatement.
 * NOTE — deliberate, documented exception: `shared/extractNormalize.ts`'s
 * `promoteImpactStatementFromGroupedDomains` may still promote an outcome item into this field
 * without a heading. That is not a violation of the rule above: this rule governs how *Gemini*
 * decides the field from the page it is looking at; that function post-processes Gemini's
 * *output*, under its own narrow `countOutcomeItems <= 3` gate. See that function's comment for
 * the full reasoning (codebase audit #10, docs/specs/codebase-audit-2026-09-19.md).
 */
const contextAndOverviewSection = (hasTextTrack: boolean): string => `
    **HEADER EXTRACTION**:
    - **Organization**: From logos, titles, footers; infer if unlabeled but clear.
    - **Program**: Specific program/initiative name.

    **CONTEXT & OVERVIEW (NOT GRID COLUMNS)**:
    - **\`impactStatement\`** — **CRITICAL when labeled.** Extract ONLY when an explicit heading exists outside
      the outcomes grid (often **page 1**). Organizations label this concept differently — recognize any of
      these as the same field, not just the literal phrase: "Impact Statement", "Intended Impact",
      "Anticipated Impact", "Long-Term Impact", "Ultimate Goal", "Overall Goal", "Goal Statement". They all
      name the same thing (the aggregate, aspirational change the whole effort is oriented toward) under
      different house style — **still a heading-based rule, not a wording-based one**: a heading from this
      list, not aspirational-sounding prose with no heading at all (see "No heading at all" below).
      **Do not confuse with a grid column** — a *column* header that just says "Impact" (part of the
      Inputs→Activities→Outputs→Outcomes→Impact grid) is different from a page-level overview heading in
      this list; that's the \`impact\` grid domain per COLUMN FIDELITY rule 5, never \`impactStatement\`.
      Put matched overview prose in \`impactStatement.content\`.${
        hasTextTrack
          ? ' Track A often preserves this prose more reliably than a dense grid image — use it.'
          : ''
      }
    - **Whitespace trap (common PPT→PDF):** Body text may sit near the **bottom** of a large empty box — still extract it.
    - Always finish overview pages **before** the multi-column grid. If page 1 has any of the impact-statement
      headings above, \`impactStatement\` must be non-empty.
    - **\`mission\`** — Optional and distinct from Impact Statement. **Decide by heading, not by
      wording**: prose under an explicit "Mission" / "Our Mission" / "Purpose" heading goes here —
      regardless of whether it *sounds* forward-looking or aspirational. Plenty of ordinary mission
      statements talk about future benefits ("...so students can achieve...", "...to help families
      thrive...") without being an Impact Statement; the heading is what decides it, not the vocabulary.
      Once you've placed prose under \`mission\` or \`impactStatement\`, do not move it to the other
      field — decide once.
    - **No heading at all** (no "Mission" label and none of the impact-statement headings above appear
      anywhere): put unlabeled overview prose in \`mission\`, never in \`impactStatement\` — that field
      requires an explicit heading from the list above; never infer one from wording alone.
    - **\`targetPopulation\`** — Who is served.
`;

/**
 * Column fidelity hard rules — the positional contract that keeps items in their source column.
 *
 * EVIDENCE: rules 1–6 come from YouthMoves/Oxford Circle miscategorization (friction-log session 1).
 * Rules 7 and 7b (`generalOutcomes`) were added for sources with a single combined outcomes column,
 * and for sources that split outcomes on a non-time axis (Attitudes/Behaviors/Conditions) — both
 * were previously force-fitted into `shortTermOutcomes` by left-to-right position.
 */
const columnFidelitySection = `
    **COLUMN FIDELITY (HARD RULES)**:
    1. **Outputs column → \`outputs\` only.** Never move Outputs bullets into outcome domains.
    2. **Do not read across columns.** Stay in the vertical lane of the header above.
    3. **Short-Term / Medium-Term / Long-Term columns** → only items under those headers.
    4. **Long-Term Outcomes column → \`longTermOutcomes\`.**
    5. **Impact grid column → \`impact\` ONLY if a column header literally says "Impact"**. Otherwise \`impact.content\` = \`[]\`.
    6. **Impact Statement ≠ Long-Term column ≠ Impact column.** Three different things.
    7. **No separate Short/Medium/Long-Term columns → \`generalOutcomes\`, never a guess.** If the source
       has one combined outcomes column/section (a single "Outcomes" header, or no time-horizon
       qualifier at all — not three separate labeled columns), put those items in
       \`generalOutcomes\`, not \`shortTermOutcomes\`. **Never default undifferentiated outcomes into
       \`shortTermOutcomes\` just because it's the first outcomes-shaped field in the schema** — that
       mislabels items a human still needs to sort into a real time horizon. Only use
       \`shortTermOutcomes\`/\`mediumTermOutcomes\`/\`longTermOutcomes\` when the source itself actually
       distinguishes those three (separate columns, or explicit per-item labels).
    7b. **Multiple outcome columns on a non-time axis (e.g. Attitudes / Behaviors / Conditions) →
       \`generalOutcomes\`, one group per column, named after that column's own header.** When a source
       has more than one outcomes-type column/section but none of them is actually a short/medium/
       long-term label, route **all** of them into \`generalOutcomes\` — but give each column's items a
       \`group.name\` equal to that column's own visible header (e.g. \`"Attitudes"\`, \`"Behaviors"\`,
       \`"Conditions"\`), not \`"General"\`, so their own categorization survives for the human who sorts
       these into a time horizon later. Do **not** force-fit them into \`shortTermOutcomes\` /
       \`mediumTermOutcomes\` / \`longTermOutcomes\` by left-to-right position — a differently-named column
       is not a time-horizon guess, however many outcome-shaped columns there are.
`;

/**
 * Known failure modes — a recap list of the errors real documents actually produced.
 *
 * EVIDENCE: every bullet here maps to a logged friction-log failure.
 * NOTE: this section deliberately restates rules stated above. That redundancy was added when
 * recall was poor; it has never been measured against a version without it, and it is the first
 * candidate for the agreed "prune before adding" pass.
 */
const knownFailureModesSection = (hasTextTrack: boolean): string => `
    **KNOWN FAILURE MODES TO AVOID**:
    - Inventing content; swapping an unclear name for a familiar one; guessing clipped text.
    - Flipping outcome direction; fluent rewrites of small text.
    - Stamping one colour per column; treating colour as a horizontal track.
    - Copying Resources-column sub-headings into other columns; omitting page-1 Impact Statement.
    - Guessing a time horizon for outcome columns that do not state one (COLUMN FIDELITY 7/7b).
${
  hasTextTrack
    ? '    - **Ignoring Track A** for exact wording or **ignoring Track B** for colour/layout — both are required when supplied.\n'
    : ''
}`;

/**
 * Grouping gate + Inputs sub-bucket policy.
 *
 * EVIDENCE: Oxford Circle (friction-log session 1) — the only sub-headings in that source are the
 * four Resources buckets, and they were copied across every other column. "Default is General"
 * plus "a group name must be VISIBLE in that same column" fixed it (confirmed session 2).
 * `shared/domainSynonyms.ts` encodes the same sub-bucket list in code.
 *
 * NESTING rules 7-9 (added 2026-09-20.1). EVIDENCE: friction-log session 6, the first controlled
 * A/B (same bundles, each prompt version run twice). `LogicModel` is two levels; real sources are
 * not — Core Reporter's Outputs is three deep, Cub Reporter's outcome columns four
 * ("Core Reporters" > "Students demonstrate improvements in:" > "Academic Skills" > "Writing").
 * Nothing here said how to flatten, so the model picked differently on every run. Four distinct
 * encodings were observed from the same model on the same input: promote the parent to
 * `Group.name`; inline it into each child's text; concatenate parent and all children into one
 * item; or emit the parent as its own sibling item. That single unspecified choice is what
 * produced every symptom chased since session 4 — the "grouping collapse" (Performance Garage's
 * Activities proved BISTABLE under an unchanged prompt), the "redundant group-name prefix", and
 * the Cub Reporter item-count churn the regression README had attributed to seed non-determinism.
 * The two shallow documents were byte-identical across identical runs; only the four-level one
 * churned, which is why depth — not sampling — is the diagnosis.
 *
 * Deliberately NOT a deeper schema: a fixed three levels just moves the cliff (Cub Reporter
 * already needs four), and the deliverable is a flat CSV (`services/codingExport.ts`, one row per
 * item). Determinism, not depth, is what the harness needs. If flattened strings later prove
 * insufficient for coders, the non-recursive upgrade is an optional `subPath?: string[]` on
 * `LogicModelItem` — one field, one CSV column, no consumer rewrites.
 * `shared/nestingConsistency.ts` detects rule-9 violations in output (analysis only, deliberately
 * not wired into the fidelity rollup, so this batch's only change to Gemini's input is wording).
 *
 * MEASURED (session 7, same bundles, this prompt run twice). Cub Reporter — the four-level
 * document that motivated this — went from 118/118 items with 120 lines of re-encoding churn to
 * 113/113 with ZERO item churn, emitting exactly the canonical form ("Academic Skills — Writing",
 * group "Core Reporters"). Core Reporter's items are stable too. Across three documents the
 * same-prompt churn fell from 120 diff lines to 9, none of them item-level.
 *
 * KNOWN GAP, not fixed here: Performance Garage (text-only) is STILL bistable — one run collapsed
 * Activities to "General" with concatenated items, the other produced the three correct bands.
 * The reason is this rule's own trigger: "outermost label carrying NO bullet marker, at the
 * column's left edge" is a VISUAL cue. A text-only document has no column, no left edge, and a
 * PPTX text track that does not reliably carry bullet markers — so the trigger is imperceptible
 * there, exactly the failure mode that sank rule 2. The text-only variant needs the same policy
 * restated over Track A Markdown list depth, which is the information it actually has. That is
 * the next themed change, deliberately not bundled here.
 * RETIRE/REVISE IF a same-prompt control pair shows a nested VISION document churning again.
 */
const groupingGateSection = `
    **GROUPING GATE**:
    1. **Default is "General"** when no in-column sub-heading/track is visible.
    2. A group name must be **VISIBLE in that same column** (including visually bold / Track A \`**bold**\` labels).
    3. NEVER carry a label across columns unless it is a real repeated track band.
    4. NEVER copy Resources-column sub-headings into other columns.
    5. Do not rename or merge labels; when unsure, prefer "General".
    6. **One exception** — COLUMN FIDELITY 7b: for non-time-horizon outcome columns routed into
       \`generalOutcomes\`, the column's own header becomes the group name.

    **NESTING — SOURCES DEEPER THAN TWO LEVELS (follow exactly; do not improvise)**:
    Your output has exactly two levels: \`Group.name\`, and the items under it. Sources are often
    deeper than that. Flatten them the same way every time:
    7. **The group is the outermost label in that column carrying NO bullet marker** — a heading at
       the column's left edge. That string, and only that string, becomes \`Group.name\`.
    8. **A deeper label keeps its words but loses its level.** A *bulleted* label that itself has
       sub-bullets is **not** a group: prefix its text onto each of its own children, joined with
       \` — \` (if the label already ends in \`:\`, keep that colon instead of adding the dash), and
       emit **one item per leaf bullet**. Repeat for any further depth, outermost label first.
    9. **Never emit a parent label as an item of its own**, never merge a parent and its children
       into a single item, and never repeat \`Group.name\` inside an item's \`text\`.
    Worked example — an "Outputs" column containing \`Program Delivery\` (no bullet), \`● Lessons
    delivered to 600 students\`, and \`● Student Publications\` with \`○ 40+ newspapers published\`
    beneath it → group \`"Program Delivery"\`, items \`"Lessons delivered to 600 students"\` and
    \`"Student Publications — 40+ newspapers published"\`. Not a \`"Student Publications"\` item on its
    own; not one item holding the label and every child.

    **INPUTS**: Use Resources sub-headings exactly as shown; otherwise Human / Financial / Material / Knowledge Resources.
`;

/**
 * Colour capture + visual emphasis.
 *
 * EVIDENCE: Oxford Circle (friction-log sessions 1 and 3). Colour is a real cross-cutting axis in
 * that document (orange = student-focused, purple = family-focused) with NO printed legend, and
 * the model first ignored it, then stamped one colour per column. "Colour is per BOX, not per
 * column" comes from session 3, where Activities came back all "blue" for genuinely mixed boxes.
 * `shared/colorAxis.ts` detects the stamped-column failure downstream.
 */
const colourAndEmphasisSection = (isVision: boolean): string => `
    **COLOUR CODING (capture, never interpret, never reclassify)**${isVision ? ' — **Track B / images only**' : ''}:
    - Record per-box \`fillColor\` (e.g. blue fill → \`"fillColor": "blue"\`) and differing \`borderColor\`.
    - Colour is per BOX, not per column. Never stamp one colour on every item in a column when fills actually vary.
    - Never let colour change column or group assignment. Never name a population/group from colour when no key is printed.
    - A single shared fill on every box is often decorative — still record it; leave \`colorLegend\` "".
    - Copy an explicit colour key into \`colorLegend\` only when a key is visible on the page; otherwise leave "".

    **VISUAL EMPHASIS (bold / key entities)**:
    - Visually bold/header-styled text is a key entity → map to \`Group.name\`, headers, or item \`text\` only.
    - Do **not** add schema properties for bold/italic. Track A \`**bold**\` confirms emphasis.
`;

/**
 * Item shape + source-location anchors + unmapped/layout.
 *
 * EVIDENCE: `docs/specs/source-review-v1.md` / `tech-source-review-v1.md`.
 * The SOURCE LOCATION rules depend on `server/geminiLogicModel.ts` labeling each image with its
 * document page/column from `DocumentBundle.imageRefs`. That plumbing was broken (the API layer
 * dropped `imageRefs`), which made every `sourcePage` a guess; fixed 2026-09-19 in
 * `server/apiCore.ts`. If these rules are ever removed, remove the labeling with them.
 */
const itemShapeAndLocationSection = `
    ---
    **ITEM SHAPE** (strict LogicModel schema — no extra keys):
    { "text": "verbatim item text", "verbatim": true | false, "sourceNote": "why to verify",
      "fillColor": "blue", "borderColor": "red",
      "sourcePage": 2, "sourceColumn": 3 }

    **SOURCE LOCATION (when images are labeled with page/column)**:
    - Set \`sourcePage\` to the **document page number** from the image label (1-based), not the image ordinal.
    - Set \`sourceColumn\` only when the label includes a column index (column crops) or the item clearly sits in that grid column.
    - Prefer **omit** \`sourcePage\` / \`sourceColumn\` over guessing.

    **UNMAPPED + LAYOUT**:
    - \`unmapped\` only for clearly non-standard labeled sections (Assumptions, External Factors, etc.).
    - \`layoutFamily\`: \`vertical_columns\` | \`horizontal_rows\` | \`diagram\` | \`prose_sections\` | \`unknown\`.
`;

/**
 * Document-type check — is this actually a logic model?
 *
 * EVIDENCE: Imagine That Philly and After-School All-Stars (2026-09-19) were program brochures with
 * no input/output/outcome structure, and both silently returned `documentTypeAssessment: undefined`
 * and a confident-looking extraction. Two fixes shipped together: the field was added to the Gemini
 * schema's `required` array (prose alone does not bind structured output), and the test here was
 * restated as **structural, not topical** — the earlier closed example list had nothing resembling
 * a brochure to pattern-match against.
 */
const documentTypeCheckSection = `
    ---
    ## DOCUMENT TYPE CHECK (REQUIRED — DO THIS FIRST)

    Partners sometimes submit a document that is **not actually a logic model** — a Theory of Change
    narrative, an impact/outcomes report, a program overview/brochure, a schedule, etc. — even though
    it may share some content with one (a mission statement, a list of outcomes, a target population).
    Do **not** abstain just because the document isn't a clean logic model grid.

    **The test is structural, not topical.** Ask: does the document organize its content into
    labeled input/activity/output/outcome *categories* — as grid columns, explicitly headed sections,
    or an equivalent structure? A document that discusses programs, workshops, activities, or goals in
    ordinary prose or nested bullet lists — without sorting them into those categories — is
    \`"not_logic_model"\`, **even if every individual sentence would be at home in a logic model.**
    Program-related content alone is not evidence of logic-model structure; require the categorization
    itself. (Example: a page of "Workshops" each with a paragraph description, followed by an
    "After-Care" section with a numbered daily schedule, is a program brochure — \`"not_logic_model"\` —
    not a logic model, even though its content is entirely about activities a program runs.)

    - \`documentTypeAssessment\`: \`"logic_model"\` (has recognizable input/output/outcome structure,
      even if imperfect) | \`"not_logic_model"\` (reads as a different document type — ToC narrative,
      impact report, budget, program overview/brochure, schedule, etc.) | \`"unclear"\` (genuinely
      ambiguous — some categorization present but doesn't map cleanly).
    - \`documentTypeNote\`: one short sentence explaining a non-\`"logic_model"\` call (e.g. "Reads as a
      Theory of Change narrative — no input/output/outcome column structure"). Omit when \`"logic_model"\`.
    - When \`"not_logic_model"\` or \`"unclear"\`: still **extract any content that genuinely maps** to the
      LogicModel fields below (mission, target population, outcomes, etc.) — best effort, same verbatim
      rules as always. Leave a field empty rather than force-fitting unrelated prose into it. A human
      will review the flag before trusting the extraction.
`;

/**
 * Extraction fidelity self-report (status / blockers / possibly-missed regions).
 *
 * EVIDENCE: `docs/specs/extraction-confidence-v1.md`. `possiblyMissedRegions` became the ONLY
 * source of the "spot-check for missed content" signal after the client-side line-counting
 * heuristic was removed (2026-09-18) for firing 3-for-3 false positives across a 112-file batch.
 * KNOWN WEAKNESS: self-reported confidence has repeatedly under-fired — Oxford Circle flagged
 * 1 of 45 rows against ~11 real misreads. Generation and self-assessment happen in the same pass,
 * so this section cannot be expected to catch confident fabrication on its own.
 */
const fidelityStatusSection = `
    ---
    ## EXTRACTION FIDELITY STATUS (REQUIRED — NOT DOCUMENT QUALITY)

    Set document-level extraction fidelity fields. These are **not** logic-model quality ratings.

    - \`extractionStatus\`: \`ok\` | \`partial\` | \`abstained\`
    - \`extractionBlockers\`: 0–4 short plain-language reasons (why partial/abstained, or empty when ok)
    - \`extractionConfidence\` may be omitted (server rollup will set it)
    - \`possiblyMissedRegions\`: after extracting, re-look at each TRACK B image. If any image shows content
      (a bullet, a labeled box, a header) you were **not confident** you fully transcribed into an item above,
      add \`{ "page": <that image's document page number>, "xStart": <fraction>, "xEnd": <fraction>, "note": "<short reason>" }\`.
      \`xStart\`/\`xEnd\` are your own visual estimate of that content's horizontal position, as a fraction
      0.0–1.0 of the full page width (e.g. a box roughly a third of the way across to about halfway →
      \`xStart: 0.33, xEnd: 0.5\`) — estimate by eye from the image, do not just repeat a column index.
      Omit \`xStart\`/\`xEnd\` if you can't estimate a horizontal position (page-level flag only). Omit the
      array entirely when you're confident every image's visible content made it into an item. 0–6 entries.

    **Abstain** (\`extractionStatus: "abstained"\`) when any of:
    - The source is largely illegible and text track cannot salvage it — regardless of document type.
    - You cannot establish a column/header inventory with any confidence AND \`documentTypeAssessment\`
      is \`"logic_model"\` (an unclear/non-logic-model document naturally has no such inventory to find —
      that alone is not a reason to abstain; extract what genuinely maps per the DOCUMENT TYPE CHECK above).
    When abstaining: leave domain contents empty (or minimal), list blockers, and do **not** invent items to look complete.

    **Partial** when (and not abstaining):
    - Overview recoverable but the multi-column grid is weak/incomplete.
    - Many items must be \`verbatim: false\`.
    - Layout is unmappable / \`layoutFamily: "unknown"\` with uncertain coverage.
    - You could not cover all clearly visible content.

    **Ok** when core visible domains are populated with mostly confident verbatim transcriptions.

    Prefer empty domains and honest flags over fluent invention. Never use critique/quality language here.
`;

/** Output shape example. Mirrors `extractModelSchema` in `server/geminiLogicModel.ts`. */
const outputFormatSection = `
    **OUTPUT FORMAT** (JSON only — LogicModel schema; no critique/rating fields; no extra keys):
    {
      "organization": "...",
      "program": "...",
      "impactStatement": { "content": "..." },
      "mission": { "content": "" },
      "targetPopulation": { "content": "..." },
      "inputs": { "content": [{ "name": "Frontline Staff", "items": [{ "text": "...", "verbatim": true }] }] },
      "activities": { "content": [{ "name": "General", "items": [{ "text": "...", "verbatim": true, "fillColor": "orange" }] }] },
      "outputs": { "content": [{ "name": "General", "items": [{ "text": "...", "verbatim": true }] }] },
      "shortTermOutcomes": { "content": [{ "name": "General", "items": [{ "text": "...", "verbatim": true }] }] },
      "mediumTermOutcomes": { "content": [{ "name": "General", "items": [{ "text": "...", "verbatim": true }] }] },
      "longTermOutcomes": { "content": [{ "name": "General", "items": [{ "text": "...", "verbatim": true }] }] },
      "generalOutcomes": { "content": [] },
      "impact": { "content": [] },
      "unmapped": { "content": [] },
      "layoutFamily": "vertical_columns",
      "colorLegend": "",
      "documentTypeAssessment": "logic_model",
      "extractionStatus": "ok",
      "extractionBlockers": [],
      "possiblyMissedRegions": []
    }
    Use "General" unless a real in-column label/track is visible. Prefer empty \`impact.content\` over inventing Impact items.
    `;

export const getAiExtractionPrompt = (
  isVision: boolean,
  options?: ExtractionPromptOptions
): string => {
  const hasTextTrack = Boolean(options?.hasTextTrack);

  const roleSource = isVision
    ? hasTextTrack
      ? 'a dual-track DocumentBundle (page images + structural Markdown/text)'
      : 'visual document images'
    : 'text content';

  return (
    `Role: You are an expert Logic Model Analyst extracting structured JSON from ${roleSource}.
${lowLegibilitySection(Boolean(options?.lowLegibility))}
${inputTracksSection(isVision, hasTextTrack)}` +
    goalAndPresenceFirstSection +
    phaseALayoutMapSection(isVision, hasTextTrack) +
    phaseBExtractionRulesSection(hasTextTrack) +
    contextAndOverviewSection(hasTextTrack) +
    columnFidelitySection +
    knownFailureModesSection(hasTextTrack) +
    groupingGateSection +
    colourAndEmphasisSection(isVision) +
    itemShapeAndLocationSection +
    documentTypeCheckSection +
    fidelityStatusSection +
    outputFormatSection
  );
};

/**
 * Cheap pre-pass, run before the main extraction call, deciding ONLY whether an uploaded
 * document contains one logic model or more than one genuinely separate one (e.g. a partner's
 * single PDF with one program's logic model per page). See docs/specs/multi-logic-model-pdf-v1.md
 * for why this is deliberately biased hard toward "still one" — a false split actively breaks a
 * document that should have stayed together, while a false "still one" just reproduces the
 * pipeline's pre-existing single-model behavior, which is not a regression.
 *
 * Versioned separately from `PROMPT_VERSION` (`DETECT_PROMPT_VERSION`): a change here affects
 * split decisions, not extraction content, and the two should not share a version in analysis.
 */
export const getDetectLogicModelGroupsPrompt = (pageCount: number): string => `
    You are shown ${pageCount} page image(s) from ONE uploaded document, in page order, plus its
    structural text when available. Your ONLY job: decide whether this document contains ONE logic
    model, or MORE THAN ONE separate, complete logic model, and report page ranges. Do not extract
    any content — only classify page ranges.

    A "logic model" here means one program's whole package: an overview (organization/program name,
    usually with an impact statement / mission / target population) plus a grid of
    inputs/resources → activities → outputs → outcomes (short/medium/long-term, or a single
    combined column) → optionally impact.

    **DEFAULT: the whole document is ONE logic model.** Most documents ARE one logic model spread
    across multiple pages — e.g. page 1 has the overview/impact statement and page 2 has the grid,
    or a wide grid is printed split across two facing pages. That is normal and still ONE group.
    Do **not** start a new group just because the page layout changes, a page break happens, or a
    new heading appears — a heading like "IMPACT STATEMENT" or "RESOURCES" partway through one
    program's own story is expected, not evidence of a second logic model.

    **Only split when the document clearly restarts for a DIFFERENT program.** Require BOTH of
    these together, not just one:
    1. A different Organization or Program name/title appears (a new section heading alone does
       not count — this must be a genuinely different program identity).
    2. The grid visibly restarts from the beginning (Inputs/Resources again) after a complete grid
       (through Outcomes and/or Impact) was already shown earlier in the document.

    If you are not confident both signals are present, treat the document as ONE logic model. A
    wrong "still one" call costs nothing extra — a human reviews every extraction anyway. A wrong
    "split" call breaks a document that should have stayed together into disconnected pieces. When
    in doubt, do not split.

    Return page ranges that together cover every page **exactly once**, page 1 through page
    ${pageCount}, in order, with no gaps and no overlaps. When a range does start a different
    program and you can confidently read its organization/program name, include it as \`label\`
    (omit \`label\` rather than guess).

    **OUTPUT FORMAT** (JSON only, no extra keys):
    { "groups": [{ "startPage": 1, "endPage": ${pageCount} }] }
    `;
