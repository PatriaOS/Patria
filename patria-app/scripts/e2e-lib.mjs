import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = join(APP_ROOT, '..');
export const PHONE_TESTS = join(REPO_ROOT, 'docs', 'testing', 'PHONE_TESTS.md');
export const MAESTRO_DIR = join(APP_ROOT, '.maestro');
export const E2E_FAMILY_NAME = 'E2E Family';
export const TEST_TIMEOUT_MS = 10 * 60 * 1000;
export const TEST_12_TIMEOUT_MS = 20 * 60 * 1000;

export function timeoutMsForTest(testNumber) {
  return testNumber === 12 ? TEST_12_TIMEOUT_MS : TEST_TIMEOUT_MS;
}
export const APP_BUNDLE_ID = 'app.patria.dev';
export const LARGE_TEXT_CATEGORY = 'UIContentSizeCategoryAccessibilityXXL';

export function scenarioForTest(testNumber) {
  if (testNumber === 6 || testNumber === 8 || testNumber === 9) {
    return 'admin-elder';
  }
  if (testNumber === 11 || testNumber === 12 || testNumber === 13) {
    return 'admin-elders';
  }
  if (testNumber === 14 || testNumber === 19) {
    return 'admin-elder';
  }
  if (testNumber === 15 || testNumber === 16 || testNumber === 17) {
    return 'admin-elder-extended';
  }
  if (testNumber === 26 || testNumber === 28 || testNumber === 30 || testNumber === 31 || testNumber === 32 || testNumber === 33 || testNumber === 34) {
    return 'admin-elders';
  }
  if (testNumber === 27) {
    return 'admin-elder-teen';
  }
  if (testNumber === 29 || testNumber === 35) {
    return 'admin-elder';
  }
  return 'admin';
}

export function e2eDeviceCount(raw = process.env.E2E_DEVICES || '2') {
  const count = Number(raw);
  if (![1, 2, 3].includes(count)) {
    throw new Error('E2E_DEVICES must be 1, 2 or 3.');
  }
  return count;
}

export function listIphones() {
  const raw = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], {
    encoding: 'utf8',
  });
  const json = JSON.parse(raw);
  const devices = [];
  for (const runtime of Object.values(json.devices ?? {})) {
    for (const device of runtime) {
      if (device.isAvailable && /iPhone/i.test(device.name)) {
        devices.push(device);
      }
    }
  }
  return devices;
}

export function bootDevices(count) {
  const available = listIphones();
  const use = Math.min(count, available.length);
  if (use === 0) {
    throw new Error('No iPhone simulators available. Install an iOS runtime in Xcode.');
  }
  const picked = available.slice(0, use);
  for (const device of picked) {
    if (device.state !== 'Booted') {
      execFileSync('xcrun', ['simctl', 'boot', device.udid], { stdio: 'ignore' });
    }
  }
  return picked.map((device) => device.udid);
}

