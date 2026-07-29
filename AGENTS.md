# Agent Map — Logic Model Extractor

This project uses specialized agent personas via Cursor rules in `.cursor/rules/`. Invoke them by name in chat (e.g., `@product scope the batch export feature`).

## Agent roster

| Agent | Rule file | Owns | Does not own |
|-------|-----------|------|--------------|
| **@product** | `product.mdc` | PRD integrity, IN/OUT scope, acceptance criteria, feature sequencing | Code, schemas, UI implementation |
| **@architect** | `architect.mdc` | TypeScript interfaces, Express/Vite boundaries, data model, export shapes | UI components, npm installs without pause |
| **@integrator** | `integrator.mdc` | `/api/gemini/*` client, server Gemini handlers, file conversion, CSV/PDF export | Product scope, decorative UI |
| **@devops** | `devops.mdc` | Build verification, `.env.local` hygiene, Vite proxy + Express, deployment safety | Feature UX, schema design |
| **@ux** | `ux.mdc` | Layout, design tokens, component specs, accessibility structure | Product scope cuts, backend schemas |
| **@pattern-analyst** | `pattern-analyst.mdc` | UX pattern benchmarks and pros/cons during discovery (`docs/specs/*.md`) | Implementation code |
| **@critic** | `critic.mdc` | Heuristic / cognitive-load audits of flows and UI; structured critiques only | Implementation code |
| **@microcopy** | `microcopy.mdc` | UI text: labels, CTAs, errors, empty states, tooltips | Visual redesign, new features |
| **@user-tester** | `user-tester.mdc` | Edge-case scenarios, keyboard/a11y stress tests, graceful-degradation checks | Shipping features, scope changes |
| **@lm-quality** | `lm-quality.mdc` | Overall LM qualitative quality rubric + assessment prompts | UI code, coder app features |
| **@critique-prompt** | `critique-prompt.mdc` | Domain/item critique prompts that evidence overall quality | Overall rollup rubric, product scope |

## Source-of-truth docs
- **Project context:** `.cursor/rules/project.mdc` (always applied)
- **PRD:** `docs/specs/current-prd.md`
- **PRDs / specs:** `docs/specs/`

## Suggested invocation order (new feature)

1. **@product** — Scope the feature; define IN/OUT; output PRD section to `docs/specs/`.
2. **@pattern-analyst** — Benchmark 2–3 UX patterns; pros/cons; recommend MVP-simple pick.
3. **@architect** — Produce technical spec (interfaces, service boundaries, data shapes).
4. **@critic** — Audit proposed workflow for cognitive load and usability friction.
5. **General agent / implementer** — Build against PRD + spec.
6. **@microcopy** — Refine labels, errors, empty states.
7. **@user-tester** — Edge-case and a11y checklist.
8. **@devops** — Verify build; confirm secrets hygiene.

## Escalation (when to ask the user)
- Any new `npm install` / external package.
- Stack fork away from TypeScript / Vite + React.
- Ambiguity that would change IN/OUT scope in a PRD.
- Auth, cloud deployment, or moving Gemini calls behind a server.
