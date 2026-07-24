# Phase 2 draft — Auth & cloud deploy (NOT APPROVED)

Status: **Out of scope** until @product explicitly promotes this into `current-prd.md`.

## Proposed problem
Local-only MVP cannot be shared safely with SDP staff without hosting and access control.

## Candidate IN scope (if approved)
- Hosted deployment (single region)
- Simple auth (SSO or magic link) for internal users
- Server-side Gemini (already done) + HTTPS
- Rate limiting / abuse controls on `/api/gemini/*`

## Candidate OUT
- Multi-tenant white-label
- End-user public accounts
- Document cloud storage / collaboration

## Open decisions (do not implement until answered)
1. Who are the first hosted users (SDP only vs partners)?
2. Preferred IdP?
3. Budget / hosting target (Cloud Run, App Service, etc.)?
