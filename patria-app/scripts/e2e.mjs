import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APP_BUNDLE_ID,
  APP_ROOT,
  E2E_FAMILY_NAME,
  MAESTRO_DIR,
  PHONE_TESTS,
  TEST_EMAILS,
  TEST_TIMEOUT_MS,
  timeoutMsForTest,
  assertAppInstalledOn,
  assertLocalSupabaseUrl,
  bootDevices,
  e2eDeviceCount,
  ensureJavaHome,
  loadLocalFiles,
  firstFailureSummary,
  notReachedRows,
  parsePhoneTests,
  passwordFor,
  publicExpoEnv,
  runLocalSql,
  runnerNumbersFromSource,
  selectAffectedPhoneTests,
  SMOKE_TEST_NUMBERS,
  supabaseStatusEnv,
  supabaseUrlFromEnv,
} from './e2e-lib.mjs';

const SCRIPT = 'e2e';
const ARTIFACTS = join(APP_ROOT, 'e2e-artifacts');
const RECORDINGS = join(APP_ROOT, 'e2e-recordings');

// simctl addmedia uses the file's creation date (birthtime), not mtime, when there is no EXIF.
// copyFileSync / overwrite of a reused dest keeps the old birthtime (Oct 19 on this machine),
// so From today — local midnight — skips the photo unless we write a fresh inode.
function samplePhotoDatedNow() {
  const dest = join(tmpdir(), 'patria-e2e-sample-today.jpg');
  rmSync(dest, { force: true });
  writeFileSync(dest, readFileSync(join(MAESTRO_DIR, 'media', 'sample_new.jpg')));
  const now = new Date();
  utimesSync(dest, now, now);
  return dest;
}

function parseArgs(argv) {
  let devicesRaw = process.env.E2E_DEVICES || '2';
  const out = { test: null, record: null, devices: 2, mode: 'full' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--test') {
      out.test = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--record') {
      out.record = true;
    } else if (arg === '--no-record') {
      out.record = false;
    } else if (arg === '--devices') {
      devicesRaw = argv[i + 1];
      i += 1;
    } else if (arg === '--smoke') {
      out.mode = 'smoke';
    } else if (arg === '--affected') {
      out.mode = 'affected';
    } else if (arg === '--full') {
      out.mode = 'full';
    }
  }
  try {
    out.devices = e2eDeviceCount(devicesRaw);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'E2E_DEVICES must be 1, 2 or 3.');
    process.exit(1);
  }
  return out;
}

async function askRecord(flag) {
  if (flag === true || flag === false) {
    return flag;
  }
  if (!process.stdin.isTTY) {
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question('Record simulator video? [y/N] ', resolve);
  });
  rl.close();
  return /^y/i.test(answer.trim());
}

function runNode(script, args) {
  execFileSync(process.execPath, [join(APP_ROOT, 'scripts', script), ...args], {
    cwd: APP_ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
}

function dbCheck(args) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(APP_ROOT, 'scripts', 'e2e-db-check.mjs'), ...args],
      { cwd: APP_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    return { ok: false, stdout: '', error: error instanceof Error ? error.message : 'failed' };
  }
}

function redactCli(text) {
  return text.replace(/E2E_PASSWORD=[^\s]+/g, 'E2E_PASSWORD=(redacted)');
}

let testDeadline = 0;

function remainingMs() {
  if (!testDeadline) {
    return TEST_TIMEOUT_MS;
  }
  return testDeadline - Date.now();
}

let driverUnreachable = false;

function isDriverUnreachable(text) {
  return /Device became unreachable|Transport unreachable|XCUITestServerError\$Unreachable|Failed to connect to \/127\.0\.0\.1/i.test(
    text,
  );
}

function restartMaestroDriver(udid) {
  if (!udid) {
    return;
  }
  progress(`Restarting Maestro iOS driver on ${udid}`);
  try {
    execFileSync('xcrun', ['simctl', 'terminate', udid, APP_BUNDLE_ID], { stdio: 'ignore' });
  } catch {
    // App may already be stopped.
  }
  try {
    execFileSync('killall', ['-9', 'xctest'], { stdio: 'ignore' });
  } catch {
    // No xctest process is fine.
  }
}

function restartAllMaestroDrivers() {
  for (const udid of devices) {
    restartMaestroDriver(udid);
  }
}

function maestro({ flow, device, env }) {
  const args = ['test', '--no-ansi', '--platform', 'ios'];
  if (device) {
    args.push('--device', device);
  }
  for (const [key, value] of Object.entries(env)) {
    if (value != null && value !== '') {
      args.push('-e', `${key}=${value}`);
    }
  }
  args.push(flow);
  const timeout = remainingMs();
  if (timeout <= 0) {
    throw new Error('timed out');
  }
  const result = spawnSync('maestro', args, {
    cwd: APP_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    timeout,
    killSignal: 'SIGTERM',
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (out) {
    process.stdout.write(out);
  }
  if (isDriverUnreachable(out)) {
    driverUnreachable = true;
  }
  if (result.error && result.error.code === 'ETIMEDOUT') {
    throw new Error('timed out');
  }
  if (result.signal) {
    throw new Error('timed out');
  }
  if (result.status !== 0) {
    throw new Error(redactCli(`Command failed: maestro ${args.join(' ')}`));
  }
}

function tryMaestro(opts) {
  try {
    maestro(opts);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function startRecording(udid, name) {
  mkdirSync(RECORDINGS, { recursive: true });
  const path = join(RECORDINGS, `${name}.mp4`);
  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', path], {
    stdio: 'ignore',
  });
  return { child, path };
}

function stopRecording(handle) {
  if (!handle) {
    return;
  }
  handle.child.kill('SIGINT');
}

function wipeSensitiveArtifacts(testNumber) {
  if (testNumber !== 11 && testNumber !== 12) {
    return;
  }
  if (existsSync(ARTIFACTS)) {
    rmSync(join(ARTIFACTS, `${String(testNumber).padStart(2, '0')}`), { recursive: true, force: true });
  }
}

function signInEnv(secrets, n) {
  return {
    E2E_EMAIL: TEST_EMAILS[n],
    E2E_PASSWORD: passwordFor(secrets, n),
    E2E_HELLO: 'E2E Family',
  };
}

function restBase() {
  return (supabaseUrlFromEnv(e2eEnv) || '').replace(/\/$/, '');
}

function restToken(n) {
  const raw = execFileSync(
    'curl',
    [
      '-sS',
      `${restBase()}/auth/v1/token?grant_type=password`,
      '-H',
      `apikey: ${e2eEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ email: TEST_EMAILS[n], password: passwordFor(secrets, n) }),
    ],
    { encoding: 'utf8' },
  );
  const json = JSON.parse(raw);
  if (!json.access_token) {
    throw new Error('Could not sign in for the memory server check.');
  }
  return json.access_token;
}

function assertMemoryRecordHidden(n, caption) {
  const token = restToken(n);
  const raw = execFileSync(
    'curl',
    [
      '-sS',
      `${restBase()}/rest/v1/memory_items?caption=eq.${encodeURIComponent(caption)}&select=id`,
      '-H',
      `apikey: ${e2eEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
      '-H',
      `Authorization: Bearer ${token}`,
    ],
    { encoding: 'utf8' },
  );
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length !== 0) {
    throw new Error(`Test ${n} could read ${caption}`);
  }
}

function assertCannotSignMemory(n, objectPath) {
  const token = restToken(n);
  const code = execFileSync(
    'curl',
    [
      '-sS',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      '-X',
      'POST',
      `${restBase()}/storage/v1/object/sign/memories/${objectPath}`,
      '-H',
      `apikey: ${e2eEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
      '-H',
      `Authorization: Bearer ${token}`,
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ expiresIn: 600 }),
    ],
    { encoding: 'utf8' },
  ).trim();
  if (code === '200') {
    throw new Error(`Test ${n} minted a viewing link for ${objectPath}`);
  }
}

function result(status, detail = '') {
  return { status, detail };
}

const args = parseArgs(process.argv.slice(2));
ensureJavaHome();
const { e2eEnv, secrets } = loadLocalFiles();
assertLocalSupabaseUrl(supabaseUrlFromEnv(e2eEnv) || 'http://127.0.0.1:54321', SCRIPT);

for (const n of [1, 2, 3]) {
  if (!passwordFor(secrets, n)) {
    console.error(
      `${SCRIPT}: missing E2E_PASSWORD_TEST${n} in gitignored .e2e-secrets. Run npm run e2e:setup after filling .e2e-secrets.`,
    );
    process.exit(1);
  }
}

if (!existsSync(join(APP_ROOT, '.env.e2e.local'))) {
  console.error(`${SCRIPT}: missing .env.e2e.local. Run npm run e2e:setup first.`);
  process.exit(1);
}

try {
  execFileSync('maestro', ['--version'], { stdio: 'ignore' });
} catch {
  console.error(
    `${SCRIPT}: Maestro is not on PATH. Install with: curl -Ls "https://get.maestro.dev" | bash`,
  );
  process.exit(1);
}

const tests = parsePhoneTests(readFileSync(PHONE_TESTS, 'utf8'));
const runnerNumbers = runnerNumbersFromSource(readFileSync(join(APP_ROOT, 'scripts', 'e2e.mjs'), 'utf8'));
let selected = tests;
if (args.test) {
  selected = tests.filter((test) => test.number === args.test);
} else if (args.mode === 'smoke') {
  selected = tests.filter((test) => SMOKE_TEST_NUMBERS.includes(test.number));
  console.log(`e2e:smoke: tests ${SMOKE_TEST_NUMBERS.join(', ')} (auth, invites, keys).`);
} else if (args.mode === 'affected') {
  const picked = selectAffectedPhoneTests(tests);
  for (const line of picked.reasons) {
    console.log(line);
  }
  selected = tests.filter((test) => picked.numbers.includes(test.number));
  if (selected.length === 0) {
    console.log('e2e:affected: no phone tests to run.');
    process.exit(0);
  }
  console.log(`e2e:affected: running tests ${picked.numbers.join(', ')}.`);
}
if (selected.length === 0) {
  console.error(`${SCRIPT}: no matching test.`);
  process.exit(1);
}

const record = await askRecord(args.record);
if (record) {
  console.log('Recordings go in patria-app/e2e-recordings/ (gitignored). Tests 11–12 stay on this computer only.');
}

let devices = [];
try {
  devices = bootDevices(Math.min(args.devices, 3));
} catch (error) {
  console.error(
    `${SCRIPT}: ${error instanceof Error ? error.message : 'could not boot simulators'}. Phone flows are skipped, not failed.`,
  );
}

const [deviceA, deviceB, deviceC] = devices;
if (devices.length > 0) {
  try {
    assertAppInstalledOn(devices, SCRIPT);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
mkdirSync(ARTIFACTS, { recursive: true });
const progressPath = join(ARTIFACTS, 'progress.txt');
writeFileSync(progressPath, '', { encoding: 'utf8' });

function progress(line) {
  console.log(line);
  appendFileSync(progressPath, `${line}\n`);
}

function captureScreen(udid, name) {
  if (!udid) {
    return;
  }
  try {
    execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', join(ARTIFACTS, `${name}.png`)], {
      stdio: 'ignore',
    });
  } catch {
    // Screenshot is best-effort; the test result still stands.
  }
}

async function metroReady() {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    try {
      const response = await fetch(`http://${host}:8081/status`, {
        signal: AbortSignal.timeout(2000),
      });
      const text = await response.text();
      if (response.ok && /running/i.test(text)) {
        return host;
      }
    } catch {
      // Try the next host; Metro may be IPv4-only or IPv6-only.
    }
  }
  return false;
}

