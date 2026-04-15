---
name: development-rules
description: Read this skill BEFORE writing or modifying ANY code in this project. This skill contains the project's mandatory impact analysis checklist, cross-system dependency map, and test verification steps that MUST be followed for every change. Use this skill whenever the user asks to: add a feature, fix a bug, change a model/struct, add or modify an API endpoint, update a frontend form or page, add an integration (Stripe, etc.), change database schema, modify routes or permissions, update environment variables, or touch the Baisync Agent. Also use when the user says "implement", "build", "add", "create", "update", "fix", "refactor", "migrate", or "deploy". Without this skill, Claude will miss required cross-system updates (e.g., changing a backend struct without updating frontend types, adding a feature without updating the Baisync Agent, or modifying env vars without updating .env.example). This skill is the project's engineering checklist — skip it and things break silently.

---

## Impact Analysis — Before implementing ANY change, answer:

1. **Where else does this change need to be reflected?**
   - Backend change → does the frontend need updating?
   - Frontend change → does the backend already support this?
   - Adding/removing/renaming → are there other references?

2. **Who needs to know about this change?**
   - Baisync Agent → update knowledge base / system prompt if user-facing
   - Admin panel → reflect new integrations, configs, plans
   - Documentation → CLAUDE.md, API docs, .env.example

3. **Is the user experience consistent?**
   - Data entered in one place → visible/editable in all relevant places
   - "Create X" screen exists → "Edit X" should have the same fields
   - Feature available via API → accessible via UI

4. **Do tests cover this change?**
   - Created/updated tests for the feature itself
   - Updated consistency tests if applicable
   - Frontend MSW mocks reflect backend changes

## Dependency Map — "If you changed X, check Y"

| Changed...                           | Verify...                                                                 |
|--------------------------------------|---------------------------------------------------------------------------|
| Struct/model (backend)               | Migration, frontend screens, API serialization, Baisync Agent             |
| API endpoint (backend)               | Frontend caller, MSW mocks, integration tests, API docs                   |
| Any form (frontend)                  | Other screens for same resource (create↔edit), backend struct, migration  |
| New integration (Stripe, etc.)       | Admin panel, env vars, docs, Baisync Agent, CI secrets                    |
| New platform feature                 | Baisync Agent, tests, admin (if applicable), sidebar/menu                 |
| Baisync Agent system prompt          | Verify it covers all existing features                                    |
| Admin panel                          | All backend integrations/configs are represented                          |
| Environment variables (.env)         | CI/CD secrets, docker-compose, `.env.example`                             |
| Database schema                      | Migrations, backend structs, frontend types, test seeds                   |
| Frontend routes (pages/app)          | Navigation/sidebar, permissions, Baisync Agent                            |
| Permissions / roles                  | Backend middleware, frontend guards, auth tests, admin                    |

## Before Finalizing Any Task

- [ ] Run `tests/consistency/check.sh` — all checks pass
- [ ] Run `cargo test` in backend — all tests pass
- [ ] Run `yarn test` in frontend — all tests pass
- [ ] Verified dependency map above for the change made
- [ ] Updated Baisync Agent if change affects user-visible functionality
