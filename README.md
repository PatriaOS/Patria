# Patria

Patria is a private family app. It helps a household run day to day life together — Sync meetings, shared photos, tasks — and it keeps the family’s memories, voices and the reasons behind big decisions for the next generation.

Patria is quiet by default: no ads, no tracking SDKs, no streaks or guilt. Family data stays inside the family’s circles. Sensitive vault content is locked on the phone before it is uploaded.

## Status

**Early testing.** Built so far: family encryption keys and recovery, Shared Family Library (Memories), Legacy Vault with voice notes and Only me entries, Family Sync slices 1 and 2, Home v2, and offline trust screens (How Patria protects your family, Privacy statement). More is planned; see `docs/FEATURES.md` and `docs/DECISIONS.md`.

## Trust and privacy

Start here:

* [How Patria protects your family](docs/trust/HOW_PATRIA_PROTECTS_YOUR_FAMILY.md)
* [Privacy statement](docs/trust/PRIVACY_STATEMENT.md)

Questions or requests: **support.patria@gmail.com**

## Tech stack

* React Native with Expo (managed) and TypeScript (strict)
* Expo Router (file-based routes in `patria-app/app/`)
* Supabase (Auth, Postgres with RLS, Storage, Edge Functions)
* TanStack Query, react-hook-form + zod
* Jest + React Native Testing Library; pgTAP for database policies
* Maestro phone tests under `patria-app/.maestro/`

## Repository layout

| Path | What it is |
| --- | --- |
| `patria-app/` | Mobile app (Expo). Run npm and Expo from here. |
| `patria-app/supabase/` | Migrations, RLS policies, Edge Functions, SQL tests |
| `docs/` | PRD, features, decisions, build log, design, security, trust |
| `patria-app/.maestro/` | Maestro flows for phone tests |
| `.cursor/rules/` | Project rules for Cursor |

## Getting started (Mac)

Requirements: **Node 22.13** (see `.nvmrc`), Docker Desktop, Xcode Simulator (and/or a phone with Expo Go).

```bash
git clone <this-repo>
cd Patria/patria-app
npm ci
```

### Local Supabase (Docker)

```bash
npx supabase start
npx supabase status   # copy API URL and anon key into a gitignored .env
```

Create `patria-app/.env` from `.env.example` (never commit `.env`):

```bash
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key-from-supabase-status>
```

### Simulator (native e2e build)

See `docs/testing/AUTOMATION.md`. Typical flow: fill gitignored e2e secrets from the example files, then `npm run e2e:build` and `npm run e2e -- --test N`. Use placeholders in docs and examples — never commit real emails or passwords.

### Expo Go against the hosted test project

```bash
cd patria-app
npx expo start -c
```

Point `.env` at the hosted URL and **publishable anon key** only. Never put the service role key in the app.

### “Could not be found in node_modules” on the Simulator

If `npm run test:linux` once overwrote Mac packages (before the Docker volume fix), or Metro is confused after a bad install:

```bash
cd patria-app
rm -rf node_modules
npm ci
npx expo start -c
```

## Testing

From `patria-app/`:

| Command | What it does |
| --- | --- |
| `npm run test:linux` | Typecheck, lint, Jest in Linux Docker. Uses an **anonymous volume** for `node_modules` so the Mac’s packages are never touched. |
| `npx supabase test db` | pgTAP / RLS tests against local Supabase |
| `npm run e2e:check` | PHONE_TESTS.md, Maestro flows and e2e runners stay in sync |
| `npm run e2e:build` | Install the native e2e app on Simulator(s) |
| `npm run e2e -- --test N` | Run phone test number N |

CI (`.github/workflows/ci.yml`) runs the app job and the database job on every push and pull request. Supabase CLI in CI is pinned to **2.121.0**.

## Docs index

* `docs/DECISIONS.md` — build decisions **D1–D38** (this file wins where it is more specific than the PRD)
* `docs/PRD.md` — product requirements
* `docs/FEATURES.md` — feature flows, rules and acceptance criteria
* `docs/testing/PHONE_TESTS.md` — numbered phone tests
* `docs/BUILD_LOG.md` — what we built and why
* `docs/DESIGN_SYSTEM.md` — D32 design system; screen exports in `docs/design/`
* `docs/security/KEYS.md` and `docs/security/KEYS_IMPLEMENTATION.md` — family keys and recovery
* `docs/trust/` — How Patria protects your family and the Privacy statement (source of truth for in-app trust screens)
* `docs/README.md` — short map of the docs folder
* `SECURITY.md` — how to report a security issue

## Security rules

* Never commit `.env`, `.e2e-secrets`, service role keys, recovery codes or personal passwords.
* Never put the **service role** key in the app. Only `EXPO_PUBLIC_` values that are safe to expose.
* Never log keys, codes, invite links, tokens or personal content.
* RLS is required on every table; write a test for every policy.
* Mark crypto-related files with `// SECURITY REVIEW REQUIRED` at the top.

**Reporting a security issue:** write to **support.patria@gmail.com** (see `SECURITY.md`). Do not open a public issue for a vulnerability that could put a family’s data at risk.

## How we work

* Work on a branch. Open a pull request. Merge only when **app** and **database** CI are green.
* No direct pushes to `main`.
* Hosted Supabase migrations only after a dry run and Femi’s approval. No secrets in docs or PR bodies.
* **D32 design is frozen.** Do not change design tokens, type scale, spacing, radii or component styles without Femi’s explicit approval.
* Every feature or fix that ships in a PR updates the docs that apply (see the pull request template and `.cursor/rules/patria.mdc`).
