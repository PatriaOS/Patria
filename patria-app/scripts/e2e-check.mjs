import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APP_ROOT,
  MAESTRO_DIR,
  PHONE_AREA_LIST,
  PHONE_TESTS,
  REPO_ROOT,
  parseAreaList,
  parseE2eTestFlag,
  parsePhoneTests,
  phoneCoverageErrors,
  runnerNumbersFromSource,
  seedBeforeYouStartAllowListFromSource,
  seedInvocationListFromSource,
  selectPhoneTestsForRun,
} from './e2e-lib.mjs';

function flowNumber(filename) {
  const match = filename.match(/^(\d+)_.*\.ya?ml$/);
  return match ? Number(match[1]) : null;
}

function phoneTestsTag(contents) {
  const match = contents.match(/#\s*PHONE_TESTS:\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function flowAreas(contents) {
  const match = contents.match(/#\s*AREAS:\s*(.+)/);
  return parseAreaList(match ? match[1] : '');
}

function sameAreas(left, right) {
  const a = [...left].sort().join(',');
  const b = [...right].sort().join(',');
  return a === b;
}

const markdown = readFileSync(PHONE_TESTS, 'utf8');
const tests = parsePhoneTests(markdown);
if (tests.length === 0) {
  console.error('e2e:check: no numbered tests found in PHONE_TESTS.md');
  process.exit(1);
}

const flowFiles = existsSync(MAESTRO_DIR)
  ? readdirSync(MAESTRO_DIR).filter((name) => /^\d+_.*\.ya?ml$/.test(name))
  : [];

const errors = [];
const testsByNumber = new Map(tests.map((test) => [test.number, test]));
const known = new Set(PHONE_AREA_LIST);
const flowNumbers = new Set(
  flowFiles.map((name) => flowNumber(name)).filter((number) => number != null),
);
const e2eSource = readFileSync(join(APP_ROOT, 'scripts', 'e2e.mjs'), 'utf8');
const runnerNumbers = runnerNumbersFromSource(e2eSource);

// Every test seedBeforeYouStart knows about must also be invoked from the main loop.
{
  const allow = seedBeforeYouStartAllowListFromSource(e2eSource);
  const invoked = seedInvocationListFromSource(e2eSource);
  if (allow.size === 0 || invoked.size === 0) {
    errors.push(
      'Could not parse seedBeforeYouStart allow-list or seed invocation list from e2e.mjs',
    );
  }
  for (const n of allow) {
    if (!invoked.has(n)) {
      errors.push(
        `seedBeforeYouStart lists test ${n} but the main loop never calls it (seed skipped)`,
      );
    }
  }
  for (const n of invoked) {
    if (!allow.has(n)) {
      errors.push(
        `main loop seeds test ${n} but seedBeforeYouStart allow-list omits it`,
      );
    }
  }
}

for (const test of tests) {
  if (test.areas.length === 0) {
    errors.push(`PHONE_TESTS.md test ${test.number} ("${test.title}") has no Areas: line.`);
  }
  for (const area of test.areas) {
    if (!known.has(area)) {
      errors.push(`PHONE_TESTS.md test ${test.number} has unknown area "${area}".`);
    }
  }
}

errors.push(...phoneCoverageErrors({ tests, flowNumbers, runnerNumbers }));

// Maestro rejects takeScreenshot paths that leave its output folder (../ or dirs).
{
  let tracked = [];
  try {
    const out = execFileSync('git', ['ls-files', 'patria-app/.maestro'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    tracked = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /\.ya?ml$/.test(line))
      .map((line) => join(REPO_ROOT, line));
  } catch {
    // Fall back to on-disk walk if git is unavailable.
    function walkYaml(dir) {
      const out = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...walkYaml(path));
        } else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) {
          out.push(path);
        }
      }
      return out;
    }
    tracked = existsSync(MAESTRO_DIR) ? walkYaml(MAESTRO_DIR) : [];
  }
  for (const path of tracked) {
    if (!existsSync(path)) {
      continue;
    }
    const contents = readFileSync(path, 'utf8');
    const rel = path.includes(`${MAESTRO_DIR}/`)
      ? path.slice(MAESTRO_DIR.length + 1)
      : path;
    for (const match of contents.matchAll(/^\s*-\s*takeScreenshot:\s*(.+)\s*$/gm)) {
      const raw = match[1].trim().replace(/^["']|["']$/g, '');
      if (raw.includes('..') || raw.includes('/')) {
        errors.push(
          `${rel}: takeScreenshot must be a bare name (no "/" or ".."); got ${raw}`,
        );
      }
    }
  }
}

for (const filename of flowFiles) {
  const path = join(MAESTRO_DIR, filename);
  const contents = readFileSync(path, 'utf8');
  const tagged = phoneTestsTag(contents);
  const fromName = flowNumber(filename);
  const number = tagged ?? fromName;
  if (tagged != null && tagged !== fromName) {
    errors.push(`${filename} is named for test ${fromName} but tagged PHONE_TESTS: ${tagged}.`);
  }
  if (!testsByNumber.has(number)) {
    errors.push(`${filename} points to test ${number}, which is not in PHONE_TESTS.md.`);
    continue;
  }
  const yamlAreas = flowAreas(contents);
  if (yamlAreas.length === 0) {
    errors.push(`${filename} has no # AREAS: line.`);
  }
  for (const area of yamlAreas) {
    if (!known.has(area)) {
      errors.push(`${filename} has unknown area "${area}".`);
    }
  }
  const mdAreas = testsByNumber.get(number).areas;
  if (mdAreas.length > 0 && yamlAreas.length > 0 && !sameAreas(mdAreas, yamlAreas)) {
    errors.push(
      `${filename} areas (${yamlAreas.join(', ')}) do not match PHONE_TESTS.md (${mdAreas.join(', ')}).`,
    );
  }
}

for (const name of ['pickPhotos.ts', 'pickMedia.ts']) {
  const source = readFileSync(join(APP_ROOT, 'src/features/memories', name), 'utf8');
  if (/(?:assets\/e2e|sample1\.jpg|sample2\.jpg|sample\.mp4)/.test(source)) {
    errors.push(
      `${name} must not reference bundled e2e sample media; those live in e2ePhotoSamples.bundle.ts and load only when EXPO_PUBLIC_E2E=1.`,
    );
  }
}

// --test comma lists must never fall through to the full suite (NaN → falsy bug).
{
  const parsed = parseE2eTestFlag('65,68,71');
  if (parsed.join(',') !== '65,68,71') {
    errors.push(`parseE2eTestFlag('65,68,71') → [${parsed.join(',')}], expected 65,68,71`);
  }
  if (parseE2eTestFlag('').length !== 0) {
    errors.push('parseE2eTestFlag("") should be empty');
  }
  if (parseE2eTestFlag('abc,0,-1').length !== 0) {
    errors.push('parseE2eTestFlag should drop non-positive / non-numeric parts');
  }
  const sample = [
    { number: 65, title: 'a' },
    { number: 68, title: 'b' },
    { number: 70, title: 'c' },
  ];
  try {
    const picked = selectPhoneTestsForRun({
      allTests: sample,
      testNumbers: [65, 68],
      mode: 'full',
      smokeNumbers: [],
      affectedNumbers: [],
    });
    if (picked.map((t) => t.number).join(',') !== '65,68') {
      errors.push(`selectPhoneTestsForRun batch → ${picked.map((t) => t.number)}, expected 65,68`);
    }
  } catch (error) {
    errors.push(`selectPhoneTestsForRun batch threw: ${error instanceof Error ? error.message : error}`);
  }
  let threwEmpty = false;
  try {
    selectPhoneTestsForRun({
      allTests: sample,
      testNumbers: [],
      mode: 'full',
      smokeNumbers: [],
      affectedNumbers: [],
    });
  } catch {
    threwEmpty = true;
  }
  if (!threwEmpty) {
    errors.push('selectPhoneTestsForRun([]) must throw (never fall through to full suite)');
  }
  let threwUnknown = false;
  try {
    selectPhoneTestsForRun({
      allTests: sample,
      testNumbers: [999],
      mode: 'full',
      smokeNumbers: [],
      affectedNumbers: [],
    });
  } catch {
    threwUnknown = true;
  }
  if (!threwUnknown) {
    errors.push('selectPhoneTestsForRun([999]) must throw when nothing matches');
  }
  const full = selectPhoneTestsForRun({
    allTests: sample,
    testNumbers: null,
    mode: 'full',
    smokeNumbers: [],
    affectedNumbers: [],
  });
  if (full.length !== sample.length) {
    errors.push('selectPhoneTestsForRun(null, full) should return all tests');
  }
}

if (errors.length > 0) {
  console.error('e2e:check failed:');
  for (const error of errors) {
    console.error(`  ${error}`);
  }
  process.exit(1);
}

console.log(
  `e2e:check passed: ${tests.length} tests in PHONE_TESTS.md, ${flowFiles.length} Maestro flows, ${runnerNumbers.size} e2e.mjs runners.`,
);