export function appInstalled(udid) {
  try {
    execFileSync('xcrun', ['simctl', 'get_app_container', udid, APP_BUNDLE_ID], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

export function appContainerPath(udid) {
  return execFileSync('xcrun', ['simctl', 'get_app_container', udid, APP_BUNDLE_ID], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function installApp(udid, appPath) {
  execFileSync('xcrun', ['simctl', 'install', udid, appPath], { stdio: 'inherit' });
}

export function assertAppInstalledOn(udids, scriptName) {
  const missing = udids.filter((udid) => !appInstalled(udid));
  if (missing.length === 0) {
    return;
  }
  throw new Error(
    `${scriptName}: ${APP_BUNDLE_ID} is not installed on simulator(s) ${missing.join(', ')}. Run npm run e2e:build with the same E2E_DEVICES.`,
  );
}

export function setPreferredContentSize(udid, category) {
  if (!category) {
    try {
      execFileSync(
        'xcrun',
        ['simctl', 'spawn', udid, 'defaults', 'delete', '-g', 'UIPreferredContentSizeCategoryName'],
        { stdio: 'ignore' },
      );
    } catch {
      // Already at the system default.
    }
    return;
  }
  execFileSync(
    'xcrun',
    ['simctl', 'spawn', udid, 'defaults', 'write', '-g', 'UIPreferredContentSizeCategoryName', '-string', category],
    { stdio: 'ignore' },
  );
}

export function sleepMs(ms) {
  execFileSync('sleep', [String(ms / 1000)]);
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadLocalFiles() {
  const e2eEnv = parseEnvFile(join(APP_ROOT, '.env.e2e.local'));
  const secrets = parseEnvFile(join(APP_ROOT, '.e2e-secrets'));
  return { e2eEnv, secrets };
}

export function publicExpoEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('EXPO_PUBLIC_')) {
      out[key] = value;
    }
  }
  return out;
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;
const ENV_MODULE =
  /(?:from|import)\s+['"][^'"]*\.env(?:\.[^'"]*)?['"]|require\(\s*['"][^'"]*\.env(?:\.[^'"]*)?['"]\s*\)/;

export function assertEnvFilesNotInAppImportGraph(scriptName) {
  const hits = [];
  for (const dir of ['app', 'src']) {
    collectEnvImports(join(APP_ROOT, dir), hits);
  }
  if (hits.length === 0) {
    return;
  }
  console.error(
    `${scriptName} refused to run: env files must never be imported into the app bundle. Metro would try to parse them as JavaScript.`,
  );
  for (const hit of hits) {
    console.error(`  ${hit}`);
  }
  process.exit(1);
}

function collectEnvImports(dir, hits) {
  if (!existsSync(dir)) {
    return;
  }
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === 'node_modules') {
        continue;
      }
      collectEnvImports(path, hits);
      continue;
    }
    if (!SOURCE_EXT.test(name)) {
      continue;
    }
    const text = readFileSync(path, 'utf8');
    if (ENV_MODULE.test(text)) {
      hits.push(relative(APP_ROOT, path));
    }
  }
}

export function supabaseUrlFromEnv(env) {
  return env.EXPO_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? '';
}

export function assertLocalSupabaseUrl(url, scriptName) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    console.error(
      `${scriptName} refused to run: missing or invalid Supabase URL. Use local Docker only (http://127.0.0.1:54321).`,
    );
    process.exit(1);
  }
  if (!LOCAL_HOSTS.has(host)) {
    console.error(
      `${scriptName} refused to run: Supabase URL host is "${host}", not 127.0.0.1 or localhost. This script only talks to local Docker.`,
    );
    process.exit(1);
  }
}

export const TEST_EMAILS = {
  1: 'femipaul7535+test1@gmail.com',
  2: 'femipaul7535+test2@gmail.com',
  3: 'femipaul7535+test3@gmail.com',
};

export function passwordFor(secrets, n) {
  return secrets[`E2E_PASSWORD_TEST${n}`] ?? '';
}

export function redact(value) {
  if (!value) {
    return '';
  }
  if (value.length < 8) {
    return '(redacted)';
  }
  return `${value.slice(0, 4)}…`;
}

export function supabaseStatusEnv() {
  const raw = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    cwd: APP_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (raw.startsWith('{')) {
    return JSON.parse(raw);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }
    env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return env;
}

export function findSupabaseDbContainer() {
  const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  return names.find((name) => /supabase_db/i.test(name)) ?? '';
}

