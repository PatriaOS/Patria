import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APP_ROOT,
  MAESTRO_DIR,
  PHONE_AREA_LIST,
  PHONE_TESTS,
  parseAreaList,
  parsePhoneTests,
  phoneCoverageErrors,
  runnerNumbersFromSource,
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
const runnerNumbers = runnerNumbersFromSource(
  readFileSync(join(APP_ROOT, 'scripts', 'e2e.mjs'), 'utf8'),
);

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
