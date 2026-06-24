# AGENTS.md

## Cursor Cloud specific instructions

This repo contains two independent things:

1. **NEXUS full-stack app** (`apps/api`, `apps/web`) — the Social Media Aggregator
   Platform built from `BRD-v1`. This is the primary product.
2. **Autonomous Agent** (`autonomous_agent.py`) — the original Python GitHub Action.

### NEXUS full-stack app

Monorepo via npm workspaces. Node 20+ (developed on Node 22). Run everything from the
repo root.

- Install: `npm install` (handled by the startup update script).
- Database: Prisma + **SQLite** for local dev (`apps/api/prisma/dev.db`, gitignored).
  Production switches the datasource provider to `postgresql` (see `README.md`).
- First-run setup (NOT in the update script — run once when the DB is missing):
  - `cp apps/api/.env.example apps/api/.env`
  - `cp apps/web/.env.example apps/web/.env.local`
  - `npm run db:setup` — pushes the Prisma schema to SQLite and seeds the demo account.
- Run both dev servers: `npm run dev` (API on `:4000`, web on `:3000`). Or individually:
  `npm run dev:api` / `npm run dev:web`.
- Lint/typecheck: `npm run lint` (API = `tsc --noEmit`, web = `next lint`).
- Tests: `npm test` (API vitest suite under `apps/api/src/__tests__`).
- Build: `npm run build`.
- Demo account: `demo@nexus.app` / `password123`.

Non-obvious notes:

- **Demo connectors:** the four social platforms (Twitter, Threads, Bluesky, Mastodon)
  are implemented as deterministic demo connectors in `apps/api/src/connectors/`. They
  generate realistic feeds and simulate publishing so the app runs fully **without any
  third-party API keys**. To integrate a real platform, implement `PlatformConnector`
  and register it; nothing else needs to change.
- After editing `prisma/schema.prisma` you must run `npm run -w @nexus/api prisma:generate`
  (and `prisma db push`) — the generated client is what the API imports.
- The web app reads the API base URL from `NEXT_PUBLIC_API_URL` (`apps/web/.env.local`,
  default `http://localhost:4000`). CORS origins for the API are set via `CORS_ORIGIN`.
- Prisma CLI prints a "major version upgrade available (7.x)" notice — it is informational;
  the project is pinned to Prisma 6 and works as-is.

### Autonomous Agent (Python)

- Single-file CLI / composite GitHub Action. Deps in `requirements.txt`, installed into a
  `./venv` by the update script. Lint = `python -m py_compile autonomous_agent.py`;
  tests = `python -m pytest` (no tests yet, exit code 5 is expected).
- `main()` requires `GITHUB_TOKEN`, `OPENAI_API_KEY`, and `REPO`, and constructs a GitHub
  client (network call) before argparse — so even `--help` fails without valid creds. To
  exercise logic offline, import the module and call its pure functions. Running
  `analyze`/`generate`/`run` makes live OpenAI + GitHub calls (and `run` opens a PR).
