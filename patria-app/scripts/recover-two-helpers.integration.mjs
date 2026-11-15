#!/usr/bin/env node
/**
 * Local Supabase only. Runs the Jest API integration for A+B finish (ab-only)
 * and the repair → recover path. No Simulator.
 *
 * Usage (from patria-app): node scripts/recover-two-helpers.integration.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  'npx',
  ['jest', 'src/lib/crypto/recoverFlow.api.test.ts', '--runInBand', '--verbose'],
  {
    cwd: APP_ROOT,
    stdio: 'inherit',
    env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
  },
);
process.exit(result.status ?? 1);
