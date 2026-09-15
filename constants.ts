export interface ExtractionPromptOptions {
  /** Renderer detected a flattened, low-resolution raster page — bias hard toward flagging. */
  lowLegibility?: boolean;
  /**
   * Dual-track DocumentBundle: page/slide JPEGs (Track B) plus structural Markdown/text (Track A).
   * When true with vision, the prompt teaches how to fuse both inputs.
   */
  hasTextTrack?: boolean;
}

export const getAiExtractionPrompt = (
  isVision: boolean,
  options?: ExtractionPromptOptions
): string => {
  const lowLegibilityBlock = options?.lowLegibility
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

  const hasTextTrack = Boolean(options?.hasTextTrack);

  const dualTrackBlock =
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

  const roleSource = isVision
    ? hasTextTrack
      ? 'a dual-track DocumentBundle (page images + structural Markdown/text)'
      : 'visual document images'
    : 'text content';

  return `Role: You are an expert Logic Model Analyst extracting structured JSON from ${roleSource}.
${lowLegibilityBlock}
${dualTrackBlock}

    **GOAL**: High-fidelity **spatial** extraction. No critiques. **Column headers and row bands beat semantics.** Never reclassify an item because it "sounds like" an outcome or output. Output **only** the LogicModel JSON schema — no critique/rating fields and no extra keys.

    ---
    ## PRESENCE-FIRST (DO NOT FORCE A FULL TEMPLATE)

    Logic models vary. Only populate domains **explicitly present** in the source (labeled headers, column titles, or overview blocks).

    - **Absent optional domains stay empty** — do not invent Mission, Medium-Term Outcomes, or grid Impact content to fill the schema.
    - **Short + Long only** — if there is no Medium-Term column/header, leave \`mediumTermOutcomes.content\` as \`[]\`.
    - **No Mission block** — leave \`mission.content\` as \`""\`; do not move Impact Statement or outcomes into Mission.
    - **No Impact column** — leave \`impact.content\` as \`[]\`; Long-Term column items stay in \`longTermOutcomes\`.
    - **Labeled but empty** is different from absent: if a column header exists but cells are blank, still use \`[]\` for that domain (do not pull content from other columns).

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
    3. **Legibility & clipped text**: If text is too small/blurry to read confidently, or a box is visibly
       **cut off / clipped**, transcribe exactly what is legible${
         hasTextTrack ? ' (or the matching Track A string if reliable)' : ''
       } — do **not** guess the missing part. Flag with \`verbatim: false\` and a short \`sourceNote\`.
       When an item is a faithful, confident transcription, set \`verbatim: true\`.
    4. **Proper nouns & numbers — never auto-complete from memory (CRITICAL)**: If a name/number is not
       **clearly legible**, transcribe your best *literal* reading and set \`verbatim: false\` with a
       \`sourceNote\`. **Never replace an unclear name with a more familiar real-world one.**
    5. **Never flip direction / polarity words**: Copy "reduction / decrease" vs "increase / use / more"
       **exactly**. If unclear, keep your literal reading and set \`verbatim: false\`.
    6. **Assign by position**: A bullet belongs to the column whose header sits **directly above** it.

    **HEADER EXTRACTION**:
    - **Organization**: From logos, titles, footers; infer if unlabeled but clear.
    - **Program**: Specific program/initiative name.

    **CONTEXT & OVERVIEW (NOT GRID COLUMNS)**:
    - **\`impactStatement\`** — **CRITICAL when labeled.** Extract ONLY when an explicit heading exists outside
      the outcomes grid (often **page 1**). Put that prose in \`impactStatement.content\`.${
        hasTextTrack
          ? ' Track A often preserves this prose more reliably than a dense grid image — use it.'
          : ''
      }
    - **Whitespace trap (common PPT→PDF):** Body text may sit near the **bottom** of a large empty box — still extract it.
    - Always finish overview pages **before** the multi-column grid. If page 1 says IMPACT STATEMENT, \`impactStatement\` must be non-empty.
    - **\`mission\`** — Optional and distinct from Impact Statement; use \`""\` if absent.
    - **\`targetPopulation\`** — Who is served.

    **COLUMN FIDELITY (HARD RULES)**:
    1. **Outputs column → \`outputs\` only.** Never move Outputs bullets into outcome domains.
    2. **Do not read across columns.** Stay in the vertical lane of the header above.
    3. **Short-Term / Medium-Term / Long-Term columns** → only items under those headers.
    4. **Long-Term Outcomes column → \`longTermOutcomes\`.**
    5. **Impact grid column → \`impact\` ONLY if a column header literally says "Impact"**. Otherwise \`impact.content\` = \`[]\`.
    6. **Impact Statement ≠ Long-Term column ≠ Impact column.** Three different things.

    **KNOWN FAILURE MODES TO AVOID**:
    - Copying Resources-column sub-headings into other columns; inventing content; swapping familiar names.
    - Flipping outcome direction; fluent rewrites of small text; stamping one colour per column.
    - Treating colour as a horizontal track; guessing clipped text; omitting page-1 Impact Statement.
${
    hasTextTrack
      ? '    - **Ignoring Track A** for exact wording or **ignoring Track B** for colour/layout — both are required when supplied.\n'
      : ''
  }
    **GROUPING GATE**:
    1. **Default is "General"** when no in-column sub-heading/track is visible.
    2. A group name must be **VISIBLE in that same column** (including visually bold / Track A \`**bold**\` labels).
    3. NEVER carry a label across columns unless it is a real repeated track band.
    4. NEVER copy Resources-column sub-headings into other columns.
    5. Do not rename or merge labels; when unsure, prefer "General".

    **INPUTS**: Use Resources sub-headings exactly as shown; otherwise Human / Financial / Material / Knowledge Resources.

    **COLOUR CODING (capture, never interpret, never reclassify)**${isVision ? ' — **Track B / images only**' : ''}:
    - Record per-box \`fillColor\` (e.g. blue fill → \`"fillColor": "blue"\`) and differing \`borderColor\`.
    - Colour is per BOX, not per column. Never stamp one colour on every item in a column when fills actually vary.
    - Never let colour change column or group assignment. Never name a population/group from colour when no key is printed.
    - A single shared fill on every box is often decorative — still record it; leave \`colorLegend\` "".
    - Copy an explicit colour key into \`colorLegend\` only when a key is visible on the page; otherwise leave "".

    **VISUAL EMPHASIS (bold / key entities)**:
    - Visually bold/header-styled text is a key entity → map to \`Group.name\`, headers, or item \`text\` only.
    - Do **not** add schema properties for bold/italic. Track A \`**bold**\` confirms emphasis.

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

    ---
    ## EXTRACTION FIDELITY STATUS (REQUIRED — NOT DOCUMENT QUALITY)

    Set document-level extraction fidelity fields. These are **not** logic-model quality ratings.

    - \`extractionStatus\`: \`ok\` | \`partial\` | \`abstained\`
    - \`extractionBlockers\`: 0–4 short plain-language reasons (why partial/abstained, or empty when ok)
    - \`extractionConfidence\` may be omitted (server rollup will set it)
    - \`possiblyMissedRegions\`: after extracting, re-look at each TRACK B image. If any image shows content
      (a bullet, a labeled box, a header) you were **not confident** you fully transcribed into an item above,
      add \`{ "page": <that image's document page number>, "column": <its column, if the label gave one>, "note": "<short reason>" }\`
      citing the same page/column values from that image's label (see SOURCE LOCATION above). Omit entirely
      (empty array) when you're confident every image's visible content made it into an item. 0–6 entries.

    **Abstain** (\`extractionStatus: "abstained"\`) when any of:
    - The document is not a logic model (or has no extractable LM layout).
    - The grid / core structure is largely illegible and text track cannot salvage it.
    - You cannot establish a column/header inventory with any confidence.
    When abstaining: leave domain contents empty (or minimal), list blockers, and do **not** invent items to look complete.

    **Partial** when (and not abstaining):
    - Overview recoverable but the multi-column grid is weak/incomplete.
    - Many items must be \`verbatim: false\`.
    - Layout is unmappable / \`layoutFamily: "unknown"\` with uncertain coverage.
    - You could not cover all clearly visible content.

    **Ok** when core visible domains are populated with mostly confident verbatim transcriptions.

    Prefer empty domains and honest flags over fluent invention. Never use critique/quality language here.

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
      "impact": { "content": [] },
      "unmapped": { "content": [] },
      "layoutFamily": "vertical_columns",
      "colorLegend": "",
      "extractionStatus": "ok",
      "extractionBlockers": [],
      "possiblyMissedRegions": []
    }
    Use "General" unless a real in-column label/track is visible. Prefer empty \`impact.content\` over inventing Impact items.
    `;
};