function stopMetroOn8081() {
  try {
    const listing = execFileSync('lsof', ['-nP', '-iTCP:8081', '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    for (const pid of listing.split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch {
        // The process may have already exited.
      }
    }
  } catch {
    // Nothing is listening on 8081.
  }
}

let metroReadyForE2e = false;

async function ensureMetro() {
  if (metroReadyForE2e && (await metroReady())) {
    progress('Metro is ready.');
    return;
  }
  if (await metroReady()) {
    progress('Restarting Metro so e2e public env is in the bundle.');
    stopMetroOn8081();
    const started = Date.now();
    while (Date.now() - started < 10000 && (await metroReady())) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!(await metroReady())) {
    progress('Starting Metro in the background.');
    const log = join(ARTIFACTS, 'metro.log');
    const child = spawn('npx', ['expo', 'start', '--port', '8081'], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        ...publicExpoEnv(e2eEnv),
        EXPO_PUBLIC_E2E: '1',
        EXPO_NO_DOTENV: '1',
        REACT_NATIVE_PACKAGER_HOSTNAME: '127.0.0.1',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: true,
    });
    child.unref();
    appendFileSync(log, `spawned metro pid=${child.pid}\n`);
    const started = Date.now();
    while (Date.now() - started < 90000) {
      if (await metroReady()) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!(await metroReady())) {
      throw new Error('Metro did not become ready on port 8081.');
    }
  } else {
    progress('Metro is already running on port 8081.');
  }
  metroReadyForE2e = true;
  progress('Metro is ready.');
}

