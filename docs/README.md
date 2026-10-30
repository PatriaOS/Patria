# Patria docs

* `PRD.md`: what Patria is, who it is for, and why (Product Requirements Document).
* `FEATURES.md`: every feature with its flow, rules, edge cases and acceptance criteria (Feature Requirements Document).
* `DECISIONS.md`: product and engineering choices that clarify or override the PRD and features. This file wins where it is more specific.
* `BUILD_LOG.md`: running log of what we built, in what order, and why we chose each option. Append an entry after every slice.
* `design/`: exported Figma screens. See `design/README.md`.
* `FIRST_PROMPTS.md`: the prompts to paste into Cursor, in order, to build the first slice.
* `security/KEYS.md`: family encryption keys and recovery (CIR05 step 2 protocol).
* `security/KEYS_IMPLEMENTATION.md`: small-step build plan for those keys. No code until Step 1 is approved.
* `trust/`: How Patria protects your family and the Privacy statement (source of truth for in-app trust screens).
* `DESIGN_SYSTEM.md`: D32 design system. Screen exports live in `design/`.
* `testing/PHONE_TESTS.md`: numbered phone tests (Maestro flows in `patria-app/.maestro/`).

Project rules for Cursor live in `.cursor/rules/patria.mdc` at the repository root.

When a decision changes (stack, scope, a feature rule), update these files first, then ask Cursor to follow the updated version. They are the single source of truth for the app.

## Running tests

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request. The **app** job typechecks, lints and runs Jest in `patria-app/`. The **database** job starts a local Supabase stack, applies migrations from scratch, and runs pgTAP. It does not use the hosted project.

Locally, from `patria-app/`:

* App: `npm test`
* Database: Docker must be running, then `npx supabase start` and `npx supabase test db`

Docker is only required for database tests.
