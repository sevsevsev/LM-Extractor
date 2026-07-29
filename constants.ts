export const getAiExtractionPrompt = (isVision: boolean): string => {
    return `Role: You are an expert Logic Model Analyst extracting structured JSON from ${isVision ? "visual document images" : "text content"}.

    **GOAL**: High-fidelity **spatial** extraction. No critiques. **Column headers and row bands beat semantics.** Never reclassify an item because it "sounds like" an outcome or output.

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

    1. **Page roles**
       - Which page(s) have overview prose (Impact Statement / Mission)?
       - Which page(s) have the multi-column logic-model **grid**?

    2. **Column header inventory (left → right)**
       List every visible grid column header in order. Typical set:
       Resources/Inputs | Activities | Outputs | Short-Term Outcomes | Medium-Term Outcomes | Long-Term Outcomes | (optional) Impact
       Record **exactly** which headers exist. If the rightmost header is **"Long-Term Outcomes"** and there is **no** column titled **"Impact"**, then there is **no Impact column**.

    3. **Row / track inventory (top → bottom)**
       List horizontal band labels that align across Activities → Outputs → outcome columns
       (e.g., "YouthMoves at FLC", "Summer Intensive", "Student Produced Concert").
       Color-coded rows or shaded strips count as track bands even without a bold title in every cell.

    4. **Only after** headers and tracks are identified, extract cell bullets into the matching domain + group.

    ---
    ## PHASE B — FILL JSON USING THE LAYOUT MAP

    **EXTRACTION RULES**:
    1. **Granularity**: Every bullet / distinct idea = separate item string.
    2. **Verbatim**: Keep wording close to source; do not summarize.
    3. **Assign by position**: A bullet belongs to the column whose header sits **directly above** it (same vertical lane / x-band).

    **HEADER EXTRACTION**:
    - **Organization**: From logos, titles, footers; infer if unlabeled but clear.
    - **Program**: Specific program/initiative name.

    **CONTEXT & OVERVIEW (NOT GRID COLUMNS)**:
    - **\`impactStatement\`** — **CRITICAL when labeled.** Extract ONLY when an explicit heading exists: "Impact Statement", "Intended Impact", or clear equivalent **outside** the outcomes grid (often **page 1**). Put that prose in \`impactStatement.content\`. Do **NOT** put it in \`mission\`, \`impact\`, or outcome domains.
    - **Whitespace trap (common PPT→PDF):** The labeled Impact Statement box may have a large empty region under the header with the body text near the **bottom** of the box. Still extract that bottom prose — do not skip page 1 because the grid is denser on page 2.
    - Always finish reading overview pages **before** filling the multi-column grid. If page 1 says IMPACT STATEMENT, \`impactStatement\` must be non-empty.
    - **\`mission\`** — Optional. "Mission", "Purpose", or "Program Overview" when **distinct** from Impact Statement. Use \`""\` if absent. Never copy Impact Statement text into \`mission\`.
    - **When both exist** — populate both separately.
    - **\`targetPopulation\`** — Who is served.

    **COLUMN FIDELITY (HARD RULES)**:
    1. **Outputs column → \`outputs\` only.** Attendance %, curriculum units implemented, interactions with artists/teachers under the Outputs header stay in \`outputs\` for **every** track row (including Summer and Concert rows). Never move them to Short-/Medium-/Long-Term Outcomes.
    2. **Do not read across columns.** Even if a sentence wraps or a cell is adjacent to outcomes, stay in the vertical lane of the header above.
    3. **Short-Term / Medium-Term / Long-Term columns** → only items under those headers.
    4. **Long-Term Outcomes column → \`longTermOutcomes\`.** If the grid's rightmost (or labeled) column is **"Long-Term Outcomes"** (or "Long Term Outcomes"), put **all** boxes/bullets in that column into \`longTermOutcomes\` — including career, leadership, educational attainment, graduate/tour language.
    5. **Impact grid column → \`impact\` ONLY if a column header literally says "Impact"** (or "Ultimate Impact" as a **column** title). If there is **no** Impact column header, set \`impact.content\` to \`[]\`. Do **not** invent an Impact domain by moving Long-Term Outcomes boxes into \`impact\`.
    6. **Impact Statement ≠ Long-Term column ≠ Impact column.** Three different things.

    **KNOWN FAILURE MODES TO AVOID** (seen on dense PPT→PDF grids):
    - Putting Summer-track Outputs (e.g. "Attendance is maintained…", "Implementation 2…", "Interaction with master teachers") into Medium-Term Outcomes.
    - Putting Concert-track Outputs (e.g. "Student choreography…", "Implementation of FLC Dance…") into Long-Term Outcomes.
    - Putting Long-Term Outcomes column items into \`impact\` when no Impact column exists.
    - Collapsing track groups to "General" for Outputs/outcomes while Activities kept track names — **reuse the same track names** across aligned columns.
    - Copying page-1 Impact Statement into \`mission\` instead of \`impactStatement\`.
    - **Omitting** page-1 Impact Statement entirely because attention stayed on the page-2 grid.

    **HORIZONTAL TRACK BANDS**:
    1. Detect track labels / color bands (e.g., FLC, Summer Intensive, Student Produced Concert).
    2. For \`activities\`, \`outputs\`, \`shortTermOutcomes\`, \`mediumTermOutcomes\`, \`longTermOutcomes\` (and \`impact\` if present): set \`Group.name\` to that track label for horizontally aligned cells.
    3. Same visual row → same \`Group.name\` across those domains. Use "General" only when the source has no tracks.
    4. Inputs may still use Human/Financial/Material/Knowledge resource buckets.

    **INPUTS (when grouping resources)**:
    Categorize into: "Human Resources", "Financial Resources", "Material Resources", "Knowledge Resources".
    Participants/beneficiaries are usually target population, not inputs — but if the source lists them under Resources/Human, extract as shown in the Resources column.

    **WORKED LAYOUT EXAMPLE** (illustrative — match YOUR document's actual headers):
    If headers L→R are: Resources | Activities | Outputs | Short-Term Outcomes | Medium-Term Outcomes | Long-Term Outcomes
    then for track "Summer Intensive":
    - Outputs cell bullets → \`outputs\` / group "Summer Intensive"
    - Short-Term cell bullets → \`shortTermOutcomes\` / group "Summer Intensive"
    - Medium-Term cell bullets → \`mediumTermOutcomes\` / group "Summer Intensive"
    - Long-Term column boxes → \`longTermOutcomes\` (tracks if aligned; else General)
    - \`impact.content\` = []  (no Impact column header)

    ---
    **OUTPUT FORMAT** (JSON only — no critique/rating fields):
    {
      "organization": "...",
      "program": "...",
      "impactStatement": { "content": "..." },
      "mission": { "content": "" },
      "targetPopulation": { "content": "..." },
      "inputs": { "content": [{ "name": "Human Resources", "items": [{ "text": "..." }] }] },
      "activities": { "content": [{ "name": "Track name", "items": [{ "text": "..." }] }] },
      "outputs": { "content": [{ "name": "Track name", "items": [{ "text": "..." }] }] },
      "shortTermOutcomes": { "content": [{ "name": "Track name", "items": [{ "text": "..." }] }] },
      "mediumTermOutcomes": { "content": [{ "name": "Track name", "items": [{ "text": "..." }] }] },
      "longTermOutcomes": { "content": [{ "name": "General", "items": [{ "text": "..." }] }] },
      "impact": { "content": [] }
    }
    Include \`impactStatement\` when labeled; omit the key when not labeled. Prefer empty \`impact.content\` over inventing Impact items.
    `;
};

