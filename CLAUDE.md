# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Inertial Eclipse** is a SaaS platform for creating AI-powered customer service agents for WhatsApp and Telegram. Users configure assistants with different LLM providers (OpenAI, Claude, Gemini), upload knowledge bases (RAG), and connect messaging channels.

## Architecture

Monorepo with three main directories:

- **`/frontend`** — Next.js 16 + React 19 + HeroUI v3 + Tailwind CSS v4 + Zustand
- **`/backend`** — Rust + Axum, serves API on port 3001 (includes CQL migrations in `/backend/migrations/`)

All services are orchestrated via `docker-compose.yml` (frontend:3000, backend:3001, Cassandra:9042, Redis:6379, Baileys:3025).

## Build & Run Commands

### Full stack
```bash
docker compose up -d          # Start all services
docker compose build           # Rebuild all images
docker compose logs -f backend # Follow backend logs
```

### Frontend (`/frontend`)
```bash
cd frontend
yarn install
yarn dev          # Dev server on :3000
yarn build        # Production build
yarn lint         # ESLint
npx tsc --noEmit  # Type-check without emitting
```

### Backend (`/backend`)
```bash
cd backend
cargo check       # Fast compilation check
cargo build --release
cargo run         # Starts on :3001 (needs .env and Cassandra running)
```

### Database
```bash
# Migrations run automatically by the backend on startup (no manual step needed)
# Migration files: backend/migrations/*.cql
```

## Frontend Specifics

### HeroUI v3 — Critical Rules
- **Read** `frontend/.agents/skills/heroui-react/SKILL.md` before implementing any component
- Use compound components with dot-notation: `Card.Header`, `Card.Content`, `Modal.Backdrop`, `Modal.Container`, `Modal.Dialog`
- Use `onPress` instead of `onClick` on HeroUI components
- Do **NOT** use `HeroUIProvider` — v3 does not need it
- Do **NOT** use `framer-motion` — v3 uses CSS animations

### Next.js 16 — Breaking Changes
Read `node_modules/next/dist/docs/` before writing code. APIs, conventions, and file structure differ from prior versions.

### State Management
- `store/useAssistantStore.ts` — Assistants CRUD, syncs with backend API
- `store/useAuthStore.ts` — JWT auth, login/register/logout, token in localStorage
- `store/useApiKeysStore.ts` — LLM API keys, syncs with backend
- All stores use Zustand with `persist` middleware

### API Client
`lib/api.ts` — `apiFetch<T>()` wrapper that auto-includes Authorization header, handles 401 redirects. Base URL from `NEXT_PUBLIC_API_URL`.

### Real-time Updates
All dashboard data (channels, messages, notes, notifications, etc.) must appear in the UI without requiring a page refresh. Use SSE events (`lib/useRealtimeEvents.ts`) and Zustand store updates to push new data to the UI in real-time.

### Forms
All forms use React Hook Form + Zod for validation.

## Backend Specifics

### Module Structure
```
src/
  main.rs            — Router setup, CORS, tracing, port 3001
  config/            — Config from .env (database, JWT, SMTP, encryption, Baileys)
  db/                — Cassandra connection (scylla LegacySession)
  handlers/          — HTTP handlers (auth, assistants, tools, integrations, models, api_keys, messages)
  services/          — Business logic (auth, assistant, llm, messaging, email, encryption)
  middleware/        — JWT auth middleware (extracts user_id for all protected routes)
  models/            — Data structs (user, assistant, conversation, integration, usage)
  errors.rs          — AppError enum with IntoResponse (NotFound, Unauthorized, BadRequest, etc.)
```

### Key Patterns
- **Multi-tenancy**: All Cassandra queries filter by `user_id` (partition key)
- **API key encryption**: AES-GCM via `services/encryption.rs` before storing in Cassandra
- **LLM calls**: `services/llm.rs` supports OpenAI, Claude, Gemini — decrypts user's API key, calls provider API
- **Messaging flow**: Webhook receives message → identify assistant → rate limit check → fetch history → call LLM → split on `\n\n` if configured → send reply → store in Cassandra
- **Error handling**: All handlers return `Result<Json<T>, AppError>` — use `thiserror` derive

### API Routes
- **Public**: `/api/auth/{register,login,forgot-password,reset-password}`, `/api/webhooks/baileys`, `/api/webhooks/meta`
- **Protected** (JWT required): `/api/auth/me`, `/api/assistants/**`, `/api/models/{provider}`, `/api/user/api-keys`

## Database

Cassandra keyspace: `inertial_eclipse`. Migrations in `/backend/migrations/` (001-031), run automatically by the backend on startup.

Key design decisions:
- Partition keys on `user_id` for tenant isolation
- Clustering keys by `id` or `created_at` for ordering
- `VECTOR<FLOAT, 1536>` on `assistant_files` with SAI index for RAG embeddings
- `TIMEUUID` for message IDs (natural time ordering)

## Environment Variables

Copy `.env.example` to `.env` at project root. Key vars: `CASSANDRA_HOST`, `JWT_SECRET`, `SMTP_*`, `ENCRYPTION_KEY`, `BAILEYS_URL`, `BAILEYS_API_KEY`, `NEXT_PUBLIC_API_URL`.

## Testing

### Backend Tests
```bash
cd backend
cargo test --lib          # Unit tests only (no Cassandra needed)
cargo test                # All tests (needs Cassandra running)
cargo test --test auth_tests  # Single integration test file
```

### Frontend Tests
```bash
cd frontend
yarn test                 # All tests
yarn test:watch           # Watch mode
yarn test:coverage        # With coverage report
```

### Consistency Tests
```bash
bash tests/consistency/check.sh           # All consistency checks
npx --prefix tests/consistency tsx tests/consistency/routes-consistency.ts  # Single check
```

### Pre-commit Hooks (lefthook)
```bash
lefthook install    # Set up hooks (run once after clone)
```

Pre-commit runs: frontend lint + backend cargo check
Pre-push runs: frontend tests + backend unit tests + consistency checks

### CI/CD
- Backend: `.github/workflows/backend-deploy.yml` — tests → deploy (on push to master)
- Frontend: `.github/workflows/frontend-deploy.yml` — tests → deploy (on push to master)
- Consistency: `.github/workflows/consistency.yml` — runs on all PRs

All deploys are gated behind passing tests.
