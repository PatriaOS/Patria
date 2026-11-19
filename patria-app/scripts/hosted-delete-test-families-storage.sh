#!/usr/bin/env bash
# Delete Storage files for two hosted test family_space UUIDs (every bucket).
# Run on your Mac only. Never commit the service role key.
#
# Usage (from repo root or patria-app):
#   bash patria-app/scripts/hosted-delete-test-families-storage.sh
#
# Resolves @supabase/supabase-js from patria-app/node_modules (run npm ci there first).
# Secrets: never written to disk. zsh users: read -rs "VAR?prompt " (see below).
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -d "$APP/node_modules/@supabase/supabase-js" ]]; then
  echo "Missing @supabase/supabase-js. Run: cd patria-app && npm ci" >&2
  exit 1
fi

echo "Hosted Storage wipe for Patria test families (files only)."
echo "Paste values from SQL section A / B. Key is never echoed or written to disk."
echo

if [[ -n "${ZSH_VERSION:-}" ]]; then
  # zsh: read -rs "VAR?prompt"
  read -r "SUPABASE_URL?Hosted project URL (https://….supabase.co): "
  read -rs "SUPABASE_SERVICE_ROLE_KEY?Service role key (hidden): "
  echo
  read -r "SPACE_ID_1?Family space UUID 1 (The Paul family): "
  read -r "SPACE_ID_2?Family space UUID 2 (The Femi Family): "
  read -r "CONFIRM?Type DELETE to remove files under those prefixes: "
else
  # bash: read -rs -p "prompt" VAR
  read -r -p "Hosted project URL (https://….supabase.co): " SUPABASE_URL
  read -rs -p "Service role key (hidden): " SUPABASE_SERVICE_ROLE_KEY
  echo
  read -r -p "Family space UUID 1 (The Paul family): " SPACE_ID_1
  read -r -p "Family space UUID 2 (The Femi Family): " SPACE_ID_2
  read -r -p "Type DELETE to remove files under those prefixes: " CONFIRM
fi

export SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SPACE_ID_1 SPACE_ID_2 CONFIRM

cd "$APP"
# Ensure Node resolves the app's dependency tree (not the repo root).
NODE_PATH="$APP/node_modules" node ./scripts/hosted-delete-test-families-storage.mjs
