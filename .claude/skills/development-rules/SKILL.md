---
name: development-rules
description: Read this skill BEFORE writing or modifying ANY code in this project. This skill contains the project's mandatory impact analysis checklist, cross-system dependency map, security-verification checklist, and test verification steps that MUST be followed for every change. Use this skill whenever the user asks to: add a feature, fix a bug, change a model/struct, add or modify an API endpoint, update a frontend form or page, add an integration (Stripe, etc.), change database schema, modify routes or permissions, update environment variables, upgrade or add a dependency, patch a CVE, touch auth/crypto/sanitization code, or touch the Baisync Agent. Also use when the user says "implement", "build", "add", "create", "update", "fix", "refactor", "migrate", "deploy", "upgrade", "bump", "patch", "vulnerability", "CVE", "audit", or "security". Without this skill, Claude will miss required cross-system updates AND may introduce security regressions (outdated sanitizers, weak RNGs, unsafe deserialization, SSRF, unpatched CVEs in transitive deps). This skill is the project's engineering + security checklist — skip it and things break silently.

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

## Security Verification — Mandatory

At the end of ANY change that touches dependencies, user input, auth, file uploads, HTML/markdown rendering, sanitizers, cryptographic primitives, or external API integrations, run this checklist **before** declaring the task done:

1. **Scan for known vulnerabilities**
   - Frontend: `cd frontend && yarn audit --level moderate` — review high/critical findings
   - Backend: `cd backend && cargo audit` (install via `cargo install cargo-audit` if missing)
   - If advisories appear, either patch the dep or document why the risk is acceptable for this change

2. **Research CVEs for added/bumped libraries** (WebSearch when in doubt)
   - Search "<lib name> CVE" on GitHub Advisory Database (github.com/advisories) and RustSec Advisory DB (rustsec.org)
   - For any sanitizer, parser, or template engine (HTML, XML, Markdown, SQL, regex): search "<lib> bypass" and "<lib> mXSS" in the last 12 months
   - Confirm the version you added is ≥ the latest patched release in the affected version range
   - Cite the CVE IDs you checked in the commit message or PR when non-trivial

3. **Code-level security checks for touched surfaces**
   - **User HTML / markdown rendering** → sanitizer is present, its version is patched (e.g. DOMPurify ≥ 3.4.0), and sanitized output is NOT reinserted into a different parsing context (`innerHTML` inside `<xmp>`/`<textarea>` etc. — mXSS vector)
   - **File upload** → MIME allowlist, max-size cap, content-type sniff, extraction-to-text before any inline rendering; no `eval`/`Function` on parsed content
   - **Auth / token / nonce / key generation** → use a CSPRNG (`rand::rng()` on `rand ≥ 0.9.3`, `OsRng` via `aead::rand_core`, `crypto.getRandomValues` in browser). Never `Math.random()`, never `rand::thread_rng()` on `rand < 0.9.3` (CVE unsoundness)
   - **Cassandra queries with user input** → parameterized via `?` placeholders, never string-concatenated. Same for any SQL/query builder
   - **Fetch/proxy of user-supplied URLs** → deny-list localhost, link-local, private ranges (SSRF)
   - **JSON/body size** → Axum `DefaultBodyLimit` or explicit per-route cap; webhook ingest enforces its own cap
   - **Error responses** → never leak stack traces, internal paths, SQL, or secrets to the client

4. **Keep Dependabot on**
   - `.github/dependabot.yml` exists and covers `frontend/yarn.lock` + `backend/Cargo.lock` on a weekly cadence
   - If missing, create it as part of the change

5. **Before merging**: re-run step 1. New transitive deps may have pulled in fresh advisories.

## Before Finalizing Any Task

- [ ] Run `tests/consistency/check.sh` — all checks pass
- [ ] Run `cargo test` in backend — all tests pass
- [ ] Run `yarn test` in frontend — all tests pass
- [ ] Verified dependency map above for the change made
- [ ] Updated Baisync Agent if change affects user-visible functionality
- [ ] Security Verification checklist above ran clean, or findings were triaged and documented
