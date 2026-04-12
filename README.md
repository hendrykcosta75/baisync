# Baisync

SaaS platform for creating AI-powered customer service agents for WhatsApp and Telegram. Users configure assistants with different LLM providers (OpenAI, Claude, Gemini), upload knowledge bases (RAG), and connect messaging channels.

## Architecture

Monorepo with two main services:

- **Frontend** -- Next.js 16, React 19, HeroUI v3, Tailwind CSS v4, Zustand
- **Backend** -- Rust, Axum, Cassandra (ScyllaDB), Redis

All services are orchestrated via Docker Compose.

| Service    | Port | Description                        |
|------------|------|------------------------------------|
| frontend   | 3000 | Next.js web application            |
| backend    | 3001 | REST API (Axum)                    |
| cassandra  | 9042 | Primary database                   |
| redis      | 6379 | Cache and session store            |
| baileys    | 3025 | WhatsApp messaging API             |

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Rust toolchain (for local backend development)
- Node.js 22+ and Yarn (for local frontend development)

### Setup

1. Clone the repository:
```bash
git clone git@github.com:hendrykcosta75/baisync.git
cd baisync
```

2. Copy the environment file and fill in the values:
```bash
cp .env.example .env
```

3. Start all services:
```bash
docker compose up -d
```

The frontend will be available at `http://localhost:3000` and the backend API at `http://localhost:3001`.

### Local Development

For local development with hot-reload:

```bash
# Start infrastructure (Cassandra, Redis, Baileys)
docker compose up -d cassandra redis baileys

# Backend (in one terminal)
cd backend
cargo run

# Frontend (in another terminal)
cd frontend
yarn install
yarn dev
```

## Testing

### Backend
```bash
cd backend
cargo test --lib              # Unit tests (no Cassandra needed)
cargo test                    # All tests (needs Cassandra running)
```

### Frontend
```bash
cd frontend
yarn test                     # All tests
yarn test:watch               # Watch mode
```

### Consistency Checks

Cross-system tests that verify backend routes match frontend API calls, environment variables are documented, and navigation links have corresponding pages:

```bash
bash tests/consistency/check.sh
```

## CI/CD

All deploys are gated behind passing tests:

- **Backend** -- `.github/workflows/backend-deploy.yml`: unit tests, integration tests (with Cassandra), then Docker build and deploy
- **Frontend** -- `.github/workflows/frontend-deploy.yml`: lint, tests, type-check, then Docker build and deploy
- **Consistency** -- `.github/workflows/consistency.yml`: cross-system checks on every push and PR

### Pre-commit Hooks

The project uses [lefthook](https://github.com/evilmartians/lefthook) for local git hooks:

```bash
lefthook install    # Run once after cloning
```

- **pre-commit**: frontend lint, backend cargo check
- **pre-push**: frontend tests, backend unit tests, consistency checks

## Project Structure

```
baisync/
  backend/                 # Rust + Axum API
    src/
      handlers/            # HTTP route handlers
      services/            # Business logic
      models/              # Data structures
      middleware/           # Auth, admin middleware
      config/              # Environment configuration
      db/                  # Cassandra connection and migrations
    migrations/            # CQL migration files
    tests/                 # Integration tests
  frontend/                # Next.js 16 web app
    app/                   # Pages (App Router)
    components/            # React components
    store/                 # Zustand state management
    lib/                   # Utilities and API client
    tests/                 # Vitest tests
  tests/
    consistency/           # Cross-system consistency checks
  .github/workflows/       # CI/CD pipelines
  docker-compose.yml       # Service orchestration
  lefthook.yml             # Git hooks configuration
```

## Key Features

- Multi-assistant AI management with configurable LLM providers
- WhatsApp integration (via Baileys and Meta Official API)
- Telegram bot integration
- Knowledge base with RAG (file upload and vector search)
- Tool/function calling for assistants
- Team workspaces with role-based access control
- Real-time updates via Server-Sent Events (SSE)
- Calendar and appointment scheduling
- Payment processing (PIX via Mercado Pago, card via Stripe)
- Admin panel for user and platform management
- Baisync Agent -- in-app AI assistant for platform guidance

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable          | Description                          |
|-------------------|--------------------------------------|
| DATABASE_URL      | Cassandra connection string          |
| JWT_SECRET        | Secret for JWT token signing         |
| ENCRYPTION_KEY    | AES-256-GCM key for API key storage  |
| BAILEYS_URL       | WhatsApp Baileys API endpoint        |
| BAISYNC_API_KEY   | OpenAI key for Baisync Agent         |
| SMTP_*            | Email service configuration          |
| ADMIN_USER/PASS   | Admin panel credentials              |

## License

Proprietary. All rights reserved.