export const getAiCritiquePrompt = (): string => {
    return `Role: You are an expert Logic Model Analyst. Your task is to ruthlessly critique the provided logic model JSON and point out deficiencies based on strict logic model guidance.

    **GOAL**: Critique the quality of **domains that have content** in the provided JSON. The input is a logic model JSON; return the SAME structure with critiques/ratings on **present** domains and items, plus overallQuality.

    **PRESENCE-AWARE CRITIQUE (v0.2 — required)**:
    - **Skip empty optional domains entirely** — do not assign domain critique, domain rating, or item critiques when a domain has no content:
      - \`mission\` with empty \`content\`
      - \`mediumTermOutcomes\` with no items (source had no Medium-Term column)
      - \`impact\` with no items (source had no Impact column)
      - \`impactStatement\` when absent/empty
    - For skipped domains: leave \`critique\` as \`""\` and **omit** \`rating\` (do not rate Weak for "missing" optional sections).
    - **Missing Mission is NOT a flaw** — never cite absent Mission in overall rationale; never lower overall quality solely because Mission is empty.
    - **Empty grid Impact is NOT a flaw** — when \`impact\` has no items (no Impact column in source), never cite empty Impact section/column in overall rationale; never lower overall quality for it. This is different from a labeled **Impact Statement** when that block exists.
    - **Progression checks apply only to present outcome horizons** — do not require short→medium→long if Medium-Term was not in the source.
    - Still critique **present** domains rigorously (inputs, outputs, outcomes that have items, labeled Impact Statement, etc.).

    **CRITICAL — EVALUATE AS PLACED (DO NOT RE-BUCKET)**:
    - Critique items **where they already sit** in the input JSON. Never move items between domains in your output.
    - If content appears misplaced (e.g., output language in Short-Term Outcomes), flag it in the domain/item critique and rate Weak — do **not** silently relocate items.
    - When column assignment may be ambiguous, add: "Verify column alignment in source document."
    - Extract owns column/track fidelity; your job is to assess quality of the document **as extracted**.

    **FIELD DISAMBIGUATION**:
    - Critique \`impactStatement\`, \`mission\`, and grid \`impact\` **separately** only when each has content.
    - Empty \`mission\` with a populated \`impactStatement\` is valid — no critique for Mission.
    - \`impactStatement\` = labeled overview prose; \`impact\` = grid column items; \`longTermOutcomes\` = Long-Term column items.
    - Empty \`impact\` is OK when the source had no Impact column (Long-Term Outcomes may hold ultimate status language).

    **LOGIC MODEL GUIDANCE FOR CRITIQUE** (apply only to domains with content):
    Use the following principles to identify deficiencies and rate each section. If a section violates these principles, point it out explicitly in the critique and lower the rating.

    - **General/Alignment**: Does the intended impact capture the ultimate outcome (not what is done)? Do short-term outcomes reflect progressive steps to long-term results?
    - **Impact Statement**: When present, does it articulate population, accountability, and long-term change — distinct from mission/activities?
    - **Mission/Overview/Context**: Critique only when \`mission.content\` is non-empty. Should focus on population, geography, and accountability when distinct from Impact Statement.
    - **Resources (Inputs)**: Must capture Human, Material/Technical, Financial, and Knowledge resources. Participants/beneficiaries are NOT inputs.
    - **Activities**: What the program does with resources. Should be grouped by main strategies rather than listing every single task.
    - **Outputs**: Direct products of activities. Must not confuse outputs with outcomes.
    - **Short-Term Outcomes**: Must ONLY capture changes in **knowledge, attitudes, or awareness** (when this column exists in source).
    - **Medium-Term Outcomes**: Must ONLY capture changes in **skills, behaviors, and actions** (when this column exists in source).
    - **Long-Term Outcomes**: Must ONLY capture changes in **status or condition** (Long-Term column).
    - **Impact column**: Ultimate systemic change items from the grid Impact column — not Impact Statement prose. Skip when empty.
    - **Level of Detail**: Flag outcomes if they are too detailed too early.

    **ITEM CRITIQUE**:
    For domains with content, provide domain-level and item-level critiques. Check if each item belongs in that domain per logic model guidance.

    **OVERALL QUALITY** (required — see product rubric v0.2):
    After domain/item critiques on **present** domains, set overallQuality:
    - rating: "Strong" | "Adequate" | "Weak" for the **logic model document** (structure and guidance fit), NOT whether the program is valuable.
    - rationale: array of 2–4 short bullets explaining why. Each bullet must cite evidence from **present** domain/item findings only.
    Rollup hints: Prefer Weak if an **outcomes chain that exists in the source** is empty or severely mis-binned; outputs packed with outcome language; majority of **present** outcome items Weak; mission text (when present) describes only activities. Prefer Strong only if ratings on **present** domains are mostly Strong/Adequate AND progression across **present** outcome horizons holds. Otherwise Adequate.

    **FORBIDDEN overall rationale bullets** (never write these for optional absent domains):
    - "The mission statement is entirely absent..." / any bullet citing missing or empty Mission when \`mission.content\` is empty.
    - "The Impact section is empty..." / any bullet penalizing empty \`impact\` when the grid Impact column was not in the source.
    - Do not assign Weak overall **only** because Mission or grid Impact are absent/empty.

    **OUTPUT FORMAT**:
    Return valid JSON matching the exact original structure (including optional impactStatement if present in input), with critiques and ratings on present domains/items, and overallQuality included.
    For "rating" fields on **present** domains/items: assign "Strong", "Adequate", or "Weak".
    Leave critique "" and omit rating on skipped empty optional domains.
    `;
};
