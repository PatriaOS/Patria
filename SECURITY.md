# Security

Patria is a private family app. Family data is private by default.

## Reporting a security issue

Write to **support.patria@gmail.com**. Please do not open a public GitHub issue for a vulnerability that could put a family’s data at risk. We will answer in plain language.

## Rules we follow in this repository

* Never commit `.env` files, service role keys, recovery codes, or personal passwords.
* Only values prefixed `EXPO_PUBLIC_` may reach the mobile app, and those must be safe to expose (for example the publishable anon key).
* The Supabase service role key stays in gitignored local files for e2e and admin scripts. It must never go in the app bundle.
* Never log keys, recovery codes, invite links, tokens, or personal content.
* Every Postgres table has Row Level Security. Policies are tested.
* Vault-tier content is encrypted on the device before upload. Crypto-related source files are marked `// SECURITY REVIEW REQUIRED`.

See also `docs/trust/HOW_PATRIA_PROTECTS_YOUR_FAMILY.md` and `docs/trust/PRIVACY_STATEMENT.md`.