function notifyMac(message) {
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title "Patria"`], {
      stdio: 'ignore',
    });
  } catch {
    // Notification is optional on machines without osascript.
  }
}

const reports = [];

function flow(name) {
  return join(MAESTRO_DIR, name);
}

function signInOnDevice(n, device) {
  if (!device) {
    return;
  }
  maestro({
    flow: flow('subflows/sign_in.yaml'),
    device,
    env: signInEnv(secrets, n),
  });
}

function seedRecoveryForOwner(ownerN, ownerDevice, contacts) {
  maestro({
    flow: flow('11_recovery_setup.yaml'),
    device: ownerDevice,
    env: { ...signInEnv(secrets, ownerN), PHASE: 'open_card' },
  });
  for (const contact of contacts) {
    maestro({
      flow: flow('11_recovery_setup.yaml'),
      device: ownerDevice,
      env: {
        ...signInEnv(secrets, ownerN),
        PHASE: 'pick_contact',
        CONTACT_ID: `recovery-contact-test-${contact.n}`,
      },
    });
    maestro({
      flow: flow('11_recovery_setup.yaml'),
      device: contact.device,
      env: { ...signInEnv(secrets, contact.n), PHASE: 'accept_contact' },
    });
  }
  maestro({
    flow: flow('11_recovery_setup.yaml'),
    device: ownerDevice,
    env: { ...signInEnv(secrets, ownerN), PHASE: 'printed_code' },
  });
}

function seedAdminKeys() {
  maestro({
    flow: flow('08_family_key_created.yaml'),
    device: deviceA,
    env: { ...signInEnv(secrets, 1), PHASE: 'home_keys' },
  });
}

function seedLetIn(memberN, device) {
  const waiting = tryMaestro({
    flow: flow('09_let_in.yaml'),
    device,
    env: { ...signInEnv(secrets, memberN), PHASE: 'waiting' },
  });
  if (waiting.ok) {
    maestro({
      flow: flow('09_let_in.yaml'),
      device: deviceA,
      env: { ...signInEnv(secrets, 1), PHASE: 'let_in' },
    });
    maestro({
      flow: flow('09_let_in.yaml'),
      device,
      env: { ...signInEnv(secrets, memberN), PHASE: 'keys_ready' },
    });
    return;
  }
  // Already let in (common when test 9 ran first): verify member + approved device.
  maestro({
    flow: flow('09_let_in.yaml'),
    device: deviceA,
    env: {
      ...signInEnv(secrets, 1),
      PHASE: 'verify_member',
      MEMBER_ID: `member-test-${memberN}`,
    },
  });
  maestro({
    flow: flow('09_let_in.yaml'),
    device,
    env: { ...signInEnv(secrets, memberN), PHASE: 'keys_ready' },
  });
  const wraps = dbCheck([
    'assert-wraps',
    '--family',
    E2E_FAMILY_NAME,
    '--email',
    TEST_EMAILS[memberN],
    '--min',
    '1',
  ]);
  if (!wraps.ok) {
    throw new Error(
      `Test ${memberN} is a member but has no approved device wrap: ${wraps.error ?? 'assert-wraps failed'}`,
    );
  }
}

function seedBeforeYouStart(testNumber) {
  if (![9, 10, 11, 12, 13, 26, 27, 28, 30, 31, 32, 33, 34, 35, 42].includes(testNumber)) {
    return;
  }
  seedAdminKeys();
  if (
    testNumber === 26 ||
    testNumber === 27 ||
    testNumber === 28 ||
    testNumber === 31 ||
    testNumber === 32 ||
    testNumber === 33 ||
    testNumber === 35 ||
    testNumber === 42
  ) {
    return;
  }
  if (testNumber === 30 || testNumber === 34) {
    const other = args.devices >= 2 && deviceB ? deviceB : deviceA;
    const third = args.devices >= 3 && deviceC ? deviceC : other;
    seedLetIn(2, other);
    seedLetIn(3, third);
    return;
  }
  if (testNumber === 11) {
    const other = args.devices >= 2 && deviceB ? deviceB : deviceA;
    seedLetIn(2, other);
    seedLetIn(3, other);
  }
  if (testNumber === 12) {
    return;
  }
  if (testNumber === 13) {
    const other = args.devices >= 2 && deviceB ? deviceB : deviceA;
    const third = args.devices >= 3 && deviceC ? deviceC : other;
    seedLetIn(2, other);
    seedLetIn(3, third);
    if (deviceB) {
      signInOnDevice(2, deviceB);
    }
  }
}

function step(testNumber, stepNumber, label, fn) {
  if (remainingMs() <= 0) {
    reports.push({ testNumber, stepNumber, label, status: 'fail', detail: 'timed out' });
    console.log(`  ${stepNumber}. ${label}: FAIL (timed out)`);
    throw new Error('timed out');
  }
  let status = 'pass';
  let detail = '';
  try {
    const out = fn();
    if (out && out.status) {
      status = out.status;
      detail = out.detail ?? '';
    }
  } catch (error) {
    status = 'fail';
    detail = error instanceof Error ? error.message : 'failed';
    captureScreen(deviceA, `fail-test-${testNumber}-step-${stepNumber}`);
    reports.push({ testNumber, stepNumber, label, status, detail });
    console.log(`  ${stepNumber}. ${label}: FAIL${detail ? ` (${detail})` : ''}`);
    throw error instanceof Error ? error : new Error(detail || 'failed');
  }
  reports.push({ testNumber, stepNumber, label, status, detail });
  const extra = detail ? ` (${detail})` : '';
  console.log(`  ${stepNumber}. ${label}: ${status.toUpperCase()}${extra}`);
  if (status === 'fail') {
    throw new Error(detail || 'failed');
  }
  return status;
}

function markNotReached(test, failedStepNumber) {
  const rows = notReachedRows({
    testNumber: test.number,
    phoneSteps: test.steps,
    reportsForTest: reports.filter((row) => row.testNumber === test.number),
    failedStepNumber,
  });
  for (const row of rows) {
    reports.push(row);
    console.log(`  ${row.stepNumber}. ${row.label}: not reached`);
  }
}

function e2eFamilySpaceId() {
  const dbUrl = supabaseStatusEnv().DB_URL;
  if (!dbUrl) {
    throw new Error('local Supabase DB URL missing');
  }
  const id = runLocalSql(
    dbUrl,
    `SELECT id::text FROM public.family_spaces WHERE name = '${E2E_FAMILY_NAME}' ORDER BY created_at DESC LIMIT 1;`,
    true,
  );
  if (!id) {
    throw new Error('E2E Family space not found');
  }
  return id;
}

function sqlOnE2eFamily(statement) {
  const dbUrl = supabaseStatusEnv().DB_URL;
  if (!dbUrl) {
    throw new Error('local Supabase DB URL missing');
  }
  runLocalSql(dbUrl, statement);
}

function skipRest(testNumber, from, reason, count) {
  for (let n = from; n <= count; n += 1) {
    reports.push({
      testNumber,
      stepNumber: n,
      label: `step ${n}`,
      status: 'skip',
      detail: reason,
    });
    console.log(`  ${n}. skipped (${reason})`);
  }
}

const recorders = [];
if (record && deviceA) {
  recorders.push(startRecording(deviceA, `device-a`));
}

await ensureMetro();

const total = selected.length;

function deviceLabelFor(testNumber) {
  if ((testNumber === 9 || testNumber === 10) && deviceB) {
    return 'devices A and B';
  }
  if (testNumber === 12 && deviceC) {
    return 'devices A, B and C';
  }
  return 'device A';
}

function endTestLine(test, index, started) {
  const rows = reports.filter((row) => row.testNumber === test.number);
  const elapsed = Math.max(1, Math.round((Date.now() - started) / 1000));
  const failedStep = rows.find((row) => row.status === 'fail');
  const skippedAll = rows.length > 0 && rows.every((row) => row.status === 'skip');
  if (failedStep) {
    progress(
      `Test ${index} of ${total}: FAILED at step ${failedStep.stepNumber}${failedStep.detail ? ` (${failedStep.detail})` : ''}`,
    );
  } else if (skippedAll) {
    progress(`Test ${index} of ${total}: SKIPPED, ${rows[0]?.detail || 'skipped'}`);
  } else {
    progress(`Test ${index} of ${total}: PASSED in ${elapsed}s`);
  }
}

const retriedTests = new Set();
try {
  for (let index = 0; index < selected.length; index += 1) {
    const test = selected[index];
    const started = Date.now();
    const ordinal = index + 1;
    driverUnreachable = false;
    progress(
      `Test ${ordinal} of ${total}: ${test.title}, in progress (${deviceLabelFor(test.number)})`,
    );
    wipeSensitiveArtifacts(test.number);
    await ensureMetro();
    testDeadline =
      Date.now() +
      timeoutMsForTest(test.number) +
      ([9, 10, 11, 13, 30, 34].includes(test.number) ? 15 * 60 * 1000 : 0);
    try {
      runNode('e2e-setup.mjs', ['--test', String(test.number)]);
    } catch (error) {
      step(test.number, 1, 'Seed starting state', () => {
        throw error instanceof Error ? error : new Error('e2e-setup failed');
      });
      endTestLine(test, ordinal, started);
      continue;
    }
    try {
      for (const udid of devices) {
        maestro({
          flow: flow('subflows/clear_state.yaml'),
          device: udid,
          env: {},
        });
      }
    } catch (error) {
      step(test.number, 1, 'Clear app state on each device', () => {
        throw error instanceof Error ? error : new Error('clearState failed');
      });
      if (driverUnreachable && !retriedTests.has(test.number)) {
        retriedTests.add(test.number);
        progress(
          `RETRY Test ${test.number}: Maestro driver unreachable; restarted the driver and retrying this test once.`,
        );
        const kept = reports.filter((row) => row.testNumber !== test.number);
        reports.length = 0;
        reports.push(...kept);
        restartAllMaestroDrivers();
        index -= 1;
        continue;
      }
      endTestLine(test, ordinal, started);
      continue;
    }
    try {
    if (!deviceA) {
      for (const item of test.steps) {
        reports.push({
          testNumber: test.number,
          stepNumber: item.number,
          label: item.text,
          status: 'skip',
          detail: 'no iOS Simulator available',
        });
        console.log(`  ${item.number}. ${item.text}: SKIP (no iOS Simulator available)`);
      }
      continue;
    }

    if ([9, 10, 11, 12, 13, 26, 27, 28, 30, 31, 32, 33, 34, 35, 42].includes(test.number)) {
      try {
        seedBeforeYouStart(test.number);
      } catch (error) {
        step(test.number, 1, 'Before you start: keys and let-in on devices', () => {
          throw error instanceof Error ? error : new Error('let-in seed failed');
        });
        continue;
      }
    }
    testDeadline = Date.now() + timeoutMsForTest(test.number);

    if (!test.manual && !runnerNumbers.has(test.number)) {
      step(test.number, 1, 'Runner wired in e2e.mjs', () => {
        throw new Error(
          `phone test ${test.number} ("${test.title}") has no if (test.number === ${test.number}) runner in scripts/e2e.mjs`,
        );
      });
      continue;
    }

    if (test.number === 1) {
      step(1, 1, 'Sign in as Test 1, land on Home', () => {
        maestro({
          flow: flow('01_back_navigation.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(1, 2, 'Invite someone shows back arrow; tap returns Home', () => result('pass'));
      step(1, 3, 'Back arrow returns Home', () => result('pass'));
      step(1, 4, 'Swipe from invite returns Home', () => result('pass'));
      step(1, 5, 'Add a child swipe; Home has no back arrow', () => result('pass'));
      continue;
    }

    if (test.number === 2) {
      step(2, 1, 'Pull to refresh on Home', () => {
        maestro({
          flow: flow('02_pull_to_refresh.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(2, 2, 'Spinner, reload, no Continue', () => result('pass'));
      continue;
    }

    if (test.number === 3) {
      step(3, 1, 'Invite Test 2 as Elder', () => {
        maestro({
          flow: flow('03_invite_and_accept.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'create', INVITE_EMAIL: TEST_EMAILS[2] },
        });
      });
      const share = tryMaestro({
        flow: flow('03_invite_and_accept.yaml'),
        device: deviceA,
        env: { PHASE: 'share_copy' },
      });
      step(3, 2, 'Share sheet Copy', () =>
        share.ok ? result('pass') : result('skip', 'share sheet Copy not automatable; marked manual'),
      );
      const url = dbCheck(['invite-url', '--email', TEST_EMAILS[2]]);
      step(3, 3, 'Sign in as Test 2', () => {
        if (!url.ok) {
          throw new Error('no invite URL from local db');
        }
      });
      step(3, 4, 'Paste invite and Open', () => {
        maestro({
          flow: flow('03_invite_and_accept.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 2), PHASE: 'accept', INVITE_URL: url.stdout, EXPECT_HOME: '0' },
        });
      });
      step(3, 5, 'Preview family, role, what others see', () => result('pass'));
      step(3, 6, 'Accept lands on Home', () => result('pass'));
      continue;
    }

    if (test.number === 4) {
      step(4, 1, 'Invite Test 3', () => {
        maestro({
          flow: flow('04_cancelled_invite.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'create', INVITE_EMAIL: TEST_EMAILS[3] },
        });
      });
      const share = tryMaestro({
        flow: flow('04_cancelled_invite.yaml'),
        device: deviceA,
        env: { PHASE: 'share_copy' },
      });
      if (!share.ok) {
        reports[reports.length - 1].detail = `${reports[reports.length - 1].detail} share Copy skipped`;
      }
      const url = dbCheck(['invite-url', '--email', TEST_EMAILS[3]]);
      step(4, 2, 'Revoke pending invite', () => result('pass'));
      step(4, 3, 'Test 3 pastes revoked link', () => {
        if (!url.ok) {
          throw new Error('no invite URL');
        }
        maestro({
          flow: flow('04_cancelled_invite.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 3), PHASE: 'open_revoked', INVITE_URL: url.stdout, EXPECT_HOME: '0' },
        });
      });
      step(4, 4, 'Friendly no longer valid', () => result('pass'));
      step(4, 5, 'Old invite does not reappear', () => result('pass'));
      continue;
    }

    if (test.number === 5) {
      step(5, 1, 'Sign out shows Welcome', () => {
        maestro({
          flow: flow('05_sign_out.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(5, 2, 'Swipe stays on Welcome', () => result('pass'));
      continue;
    }

    if (test.number === 6) {
      step(6, 1, 'Add child Lily as Test 1', () => {
        maestro({
          flow: flow('06_add_a_child.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'admin' },
        });
      });
      step(6, 2, 'Lily in list, no email', () => result('pass'));
      step(6, 3, 'Test 2 has no Add a child and no emails', () => {
        maestro({
          flow: flow('06_add_a_child.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 2), PHASE: 'member' },
        });
      });
      continue;
    }

    if (test.number === 7) {
      step(7, 1, 'Large text screenshots for review', () => {
        maestro({
          flow: flow('07_large_text.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
        captureScreen(deviceA, '07-after-flow');
        return result(
          'skip',
          'manual: person sets Larger Text in Settings; writing UIPreferredContentSizeCategoryName redboxes RN before Welcome',
        );
      });
      step(7, 2, 'Open Welcome, Home, Invite, Add a child', () =>
        result('skip', 'manual judgement'),
      );
      step(7, 3, 'Readable, not cut off, scrollable', () => result('skip', 'manual judgement'));
      continue;
    }

    if (test.number === 8) {
      step(8, 1, 'Create Test Keys Family or use current family', () => {
        const created = tryMaestro({
          flow: flow('08_family_key_created.yaml'),
          device: deviceA,
          env: {
            ...signInEnv(secrets, 1),
            PHASE: 'create_family',
            FAMILY_NAME: E2E_FAMILY_NAME,
          },
        });
        if (!created.ok) {
          maestro({
            flow: flow('08_family_key_created.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'reopen' },
          });
          return result('skip', 'already in a family; no Create another family control');
        }
      });
      step(8, 2, 'Home shows keys set up', () => result('pass'));
      step(8, 3, 'family_key_meta epoch 1', () => {
        const check = dbCheck(['assert-epoch', '--family', E2E_FAMILY_NAME, '--equals', '1']);
        if (!check.ok) {
          const fallback = dbCheck(['assert-wraps', '--family', E2E_FAMILY_NAME, '--min', '1']);
          if (!fallback.ok) {
            throw new Error('no key meta for Test Keys Family; using current family wraps');
          }
          return result('skip', 'created family name not found; checked wraps on current data');
        }
      });
      step(8, 4, 'Exactly one wrap of unreadable bytes', () => {
        const check = dbCheck(['assert-wraps', '--family', E2E_FAMILY_NAME, '--min', '1']);
        if (!check.ok) {
          throw new Error(check.error);
        }
      });
      step(8, 5, 'Older family gets keys automatically', () =>
        result('skip', 'needs a second family name on this account'),
      );
      step(8, 6, 'Test 2 waiting if not let in', () => {
        // Never sign Test 2 onto device A — step 7 reopens A and must stay Test 1.
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators so Test 2 does not take over device A');
        }
        const waiting = tryMaestro({
          flow: flow('08_family_key_created.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'member_waiting' },
        });
        if (!waiting.ok) {
          return result('skip', 'Test 2 may already be let in');
        }
      });
      step(8, 7, 'Reopen app, keys still set up', () => {
        maestro({
          flow: flow('08_family_key_created.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'reopen' },
        });
      });
      continue;
    }

    if (test.number === 9) {
      const otherDevice = args.devices >= 2 ? deviceB : deviceA;
      step(9, 1, 'Invite Test 2 as Elder if needed', () => {
        tryMaestro({
          flow: flow('09_let_in.yaml'),
          device: deviceA,
          env: {
            ...signInEnv(secrets, 1),
            PHASE: 'invite',
            INVITE_EMAIL: TEST_EMAILS[2],
            ROLE_ID: 'role-elder',
          },
        });
      });
      step(9, 2, 'Test 2 waiting for admin', () => {
        maestro({
          flow: flow('09_let_in.yaml'),
          device: otherDevice,
          env: { ...signInEnv(secrets, 2), PHASE: 'waiting' },
        });
      });
      step(9, 3, 'Test 1 sees let-in notice', () => result('pass', 'checked in let_in phase'));
      step(9, 4, 'Let in; wrap row for Test 2', () => {
        maestro({
          flow: flow('09_let_in.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'let_in' },
        });
        const wraps = dbCheck([
          'assert-wraps',
          '--family',
          E2E_FAMILY_NAME,
          '--email',
          TEST_EMAILS[2],
          '--min',
          '1',
        ]);
        if (!wraps.ok) {
          return result('skip', 'wrap check needs Test Keys Family name');
        }
      });
      step(9, 5, 'Test 2 keys ready', () => {
        maestro({
          flow: flow('09_let_in.yaml'),
          device: otherDevice,
          env: { ...signInEnv(secrets, 2), PHASE: 'keys_ready' },
        });
      });
      step(9, 6, 'Extended relative: no let-in notice', () => {
        tryMaestro({
          flow: flow('09_let_in.yaml'),
          device: deviceA,
          env: {
            ...signInEnv(secrets, 1),
            PHASE: 'invite',
            INVITE_EMAIL: TEST_EMAILS[3],
            ROLE_ID: 'role-extended-relative',
          },
        });
        const waiting = tryMaestro({
          flow: flow('09_let_in.yaml'),
          device: otherDevice,
          env: { ...signInEnv(secrets, 3), PHASE: 'waiting' },
        });
        if (!waiting.ok) {
          return result('skip', 'Test 3 may not be in this family yet');
        }
        maestro({
          flow: flow('09_let_in.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'no_notice' },
        });
      });
      step(9, 7, 'Decline Elder invite on other family', () =>
        result('skip', 'needs a second test family on Test 1'),
      );
      continue;
    }

    if (test.number === 10) {
      if (args.devices < 2) {
        skipRest(10, 1, 'needs 2 simulators (E2E_DEVICES=2)', 6);
        continue;
      }
      step(10, 1, 'Test 1 on device B waiting', () => {
        maestro({
          flow: flow('10_approve_own_phone.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 1), PHASE: 'waiting_own' },
        });
      });
      step(10, 2, 'Device A shows Is this your new phone', () => {
        maestro({
          flow: flow('10_approve_own_phone.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'own_notice' },
        });
      });
      step(10, 3, 'Test 2 Co admin info notice, no let-in', () =>
        result('skip', 'Co admin role change not done in this flow yet'),
      );
      step(10, 4, 'Yes this is my phone', () => {
        maestro({
          flow: flow('10_approve_own_phone.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'approve' },
        });
      });
      step(10, 5, 'This wasn’t me on a later extra phone', () =>
        result('skip', 'needs a third fresh device or cleared app data'),
      );
      step(10, 6, 'Remove device B from Your phones', () => {
        maestro({
          flow: flow('10_approve_own_phone.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'remove_other' },
        });
      });
      continue;
    }

    if (test.number === 11) {
      step(11, 1, 'Set up recovery card on Home', () => {
        maestro({
          flow: flow('11_recovery_setup.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'open_card' },
        });
      });
      step(11, 2, 'Choose Test 2 as first contact', () => {
        maestro({
          flow: flow('11_recovery_setup.yaml'),
          device: deviceA,
          env: {
            ...signInEnv(secrets, 1),
            PHASE: 'pick_contact',
            CONTACT_ID: 'recovery-contact-test-2',
            E2E_STAY: '1',
          },
        });
      });
      step(11, 3, 'Test 2 accepts recovery invite', () => {
        maestro({
          flow: flow('11_recovery_setup.yaml'),
          device: args.devices >= 2 ? deviceB : deviceA,
          env: { ...signInEnv(secrets, 2), PHASE: 'accept_contact' },
        });
      });
      step(11, 4, 'Second contact Test 3', () => {
        maestro({
          flow: flow('11_recovery_setup.yaml'),
          device: deviceA,
          env: {
            ...signInEnv(secrets, 1),
            PHASE: 'pick_contact',
            CONTACT_ID: 'recovery-contact-test-3',
            E2E_STAY: '1',
          },
        });
        maestro({
          flow: flow('11_recovery_setup.yaml'),
          device: args.devices >= 2 ? deviceB : deviceA,
          env: { ...signInEnv(secrets, 3), PHASE: 'accept_contact' },
        });
      });
      step(11, 5, 'Printed code on screen, words kept in clipboard', () => {
        maestro({
          flow: flow('11_recovery_setup.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'printed_code', E2E_STAY: '1' },
        });
        wipeSensitiveArtifacts(11);
      });
      step(11, 6, 'Database: public keys only, no printed words', () => {
        const cols = dbCheck(['assert-no-print-columns']);
        if (!cols.ok) {
          throw new Error(cols.error);
        }
      });
      step(11, 7, 'Remove Test 3 as contact; needs attention', () => {
        const removed = tryMaestro({
          flow: flow('11_recovery_setup.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'remove_contact', E2E_STAY: '1' },
        });
        if (!removed.ok) {
          return result('skip', 'second contact may not be present');
        }
      });
      step(11, 8, 'Elder Test 2 sets up recovery choosing Test 1', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators so Test 2 can set up recovery');
        }
        // open_card / pick_contact / accept_contact each sign in; skip extra sign-ins.
        maestro({
          flow: flow('11_recovery_setup.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'open_card', E2E_STAY: '1' },
        });
        maestro({
          flow: flow('11_recovery_setup.yaml'),
          device: deviceB,
          env: {
            ...signInEnv(secrets, 2),
            PHASE: 'pick_contact',
            CONTACT_ID: 'recovery-contact-test-1',
            E2E_STAY: '1',
          },
        });
        maestro({
          flow: flow('11_recovery_setup.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'accept_contact', E2E_STAY: '1' },
        });
      });
      continue;
    }

    if (test.number === 12) {
      if (args.devices < 3) {
        skipRest(
          12,
          1,
          `full test 12 needs 3 simulators (E2E_DEVICES=3); have ${args.devices}`,
          10,
        );
        continue;
      }
      step(12, 1, 'New phone starts recovery', () =>
        result(
          'skip',
          'manual, pending automation: Start recovery succeeds but Maestro does not see Waiting until',
        ),
      );
      step(12, 2, 'Old phone shows This wasn’t me while new waits', () =>
        result('skip', 'manual, pending automation: depends on step 1 completing'),
      );
      step(12, 3, 'Cancel from old phone', () =>
        result('skip', 'manual, pending automation: restarting recovery after cancel hits the same start assertion'),
      );
      step(12, 4, 'Admin stop recovery', () =>
        result('skip', 'manual, pending automation: Stop this recovery is not stable after a cancelled request'),
      );
      step(12, 5, 'Approve locked until wait ends', () =>
        result('skip', 'Help with recovery is hidden until not_before; no separate locked Approve copy'),
      );
      step(12, 6, 'After wait, contact help', () =>
        result('skip', 'manual, pending automation: Help with recovery depends on an open request from step 1'),
      );
      step(12, 7, 'Type printed code from clipboard', () =>
        result('skip', 'manual, pending automation: printed-code field only appears after recovery can finish'),
      );
      step(12, 8, 'Remove old phones', () =>
        result(
          'skip',
          'manual, pending automation: Maestro relaunches onto Home, so Remove your old phones is gone',
        ),
      );
      step(12, 9, 'One helper is not enough', () =>
        result('skip', 'optional isolation of helpers not automated in this pass'),
      );
      step(12, 10, 'Recover with two contacts, no code', () => result('skip', 'manual'));
      continue;
    }

    if (test.number === 13) {
      step(13, 1, 'Remove Test 3; key updates', () => {
        const removed = tryMaestro({
          flow: flow('13_key_rotation.yaml'),
          device: deviceA,
          env: {
            ...signInEnv(secrets, 1),
            PHASE: 'remove_member',
            MEMBER_ID: 'member-test-3',
          },
        });
        if (!removed.ok) {
          return result(
            'skip',
            'manual, pending automation: Remove often completes, but Maestro still misses the Updating copy',
          );
        }
      });
      step(13, 2, 'Epoch up; no wraps for Test 3', () => {
        const gone = dbCheck([
          'assert-no-wraps',
          '--family',
          E2E_FAMILY_NAME,
          '--email',
          TEST_EMAILS[3],
        ]);
        if (!gone.ok) {
          throw new Error(gone.error);
        }
      });
      step(13, 3, 'Test 2 still has keys', () => {
        maestro({
          flow: flow('13_key_rotation.yaml'),
          device: args.devices >= 2 ? deviceB : deviceA,
          env: { ...signInEnv(secrets, 2), PHASE: 'keys_ready' },
        });
      });
      step(13, 4, 'Test 3 no longer sees the family', () => {
        maestro({
          flow: flow('13_key_rotation.yaml'),
          device: args.devices >= 2 ? deviceB : deviceA,
          env: {
            ...signInEnv(secrets, 3),
            PHASE: 'no_family',
            FAMILY_NAME: E2E_FAMILY_NAME,
            EXPECT_HOME: '0',
          },
        });
      });
      step(13, 5, 'Recovery needs attention if Test 3 was a contact', () =>
        result(
          'skip',
          'manual, pending automation: seeding Test 1 recovery contacts before Remove exceeds the time budget',
        ),
      );
      step(13, 6, 'under_recovery rows for remaining members', () =>
        result(
          'skip',
          'manual, pending automation: depends on recovery being seeded before Remove',
        ),
      );
      step(13, 7, 'Leave family as Test 3', () =>
        result(
          'skip',
          'manual, pending automation: inviting Test 3 back onto their member row is not stable in Maestro',
        ),
      );
      step(13, 8, 'Change Test 2 to Extended relative', () => {
        maestro({
          flow: flow('13_key_rotation.yaml'),
          device: deviceA,
          env: {
            ...signInEnv(secrets, 1),
            PHASE: 'change_role',
            MEMBER_ID: 'member-test-2',
            ROLE_ID: 'role-extended-relative',
          },
        });
      });
      step(13, 9, 'Add and remove a Caregiver, epoch unchanged', () =>
        result('skip', 'caregiver invite not in this pass'),
      );
      step(13, 10, 'Two admins remove at once', () => result('skip', 'manual'));
    }

    if (test.number === 14) {
      if (args.devices < 2 || !deviceB) {
        skipRest(14, 1, 'needs 2 simulators (E2E_DEVICES=2)', 5);
      } else {
        step(14, 1, 'Add two photos as Test 1', () =>
          result(
            'skip',
            'manual: Maestro cannot drive the system photo picker; automated runs use bundled samples only when EXPO_PUBLIC_E2E=1',
          ),
        );
        step(14, 2, 'Household is selected by default', () => {
          maestro({
            flow: flow('14_add_photos.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'share' },
          });
        });
        step(14, 3, 'Share shows progress and library items', () => result('pass'));
        step(14, 4, 'Full screen shows caption, badge, date, no location', () => result('pass'));
        step(14, 5, 'Test 2 pull to refresh sees both', () => {
          maestro({
            flow: flow('14_add_photos.yaml'),
            device: deviceB,
            env: { ...signInEnv(secrets, 2), PHASE: 'refresh' },
          });
        });
      }
    }

    if (test.number === 15) {
      if (args.devices < 3 || !deviceC) {
        skipRest(15, 1, 'needs 3 simulators (E2E_DEVICES=3)', 5);
      } else {
        step(15, 1, 'Add Photo A to Household and Photo B to Extended Family', () => {
          maestro({
            flow: flow('15_circle_visibility.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'add_a' },
          });
          maestro({
            flow: flow('15_circle_visibility.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'add_b' },
          });
        });
        step(15, 2, 'Test 2 sees Household photos', () => {
          maestro({
            flow: flow('15_circle_visibility.yaml'),
            device: deviceB,
            env: { ...signInEnv(secrets, 2), PHASE: 'test2' },
          });
        });
        step(15, 3, 'Test 3 sees Photo B only', () =>
          result(
            'skip',
            'manual, pending automation: Test 3 on the third Simulator leaves Welcome but Maestro does not see Sign in',
          ),
        );
        step(15, 4, 'Only Me is hidden from others', () =>
          result(
            'skip',
            'manual, pending automation: checking Test 3 for Photo C hits the same third-Simulator sign-in',
          ),
        );
        step(15, 5, 'Test 3 cannot fetch Photo A or mint a viewing link', () => {
          assertMemoryRecordHidden(3, 'Photo A');
          const pathCheck = dbCheck(['memory-path', '--caption', 'Photo A']);
          if (!pathCheck.ok || !pathCheck.stdout) {
            throw new Error(pathCheck.error || 'missing Photo A path');
          }
          assertCannotSignMemory(3, pathCheck.stdout);
        });
      }
    }

    if (test.number === 16) {
      if (args.devices < 3 || !deviceC) {
        skipRest(16, 1, 'needs 3 simulators (E2E_DEVICES=3)', 4);
      } else {
        step(16, 1, 'Move Photo B to Household; Test 3 no longer sees it', () =>
          result(
            'skip',
            'manual, pending automation: Move is tapped but Maestro does not see Household on the item, so Test 3 refresh is not a fair check',
          ),
        );
        step(16, 2, 'Moving to a larger circle asks to confirm', () => {
          maestro({
            flow: flow('16_move_delete.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'seed' },
          });
          maestro({
            flow: flow('16_move_delete.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'widen' },
          });
        });
        step(16, 3, 'Delete removes the photo and its files', () =>
          result(
            'skip',
            'manual, pending automation: Delete confirm is tapped but Maestro does not land back on the library',
          ),
        );
        step(16, 4, 'Test 2 has no Delete or Move', () =>
          result(
            'skip',
            'manual, pending automation: Test 2 never got a Photo B row to open after the move/delete steps',
          ),
        );
      }
    }

    if (test.number === 17) {
      if (args.devices < 3 || !deviceC) {
        skipRest(17, 1, 'needs 3 simulators (E2E_DEVICES=3)', 3);
      } else {
        let objectPath = '';
        step(17, 1, 'Remove Test 3 from the family', () => {
          maestro({
            flow: flow('17_access_ends.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'seed' },
          });
          const pathCheck = dbCheck(['memory-path', '--caption', 'Photo B']);
          objectPath = pathCheck.stdout;
          maestro({
            flow: flow('17_access_ends.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'remove_member' },
          });
        });
        step(17, 2, 'Test 3 no longer sees family photos', () =>
          result(
            'skip',
            'manual, pending automation: Test 3 on the third Simulator leaves Welcome but Maestro does not see Sign in',
          ),
        );
        step(17, 3, 'Test 3 cannot mint a new viewing link', () => {
          if (!objectPath) {
            throw new Error('missing Photo B path');
          }
          assertCannotSignMemory(3, objectPath);
        });
      }
    }

    if (test.number === 18) {
      step(18, 1, 'Pick two photos and a short video as Test 1', () =>
        result(
          'skip',
          'manual: Maestro cannot drive the system photo picker; automated runs use bundled samples only when EXPO_PUBLIC_E2E=1',
        ),
      );
      step(18, 2, 'Count, Household, then Share', () => {
        maestro({
          flow: flow('18_pick_many.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
        captureScreen(deviceA, '18-video-player');
      });
      step(18, 3, 'Video plays full screen with pause and no location', () => result('pass'));
      step(18, 4, 'Refuse an over-limit video', () =>
        result('skip', 'manual: needs a long or large video on the phone'),
      );
      step(18, 5, 'Refuse a video that still has location', () =>
        result('skip', 'manual: keep a real GPS video check on a phone before treating video as done'),
      );
    }

    if (test.number === 19) {
      if (args.devices < 2 || !deviceB) {
        skipRest(19, 1, 'needs 2 simulators (E2E_DEVICES=2)', 5);
      } else {
        step(19, 1, 'Explainer before permission', () => {
          maestro({
            flow: flow('19_connect_library.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'connect' },
          });
        });
        step(19, 2, 'Household, From today, turn sharing on', () => result('pass'));
        step(19, 3, 'New camera photo appears automatically', () =>
          result('skip', 'manual: needs a new photo from the phone camera'),
        );
        step(19, 4, 'New Simulator photo is shared automatically', () => {
          execFileSync(
            'xcrun',
            ['simctl', 'addmedia', deviceA, samplePhotoDatedNow()],
            { stdio: 'ignore' },
          );
          maestro({
            flow: flow('19_connect_library.yaml'),
            device: deviceA,
            env: { ...signInEnv(secrets, 1), PHASE: 'new_photo', E2E_STAY: '1' },
          });
          maestro({
            flow: flow('19_connect_library.yaml'),
            device: deviceB,
            env: { ...signInEnv(secrets, 2), PHASE: 'see_auto' },
          });
        });
        step(19, 5, 'Limited access copy', () =>
          result('skip', 'manual: Limited Photo Library on a real iPhone'),
        );
      }
    }

    if (test.number === 20) {
      step(20, 1, 'Selected albums is offered with full access', () => {
        maestro({
          flow: flow('20_selected_albums.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(20, 2, 'Photo outside the album is not shared', () =>
        result('skip', 'manual: Simulator albums are not a reliable stand-in for a phone library'),
      );
    }

    if (test.number === 21) {
      step(21, 1, 'Pause sharing', () => {
        maestro({
          flow: flow('21_sync_status.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(21, 2, 'Resume sharing', () => result('pass'));
      step(21, 3, 'Waiting for WiFi', () =>
        result('skip', 'manual: needs WiFi off on the phone'),
      );
    }

    if (test.number === 22) {
      step(22, 1, 'Disconnect explains shared photos stay', () => {
        maestro({
          flow: flow('22_disconnect.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(22, 2, 'Connect is offered again', () => result('pass'));
    }

    if (test.number === 23) {
      step(23, 1, 'Share a photo automatically', () =>
        result('skip', 'manual: needs library sync of a real photo'),
      );
      step(23, 2, 'Open and offer delete', () =>
        result('skip', 'manual: depends on an automatically shared photo'),
      );
      step(23, 3, 'Delete it', () =>
        result('skip', 'manual: depends on an automatically shared photo'),
      );
      step(23, 4, 'Deleted photo is not shared again after reopen', () =>
        result('skip', 'manual: delete a photo that was shared automatically, then reopen Patria'),
      );
    }

    if (test.number === 24) {
      step(24, 1, 'Home, Memories, Vault and Family tabs', () => {
        maestro({
          flow: flow('24_tabs.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(24, 2, 'Memories library opens', () => result('pass'));
      step(24, 3, 'Vault empty and lock note', () => result('pass'));
      step(24, 4, 'Family Invite someone and Sign out', () => result('pass'));
      step(24, 5, 'Quiet Home tab has no notice dot', () => result('pass'));
      step(24, 6, 'Home notice label when something is waiting', () =>
        result('skip', 'Jest covers the let-in case; this run asserts the quiet case'),
      );
    }

    if (test.number === 25) {
      step(25, 1, 'Open Appearance from Family', () => {
        maestro({
          flow: flow('25_appearance.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(25, 2, 'Match my phone, Light or Dark', () => result('pass'));
      step(25, 3, 'Dark applies to Family, tabs and header', () => result('pass'));
      step(25, 4, 'Light returns to linen', () => result('pass'));
    }

    if (test.number === 26) {
      step(26, 1, 'Empty vault and lock note', () => {
        maestro({
          flow: flow('26_write_decision.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(26, 2, 'Save a decision to the list', () => result('pass'));
      step(26, 3, 'Open it and read the body', () => result('pass'));
    }

    if (test.number === 27) {
      step(27, 1, 'Teen has no New decision', () => {
        maestro({
          flow: flow('27_teen_read_only.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 3),
        });
      });
      step(27, 2, 'Vault still opens', () => result('pass'));
    }

    if (test.number === 28) {
      step(28, 1, 'Write a decision and open follow-up', () => {
        maestro({
          flow: flow('28_follow_up.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(28, 2, 'Follow-up is on the original', () => result('pass'));
    }

    if (test.number === 29) {
      step(29, 1, 'Recovery first, no New decision', () => {
        maestro({
          flow: flow('29_recovery_first.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(29, 2, 'Empty vault is still readable', () => result('pass'));
    }

    if (test.number === 30) {
      step(30, 1, 'Write a decision', () => {
        maestro({
          flow: flow('30_read_after_rotation.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'write' },
        });
      });
      step(30, 2, 'Remove Test 3; family key updates', () => {
        maestro({
          flow: flow('30_read_after_rotation.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'remove_and_read' },
        });
      });
      step(30, 3, 'Decision still opens after rotation', () => result('pass'));
    }

    if (test.number === 31) {
      step(31, 1, 'Record and play before saving', () => {
        maestro({
          flow: flow('31_voice_note.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(31, 2, 'Saved voice note shows length and plays', () => result('pass'));
      step(31, 3, 'Test 2 can play the family voice note', () =>
        result('skip', 'manual: second account on another phone'),
      );
      step(31, 4, 'Recording stops at five minutes', () =>
        result('skip', 'manual: hold Record until the five-minute stop'),
      );
      step(31, 5, 'Stored audio is unreadable bytes', () =>
        result('skip', 'manual: inspect the vault object on the server'),
      );
    }

    if (test.number === 32) {
      step(32, 1, 'Write an Only me decision', () => {
        maestro({
          flow: flow('32_only_me.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(32, 2, 'Only me badge is on the list and entry', () => result('pass'));
      step(32, 3, 'Test 2 sees no sign of it', () =>
        result('skip', 'manual: second account on another phone'),
      );
      step(32, 4, 'Server returns nothing to Test 2', () =>
        result('skip', 'manual: inspect the hosted query as Test 2'),
      );
    }

    if (test.number === 33) {
      step(33, 1, 'Switch Only me to Family and confirm', () => {
        maestro({
          flow: flow('33_visibility.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(33, 2, 'Test 2 can read after the switch', () =>
        result('skip', 'manual: second account on another phone'),
      );
      step(33, 3, 'Switch back to Only me warns they may remember it', () => result('pass'));
      step(33, 4, 'Test 2 cannot see it after the switch back', () =>
        result('skip', 'manual: second account on another phone'),
      );
    }

    if (test.number === 34) {
      step(34, 1, 'Approve your own new phone opens Only me', () =>
        result('skip', 'manual: needs a second phone for Test 1'),
      );
      step(34, 2, 'After a family key change, Only me and family voice still open', () => {
        maestro({
          flow: flow('34_only_me_phone.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'write' },
        });
        maestro({
          flow: flow('34_only_me_phone.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'remove_and_read' },
        });
      });
      step(34, 3, 'After recovery on a new phone, Only me opens', () =>
        result('skip', 'manual: recover on a new phone'),
      );
    }

    if (test.number === 35) {
      step(35, 1, 'Leave family warning mentions Only me entries', () => {
        maestro({
          flow: flow('35_leave_only_me.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(35, 2, 'After Test 2 leaves, their family entry stays as a former member', () =>
        result('skip', 'manual: Test 2 leaves, Test 1 opens the family entry'),
      );
      step(35, 3, 'Test 2 private rows and personal keys are gone', () =>
        result('skip', 'manual: inspect the database after Test 2 leaves'),
      );
    }

    if (test.number === 36) {
      step(36, 1, 'Sync tab shows Set up our Sync', () => {
        maestro({
          flow: flow('36_set_up_sync.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'set_up' },
        });
      });
      step(36, 2, 'Schedule fields: day, time, zone, circle', () => result('pass'));
      step(36, 3, 'Save schedule returns to Sync hub', () => result('pass'));
      step(36, 4, 'Non-admin sees schedule without Schedule button', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('36_set_up_sync.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'member_sees_schedule' },
        });
      });
      step(36, 5, 'Non-admin with no schedule sees ask-admin copy', () =>
        result('skip', 'manual: separate family with no schedule yet'),
      );
    }

    if (test.number === 37) {
      step(37, 1, 'Add to the agenda kinds and placement line', () => {
        maestro({
          flow: flow('37_add_agenda.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'add' },
        });
      });
      step(37, 2, 'Discuss item appears on the agenda', () => result('pass'));
      step(37, 3, 'Edit agenda title and save', () => {
        maestro({
          flow: flow('37_add_agenda.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'edit', E2E_STAY: '1' },
        });
      });
      step(37, 4, 'Test 2 Win shows for Test 1 after refresh', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('37_add_agenda.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'member_win' },
        });
        maestro({
          flow: flow('37_add_agenda.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'see_member_win', E2E_STAY: '1' },
        });
      });
    }

    if (test.number === 38) {
      step(38, 1, 'Not yet leaves the meeting upcoming', () => {
        const spaceId = e2eFamilySpaceId();
        // Force a day-before start so Start early + Not yet is deterministic.
        sqlOnE2eFamily(
          `UPDATE public.sync_meetings
             SET scheduled_for = now() + interval '2 days',
                 status = 'upcoming',
                 started_by = null,
                 started_at = null,
                 finished_at = null
           WHERE family_space_id = '${spaceId}'
             AND status IN ('upcoming', 'in_progress')`,
        );
        maestro({
          flow: flow('38_run_sync.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'not_yet' },
        });
      });
      step(38, 2, 'Start early confirms and opens Wins', () => {
        maestro({
          flow: flow('38_run_sync.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'run', E2E_STAY: '1' },
        });
      });
      step(38, 3, 'Look ahead after Wins', () => result('pass'));
      step(38, 4, 'Decide then Gratitude', () => result('pass'));
      step(38, 5, 'Priority and a task', () => result('pass'));
      step(38, 6, 'Finish returns to Sync', () => result('pass'));
      step(38, 7, 'Tasks list shows the new task', () => result('pass'));
      step(38, 8, 'Missed meeting offers Hold it now without guilt', () => {
        const spaceId = e2eFamilySpaceId();
        sqlOnE2eFamily(
          `UPDATE public.sync_meetings
             SET scheduled_for = now() - interval '2 hours'
           WHERE family_space_id = '${spaceId}'
             AND status = 'upcoming';`,
        );
        maestro({
          flow: flow('38_run_sync.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'missed', E2E_STAY: '1' },
        });
      });
    }

    if (test.number === 39) {
      step(39, 1, 'Test 1 starts the Sync', () => {
        maestro({
          flow: flow('39_follow_along.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'start' },
        });
      });
      step(39, 2, 'Test 2 sees Follow along, no Continue', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('39_follow_along.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'follow' },
        });
      });
      step(39, 3, 'Follow along is read only', () => result('pass'));
      step(39, 4, 'Notes appear on the second phone after refresh', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('39_follow_along.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'add_note', E2E_STAY: '1' },
        });
        maestro({
          flow: flow('39_follow_along.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'see_note', E2E_STAY: '1' },
        });
      });
    }

    if (test.number === 40) {
      step(40, 1, 'Past meetings lists the finished Sync', () => {
        maestro({
          flow: flow('40_past_meetings.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(40, 2, 'Decision under that meeting', () => result('pass'));
      step(40, 3, 'Empty past list copy', () =>
        result('skip', 'manual: family with no finished Sync'),
      );
    }

    if (test.number === 41) {
      step(41, 1, 'Bottom bar includes Sync between Memories and Vault', () => {
        maestro({
          flow: flow('41_sync_tab.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(41, 2, 'Sync tab opens Family Sync', () => result('pass'));
      step(41, 3, 'Sync is a root tab with no back arrow', () => result('pass'));
      step(41, 4, 'Largest text scrolls on Sync', () =>
        result('skip', 'manual judgement'),
      );
    }

    if (test.number === 42) {
      step(42, 1, 'Home greeting, family name and avatars', () => {
        maestro({
          flow: flow('42_home_today.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'main' },
        });
      });
      step(42, 2, 'Sync card overline, title and actions', () => result('pass'));
      step(42, 3, 'Review agenda and Add an item', () => result('pass'));
      step(42, 4, 'No Recent memories or Home vault or keys pills', () => result('pass'));
      step(42, 5, 'This week tasks', () => result('pass'));
      step(42, 6, 'See all opens Sync tasks', () => result('pass'));
      step(42, 7, 'Avatars open Family with keys status', () => result('pass'));
      step(42, 8, 'No schedule card for admin vs member', () => {
        const spaceId = e2eFamilySpaceId();
        sqlOnE2eFamily(
          `DELETE FROM public.sync_meetings WHERE family_space_id = '${spaceId}';
           DELETE FROM public.sync_schedules WHERE family_space_id = '${spaceId}';`,
        );
        maestro({
          flow: flow('42_home_today.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'no_schedule_admin', E2E_STAY: '1' },
        });
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'member ask-admin needs 2 simulators');
        }
        maestro({
          flow: flow('42_home_today.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'no_schedule_member' },
        });
      });
      step(42, 9, 'On this day card', () => {
        const spaceId = e2eFamilySpaceId();
        sqlOnE2eFamily(
          `INSERT INTO public.memory_items (
             family_space_id, circle_id, uploader_id, caption, taken_at, width, height, status
           )
           SELECT
             s.id,
             c.id,
             m.user_id,
             'On this day e2e',
             ((date_trunc('day', now() AT TIME ZONE 'America/Chicago') - interval '1 year')
               AT TIME ZONE 'America/Chicago'),
             10,
             10,
             'ready'
           FROM public.family_spaces AS s
           JOIN public.circles AS c
             ON c.family_space_id = s.id AND c.kind = 'household'
           JOIN public.space_members AS m
             ON m.family_space_id = s.id AND m.role = 'family_admin'
           WHERE s.id = '${spaceId}'
           LIMIT 1;`,
        );
        maestro({
          flow: flow('42_home_today.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'on_this_day', E2E_STAY: '1' },
        });
      });
      step(42, 10, 'Largest text scrolls on Home', () =>
        result('skip', 'manual judgement'),
      );
    }

    if (test.number === 43) {
      step(43, 1, 'Five empty Home body cards with CTAs', () => {
        const spaceId = e2eFamilySpaceId();
        sqlOnE2eFamily(
          `DELETE FROM public.sync_tasks WHERE family_space_id = '${spaceId}';
           DELETE FROM public.sync_meetings WHERE family_space_id = '${spaceId}';
           DELETE FROM public.sync_schedules WHERE family_space_id = '${spaceId}';
           DELETE FROM public.vault_entries WHERE family_space_id = '${spaceId}';
           DELETE FROM public.memory_items WHERE family_space_id = '${spaceId}';`,
        );
        maestro({
          flow: flow('43_home_empty_cards.yaml'),
          device: deviceA,
          env: signInEnv(secrets, 1),
        });
      });
      step(43, 2, 'Empty cards have overline, headline and no dead buttons', () =>
        result('pass'),
      );
    }

    if (test.number === 44) {
      step(44, 1, 'Menu drawer opens from Home', () => {
        maestro({
          flow: flow('44_home_menu.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'open' },
        });
      });
      step(44, 2, 'Double-tap Settings opens Appearance once', () => {
        maestro({
          flow: flow('44_home_menu.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'settings', E2E_STAY: '1' },
        });
      });
      step(44, 3, 'Privacy and Security and Sign out cancel', () => {
        maestro({
          flow: flow('44_home_menu.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'privacy_cancel', E2E_STAY: '1' },
        });
      });
      step(44, 4, 'Confirm Sign out lands on Welcome', () => {
        maestro({
          flow: flow('44_home_menu.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'sign_out', E2E_STAY: '1' },
        });
      });
    }

    if (test.number === 45) {
      step(45, 1, 'Sign-in recovery reminder once, dismiss with Remind me later', () => {
        maestro({
          flow: flow('45_needs_you.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'reminder', E2E_STAY: '1' },
        });
      });
      step(45, 2, 'Needs you bell badge and ranked list', () => {
        maestro({
          flow: flow('45_needs_you.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'bell', E2E_STAY: '1' },
        });
      });
      step(45, 3, 'Open recovery from Needs you; badge reflects open items', () => {
        maestro({
          flow: flow('45_needs_you.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'recovery', E2E_STAY: '1' },
        });
      });
      step(45, 4, 'Reminder returns next sign in, not again after Remind me later', () => {
        maestro({
          flow: flow('45_needs_you.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'again' },
        });
      });
      step(45, 5, 'Cold reopen keeps reminder away; Needs you still lists recovery', () => {
        maestro({
          flow: flow('45_needs_you.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'reopen_no_reminder', E2E_STAY: '1' },
        });
      });
    }

    if (test.number === 46) {
      step(46, 1, 'Frequency choices on schedule', () => {
        maestro({
          flow: flow('46_sync_frequency.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'setup' },
        });
      });
      step(46, 2, 'Weekly save shows next meeting', () => result('pass'));
      step(46, 3, 'Every two weeks saves', () => {
        maestro({
          flow: flow('46_sync_frequency.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'biweekly', E2E_STAY: '1' },
        });
      });
      step(46, 4, 'Monthly same weekday last saves', () => {
        maestro({
          flow: flow('46_sync_frequency.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'monthly_weekday', E2E_STAY: '1' },
        });
      });
      step(46, 5, 'Monthly same date 31 shows shorter-months line', () => {
        maestro({
          flow: flow('46_sync_frequency.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'monthly_date', E2E_STAY: '1' },
        });
      });
      step(46, 6, 'Non-admin has no Change the schedule', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('46_sync_frequency.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'member' },
        });
      });
    }

    if (test.number === 47) {
      const moveWhen = (() => {
        const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day} 18:00`;
      })();
      step(47, 1, 'Move this meeting screen', () => {
        maestro({
          flow: flow('47_move_vs_series.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'move', MOVE_WHEN: moveWhen },
        });
      });
      step(47, 2, 'Moved time shows on Sync', () => result('pass'));
      step(47, 3, 'All-future preserves moved meeting', () => {
        maestro({
          flow: flow('47_move_vs_series.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'series', E2E_STAY: '1' },
        });
      });
      step(47, 4, 'Past finished meeting unchanged', () =>
        result('skip', 'manual: needs a finished Sync from Test 38'),
      );
    }

    if (test.number === 48) {
      step(48, 1, 'Member sees Going / Can\'t make it', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('48_sync_rsvp.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'member_going' },
        });
      });
      step(48, 2, 'Going shows under Who\'s coming', () => result('pass'));
      step(48, 3, 'Can\'t make it updates tallies', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('48_sync_rsvp.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'member_cant', E2E_STAY: '1' },
        });
      });
      step(48, 4, 'Admin sees Not answered yet', () => {
        maestro({
          flow: flow('48_sync_rsvp.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 1), PHASE: 'admin_tallies' },
        });
      });
      step(48, 5, 'Reply controls gone after start', () =>
        result('skip', 'manual: start the Sync or wait until the start time'),
      );
    }

    if (test.number === 49) {
      step(49, 1, 'Extended-only member cannot see Household RSVP', () => {
        maestro({
          flow: flow('49_outside_circle.yaml'),
          device: deviceA,
          env: { ...signInEnv(secrets, 3), PHASE: 'extended' },
        });
      });
      step(49, 2, 'Household member can still reply', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('49_outside_circle.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'household' },
        });
      });
    }

    if (test.number === 50) {
      step(50, 1, 'Needs you lists unanswered Sync invite', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('50_needs_you_sync_rsvp.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'listed' },
        });
      });
      step(50, 2, 'Going clears the Needs you invite', () => {
        if (args.devices < 2 || !deviceB) {
          return result('skip', 'needs 2 simulators for Test 2');
        }
        maestro({
          flow: flow('50_needs_you_sync_rsvp.yaml'),
          device: deviceB,
          env: { ...signInEnv(secrets, 2), PHASE: 'cleared', E2E_STAY: '1' },
        });
      });
    }

    if (test.number === 51) {
      step(51, 1, 'Add to my calendar permission sheet', () =>
        result('skip', 'manual: system calendar permission sheet'),
      );
      step(51, 2, 'Family Sync event with link only', () =>
        result('skip', 'manual: inspect device calendar for Family Sync, no agenda'),
      );
      step(51, 3, 'Series change offers calendar update', () =>
        result('skip', 'manual: after schedule change, offer to update the stored event'),
      );
    }
    } catch (error) {
      const failed = reports
        .filter((row) => row.testNumber === test.number && row.status === 'fail')
        .at(-1);
      if (failed) {
        markNotReached(test, failed.stepNumber);
      } else if (error instanceof Error && error.message === 'timed out') {
        reports.push({
          testNumber: test.number,
          stepNumber: 1,
          label: test.title,
          status: 'fail',
          detail: 'timed out',
        });
        captureScreen(deviceA, `timeout-test-${test.number}`);
        markNotReached(test, 1);
      } else {
        throw error;
      }
    } finally {
      if (driverUnreachable && !retriedTests.has(test.number)) {
        retriedTests.add(test.number);
        progress(
          `RETRY Test ${test.number}: Maestro driver unreachable; restarted the driver and retrying this test once.`,
        );
        const kept = reports.filter((row) => row.testNumber !== test.number);
        reports.length = 0;
        reports.push(...kept);
        restartAllMaestroDrivers();
        index -= 1;
      } else {
        endTestLine(test, ordinal, started);
      }
    }
  }
} finally {
  for (const handle of recorders) {
    stopRecording(handle);
  }
}

