// @ts-nocheck
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Keep these helpers aligned with scripts/e2e-lib.mjs
 * (runnerNumbersFromSource + phoneCoverageErrors).
 */
function runnerNumbersFromSource(source: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of source.matchAll(/if\s*\(\s*test\.number\s*===\s*(\d+)\s*\)/g)) {
    numbers.add(Number(match[1]));
  }
  return numbers;
}

function phoneCoverageErrors(input: {
  tests: { number: number; title: string; manual: boolean }[];
  flowNumbers: Set<number>;
  runnerNumbers: Set<number>;
}): string[] {
  const errors: string[] = [];
  for (const test of input.tests) {
    if (test.manual) {
      continue;
    }
    if (!input.flowNumbers.has(test.number)) {
      errors.push(
        `PHONE_TESTS.md test ${test.number} ("${test.title}") has no Maestro flow and is not marked (manual).`,
      );
    }
    if (!input.runnerNumbers.has(test.number)) {
      errors.push(
        `PHONE_TESTS.md test ${test.number} ("${test.title}") has no runner in scripts/e2e.mjs (look for if (test.number === ${test.number})).`,
      );
    }
  }
  return errors;
}

function parsePhoneTests(markdown: string) {
  const tests: { number: number; title: string; manual: boolean }[] = [];
  const heading = /^### (\d+)\.\s+(.+)$/gm;
  let match = heading.exec(markdown);
  while (match) {
    const number = Number(match[1]);
    const title = match[2].trim();
    tests.push({ number, title, manual: /\(manual\)/i.test(title) });
    match = heading.exec(markdown);
  }
  return tests;
}

const appRoot = join(__dirname, '..', '..');
const repoRoot = join(appRoot, '..');

describe('phone test coverage', () => {
  it('flags a flow without a runner', () => {
    const errors = phoneCoverageErrors({
      tests: [{ number: 99, title: 'Missing runner', manual: false }],
      flowNumbers: new Set([99]),
      runnerNumbers: new Set(),
    });
    expect(errors).toEqual([
      'PHONE_TESTS.md test 99 ("Missing runner") has no runner in scripts/e2e.mjs (look for if (test.number === 99)).',
    ]);
  });

  it('allows manual tests with neither flow nor runner', () => {
    expect(
      phoneCoverageErrors({
        tests: [{ number: 7, title: 'Large text (manual)', manual: true }],
        flowNumbers: new Set(),
        runnerNumbers: new Set(),
      }),
    ).toEqual([]);
  });

  it('every non-manual PHONE_TESTS entry has a Maestro flow and an e2e.mjs runner', () => {
    const tests = parsePhoneTests(
      readFileSync(join(repoRoot, 'docs', 'testing', 'PHONE_TESTS.md'), 'utf8'),
    );
    const flowNumbers = new Set(
      readdirSync(join(appRoot, '.maestro'))
        .map((name: string) => {
          const match = name.match(/^(\d+)_.*\.ya?ml$/);
          return match ? Number(match[1]) : null;
        })
        .filter((number: number | null): number is number => number != null),
    );
    const runnerNumbers = runnerNumbersFromSource(
      readFileSync(join(appRoot, 'scripts', 'e2e.mjs'), 'utf8'),
    );
    expect(phoneCoverageErrors({ tests, flowNumbers, runnerNumbers })).toEqual([]);
  });
});
