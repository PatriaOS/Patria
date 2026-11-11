# Phone test automation

From `patria-app`, after Metro is up (`npm run e2e:build` in another terminal, or the runner will start it):

```bash
npm run e2e:smoke      # tests 1, 3, 8 — aim for under 5 minutes
npm run e2e:affected   # tests whose areas match files that differ from main, plus new tests
npm run e2e:full       # every numbered test (same as npm run e2e)
```

From `patria-app`, two terminals:

Terminal 1:

```bash
npm run e2e:build
```

That compile leaves Metro running in that terminal on purpose. Leave it open. Open a second terminal for the flows:

```bash
npm run e2e
```

When you are done, stop Metro in the first terminal with Control and C.

`e2e:build` reads `.env.e2e.local` in the script and passes only `EXPO_PUBLIC_` values into `npx expo run:ios`, with `EXPO_NO_DOTENV=1` so `.env` and the hosted test project are not mixed in. Env files are never imported into the app; Metro is told to ignore them. It boots the same number of **iPhone 17 Pro** simulators as `E2E_DEVICES` (default 2, including C when the value is 3) — never Pro Max. If a second (or third) Pro is missing, `bootDevices` creates `Patria e2e iPhone 17 Pro B` / `C`. It installs `app.patria.dev` on every one of them, and leaves Metro running in that terminal. `npm run e2e` copies that build onto any newly created Pro that is missing the app; it only refuses to start when none of the e2e Pros have the app yet. It starts Metro in the background if port 8081 is not already up, and waits until it is ready; it never waits for a command that does not exit. `npx expo start` without e2e is unchanged: it still loads `patria-app/.env` and talks to the hosted test project.

Each test reseeds a local starting state through `e2e-setup` (Test 1 as admin of **E2E Family**, using `create_family_space` the same way the app does). Progress is printed and written to `patria-app/e2e-artifacts/progress.txt`. A test that runs longer than 10 minutes is marked failed (timed out) and the runner moves on. When the suite finishes, macOS shows a notification with passed, failed and skipped counts.

Maestro runs the numbered tests in `PHONE_TESTS.md` on iOS Simulator. Jest and pgTAP stay as they are.

## What talks to which backend

| Command | Env file | Backend |
| --- | --- | --- |
| `npx expo start` | `patria-app/.env` | Hosted test project (unchanged) |
| `npm run e2e:build` / `npm run e2e` | `patria-app/.env.e2e.local` | Local Docker only (`127.0.0.1` / `localhost`) |

`e2e-setup` and `e2e-db-check` refuse to run if the Supabase URL is not local. The local service role key stays in gitignored `.e2e-secrets` or is read from `npx supabase status`. It is never written to the app env and never logged.

## One-time setup

On a Mac that has not built the Simulator app before:

1. Install Homebrew if it is not already installed.
2. `brew install cocoapods`
3. `sudo xcodebuild -license accept`
4. `xcodebuild -runFirstLaunch`
5. Open a fresh terminal so `pod` is on PATH.
6. Java 17+, Xcode, iOS Simulator, Docker.
7. `cd patria-app && npx supabase start`
8. Copy `.e2e-secrets.example` to `.e2e-secrets` and set the three test passwords, or let `e2e-setup` generate local-only passwords into that gitignored file (it never prints them). Optionally set `SUPABASE_SERVICE_ROLE_KEY` from `npx supabase status`; otherwise setup reads it from status.
9. `npm run e2e:setup` (creates/updates Test 1–3, shortens recovery wait to 8 seconds locally, writes `.env.e2e.local` with the anon key only).
10. Install Maestro (`curl -Ls "https://get.maestro.dev" | bash`).
11. `npm run e2e:build` (first time, and after native or env changes). Leave this terminal running Metro; use another terminal for `npm run e2e`.

The development bundle id `app.patria.dev` is provisional (D28).

## Run

```bash
cd patria-app
npm run e2e:smoke
npm run e2e:affected
npm run e2e:full
npm run e2e -- --test 9
E2E_DEVICES=3 npm run e2e -- --test 12
npm run e2e -- --record
npm run e2e -- --no-record
```

`E2E_DEVICES` is `2` by default (device A = stock **iPhone 17 Pro**, device B = a second **iPhone 17 Pro**, created if needed). `1` still works (tests that need a second or third phone are skipped, not failed). `3` automates all of test 12, including **This wasn’t me** on Test 2’s old phone while the new phone waits.

Invite share-sheet **Copy** is attempted; if the sheet is not automatable the step is skipped (manual), and the flow continues with the invite URL from the local database.

Tests 11–12 never write the 24 printed words to a file, log, or screenshot. Optional recordings of those tests stay in `patria-app/e2e-recordings/` (gitignored, this computer only).

## Coverage check

`npm run e2e:check` (also part of `npm run lint`) fails if a numbered test in `PHONE_TESTS.md` has no Maestro flow and is not marked `(manual)` in the heading, or if a flow points at a test that no longer exists.

## Adding a test

Number it after the last test in `PHONE_TESTS.md`, add `patria-app/.maestro/NN_slug.yaml` with `# PHONE_TESTS: NN`, run the flow, and include pass / fail / skip in the summary.