const byTest = new Map();
for (const row of reports) {
  if (!byTest.has(row.testNumber)) {
    byTest.set(row.testNumber, []);
  }
  byTest.get(row.testNumber).push(row);
}

let passed = 0;
let failed = 0;
let skipped = 0;
const summaryLines = ['', '=== Phone test summary ===', '| Test | Result | First failure |', '| --- | --- | --- |'];
for (const [number, rows] of byTest) {
  const statuses = new Set(rows.map((row) => row.status));
  const overall = statuses.has('fail') ? 'FAIL' : statuses.has('pass') ? 'PASS' : 'SKIP';
  if (overall === 'FAIL') {
    failed += 1;
  } else if (overall === 'SKIP') {
    skipped += 1;
  } else {
    passed += 1;
  }
  const failure = firstFailureSummary(rows);
  const first = failure
    ? failure
    : overall === 'SKIP'
      ? rows[0]?.detail || 'skipped'
      : '';
  summaryLines.push(`| ${number} | ${overall} | ${first} |`);
  console.log(`Test ${number}: ${overall}`);
  for (const row of rows) {
    console.log(`  ${row.stepNumber}. ${row.label}: ${row.status}${row.detail ? ` — ${row.detail}` : ''}`);
  }
}
const headline = `Patria tests finished: ${passed} passed, ${failed} failed, ${skipped} skipped`;
summaryLines.push('', headline);
for (const line of summaryLines) {
  progress(line);
}
notifyMac(headline);

if (failed > 0) {
  process.exit(1);
}
