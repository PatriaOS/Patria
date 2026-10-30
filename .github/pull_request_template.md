## Summary

<!-- What changed and why. -->

## Definition of done (tick what applies)

- [ ] `docs/DECISIONS.md` updated if a product or engineering choice changed
- [ ] `docs/testing/PHONE_TESTS.md` and `patria-app/.maestro/` updated if what a person sees or taps changed
- [ ] `docs/BUILD_LOG.md` has an entry for this slice
- [ ] `docs/FEATURES.md` status / acceptance criteria updated if a feature moved forward
- [ ] `README.md` status or getting-started notes updated if needed
- [ ] `docs/trust/` updated if what Patria collects, stores, shares or protects changed (app content must stay in sync via `npm run trust:content`)

## Test plan

- [ ] `npm run test:linux` (from `patria-app/`)
- [ ] `npx supabase test db`
- [ ] `npm run e2e:check`
- [ ] Phone / Maestro flows that apply (list numbers)