export function runLocalSql(dbUrl, statement, tuplesOnly = false) {
  const psqlArgs = ['-v', 'ON_ERROR_STOP=1'];
  if (tuplesOnly) {
    psqlArgs.push('-At');
  }
  psqlArgs.push('-c', statement);
  try {
    return execFileSync('psql', [dbUrl, ...psqlArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      throw error;
    }
  }
  const container = findSupabaseDbContainer();
  if (!container) {
    throw new Error('psql is not on PATH and no supabase_db Docker container is running.');
  }
  return execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', ...psqlArgs],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

export function ensureJavaHome() {
  if (process.env.JAVA_HOME) {
    return;
  }
  try {
    process.env.JAVA_HOME = execFileSync('/usr/libexec/java_home', {
      encoding: 'utf8',
    }).trim();
  } catch {
    // Maestro will fail with a clear Java error if nothing is installed.
  }
}

export const PHONE_AREA_LIST = [
  'auth',
  'navigation',
  'invites',
  'children',
  'keys',
  'devices',
  'recovery',
  'rotation',
  'membership',
  'memories',
  'vault',
];

export const SMOKE_TEST_NUMBERS = [1, 3, 8];

export function parseAreaList(raw) {
  return [...new Set((raw ?? '').split(',').map((part) => part.trim()).filter(Boolean))];
}

export function parsePhoneTests(markdown) {
  const tests = [];
  const heading = /^### (\d+)\.\s+(.+)$/gm;
  let match = heading.exec(markdown);
  while (match) {
    const number = Number(match[1]);
    const title = match[2].trim();
    const start = match.index + match[0].length;
    const next = heading.exec(markdown);
    const body = markdown.slice(start, next ? next.index : markdown.length);
    const areasMatch = body.match(/^Areas:\s*(.+)$/m);
    const areas = parseAreaList(areasMatch ? areasMatch[1] : '');
    const steps = [];
    const stepRe = /^(\d+)\.\s+(.+)$/gm;
    let stepMatch = stepRe.exec(body);
    while (stepMatch) {
      steps.push({
        number: Number(stepMatch[1]),
        text: stepMatch[2].trim(),
        manual: /\(manual\)/i.test(stepMatch[2]),
      });
      stepMatch = stepRe.exec(body);
    }
    tests.push({
      number,
      title,
      manual: /\(manual\)/i.test(title),
      areas,
      steps,
    });
    match = next;
  }
  return tests;
}

function gitVerifyRef(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', ref], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function gitBaseRef() {
  if (gitVerifyRef('main')) {
    return 'main';
  }
  if (gitVerifyRef('origin/main')) {
    return 'origin/main';
  }
  if (gitVerifyRef('master')) {
    return 'master';
  }
  return '';
}

export function changedFilesVsMain() {
  const base = gitBaseRef();
  if (!base) {
    return { base: '', files: [] };
  }
  const names = new Set();
  for (const args of [
    ['diff', '--name-only', base],
    ['diff', '--name-only', '--cached', base],
    ['diff', '--name-only', `${base}...HEAD`],
  ]) {
    const raw = execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const line of raw.split('\n')) {
      const name = line.trim();
      if (name) {
        names.add(name);
      }
    }
  }
  return { base, files: [...names].sort() };
}

export function mapFileToAreas(file) {
  const n = file.replace(/\\/g, '/');
  const areas = new Set();
  if (
    /patria-app\/src\/lib\/auth|auth-context|authSession|sessionGate|signed-out/.test(n)
  ) {
    areas.add('auth');
  }
  if (/patria-app\/\.maestro\/subflows\/sign_(in|out)/.test(n)) {
    areas.add('auth');
  }
  if (/patria-app\/src\/components|patria-app\/src\/theme|app\/_layout/.test(n)) {
    areas.add('navigation');
  }
  if (/01_back_navigation|02_pull_to_refresh|07_large_text/.test(n)) {
    areas.add('navigation');
  }
  if (/patria-app\/src\/features\/invites|inviteUrl|InviteScreen|InvitePreview/.test(n)) {
    areas.add('invites');
  }
  if (/AddChild|ChildProfile|child_profiles|06_add_a_child/.test(n)) {
    areas.add('children');
  }
  if (/patria-app\/src\/features\/family/.test(n) && !/AddChild|ChildProfile/.test(n)) {
    areas.add('membership');
    areas.add('navigation');
  }
  if (/YourPhones|approve_own|10_approve_own|deviceAccess|deviceIdentity/.test(n)) {
    areas.add('devices');
    areas.add('keys');
  }
  if (/recoverFlow|RecoverySetup|recoverySetup|recoveryAccess|11_recovery|12_recover/.test(n)) {
    areas.add('recovery');
    areas.add('keys');
  }
  if (/rotateFamilyKey|13_key_rotation|on_key_holder/.test(n)) {
    areas.add('rotation');
    areas.add('keys');
  }
  if (
    /familyCeremony|family_key|patria-app\/src\/lib\/crypto|patria-app\/src\/features\/keys/.test(n)
  ) {
    areas.add('keys');
  }
  if (/patria-app\/src\/features\/memories|memory_items|14_add_photos|15_circle|16_move|17_access/.test(n)) {
    areas.add('memories');
  }
  if (
    /patria-app\/src\/features\/vault|vaultEnvelope|vaultDrafts|vaultAudio|personalKey|vault_entries|leg01|d34|26_write|27_teen|28_follow|29_recovery_first|30_read_after|31_voice|32_only_me|33_visibility|34_only_me_phone|35_leave_only_me/.test(
      n,
    )
  ) {
    areas.add('vault');
    areas.add('keys');
  }
  if (n.includes('patria-app/supabase')) {
    if (/memory_items|mem_rls|memories/.test(n)) {
      areas.add('memories');
    } else if (/vault_entries|leg01|d34_vault|vault_voice/.test(n)) {
      areas.add('vault');
      areas.add('keys');
      areas.add('rotation');
    } else {
      areas.add('membership');
      areas.add('invites');
      areas.add('keys');
      areas.add('recovery');
      areas.add('rotation');
      areas.add('devices');
    }
  }
  return [...areas];
}

export function newTestNumbersVsMain(tests) {
  const base = gitBaseRef();
  if (!base) {
    return [];
  }
  try {
    const oldMarkdown = execFileSync('git', ['show', `${base}:docs/testing/PHONE_TESTS.md`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const oldNumbers = new Set(parsePhoneTests(oldMarkdown).map((test) => test.number));
    return tests.map((test) => test.number).filter((number) => !oldNumbers.has(number));
  } catch {
    return [];
  }
}

export function selectAffectedPhoneTests(tests) {
  const { base, files } = changedFilesVsMain();
  const reasons = [];
  const chosen = new Set();
  if (!base) {
    reasons.push('e2e:affected: no main branch to diff against.');
    return { numbers: [], reasons, files, base };
  }
  if (files.length === 0) {
    reasons.push(`e2e:affected: no files differ from ${base}.`);
    return { numbers: [], reasons, files, base };
  }
  reasons.push(`e2e:affected: ${files.length} file(s) differ from ${base}.`);
  const areas = new Set();
  for (const file of files) {
    const flow = file.match(/\.maestro\/(\d+)_/);
    if (flow) {
      const number = Number(flow[1]);
      chosen.add(number);
      reasons.push(`  test ${number}: flow file ${file} changed`);
    }
    const mapped = mapFileToAreas(file);
    for (const area of mapped) {
      areas.add(area);
    }
    reasons.push(
      mapped.length ? `  ${file} → ${mapped.join(', ')}` : `  ${file} → (no area)`,
    );
  }
  if (areas.size > 0) {
    reasons.push(`e2e:affected: areas ${[...areas].sort().join(', ')}`);
  }
  for (const test of tests) {
    const hit = (test.areas ?? []).filter((area) => areas.has(area));
    if (hit.length > 0) {
      chosen.add(test.number);
      reasons.push(`  test ${test.number} (${test.title}): ${hit.join(', ')}`);
    }
  }
  for (const number of newTestNumbersVsMain(tests)) {
    chosen.add(number);
    reasons.push(`  test ${number}: new in PHONE_TESTS.md vs ${base}`);
  }
  return {
    numbers: [...chosen].sort((left, right) => left - right),
    reasons,
    files,
    base,
  };
}
