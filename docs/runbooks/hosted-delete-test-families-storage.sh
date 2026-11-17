#!/usr/bin/env bash
# Delete Storage files for two hosted test family_space UUIDs (every bucket).
# Run on your Mac only. Never commit the service role key.
#
# Usage (from repo root or anywhere):
#   bash docs/runbooks/hosted-delete-test-families-storage.sh
#
# Requires: Node 22+, patria-app/node_modules/@supabase/supabase-js (npm ci in patria-app).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/patria-app"

if [[ ! -d "$APP/node_modules/@supabase/supabase-js" ]]; then
  echo "Missing @supabase/supabase-js. Run: cd patria-app && npm ci" >&2
  exit 1
fi

echo "Hosted Storage wipe for Patria test families (files only)."
echo "Paste values from SQL section A / B. Key is never echoed or written to disk."
echo

read -r -p "Hosted project URL (https://….supabase.co): " SUPABASE_URL
read -rs -p "Service role key (hidden): " SUPABASE_SERVICE_ROLE_KEY
echo
read -r -p "Family space UUID 1 (The Paul family): " SPACE_ID_1
read -r -p "Family space UUID 2 (The Femi Family): " SPACE_ID_2
read -r -p "Type DELETE to remove files under those prefixes: " CONFIRM

export SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SPACE_ID_1 SPACE_ID_2 CONFIRM

cd "$APP"
node "$ROOT/docs/runbooks/hosted-delete-test-families-storage.mjs"
