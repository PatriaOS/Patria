// @ts-nocheck
/**
 * Keep aligned with scripts/e2e-lib.mjs notReachedRows + firstFailureSummary.
 */
function notReachedRows(input: {
  testNumber: number;
  phoneSteps: { number: number; text: string }[];
  reportsForTest: { stepNumber: number; status: string }[];
  failedStepNumber: number;
}) {
  const reported = new Set(input.reportsForTest.map((row) => row.stepNumber));
  const rows = [];
  for (const item of input.phoneSteps) {
    if (item.number <= input.failedStepNumber || reported.has(item.number)) {
      continue;
    }
    rows.push({
      testNumber: input.testNumber,
      stepNumber: item.number,
      label: item.text,
      status: 'skip',
      detail: 'not reached',
    });
  }
  return rows;
}

function firstFailureSummary(
  rows: { stepNumber: number; label: string; status: string; detail?: string }[],
) {
  const failedStep = rows.find((row) => row.status === 'fail');
  if (!failedStep) {
    return '';
  }
  const detail = failedStep.detail ? ` — ${failedStep.detail}` : '';
  return `step ${failedStep.stepNumber}: ${failedStep.label}${detail}`;
}

describe('e2e step reporter', () => {
  it('marks later phone steps as not reached after a failure', () => {
    const rows = notReachedRows({
      testNumber: 36,
      phoneSteps: [
        { number: 1, text: 'Set up' },
        { number: 2, text: 'Fields' },
        { number: 3, text: 'Save' },
        { number: 4, text: 'Test 2' },
      ],
      reportsForTest: [
        { stepNumber: 1, status: 'pass' },
        { stepNumber: 2, status: 'fail' },
      ],
      failedStepNumber: 2,
    });
    expect(rows).toEqual([
      {
        testNumber: 36,
        stepNumber: 3,
        label: 'Save',
        status: 'skip',
        detail: 'not reached',
      },
      {
        testNumber: 36,
        stepNumber: 4,
        label: 'Test 2',
        status: 'skip',
        detail: 'not reached',
      },
    ]);
  });

  it('does not invent rows for steps already reported', () => {
    expect(
      notReachedRows({
        testNumber: 37,
        phoneSteps: [
          { number: 1, text: 'Add' },
          { number: 2, text: 'Shows' },
        ],
        reportsForTest: [
          { stepNumber: 1, status: 'fail' },
          { stepNumber: 2, status: 'pass' },
        ],
        failedStepNumber: 1,
      }),
    ).toEqual([]);
  });

  it('names the step that actually failed, not an earlier pass', () => {
    expect(
      firstFailureSummary([
        { stepNumber: 1, label: 'Menu drawer opens from Home', status: 'pass' },
        { stepNumber: 2, label: 'Double-tap Settings opens Appearance once', status: 'pass' },
        {
          stepNumber: 3,
          label: 'Privacy and Security and Sign out cancel',
          status: 'fail',
          detail: 'Assertion is false: id: sign-out-confirm is visible',
        },
        { stepNumber: 4, label: 'Confirm Sign out lands on Welcome', status: 'skip', detail: 'not reached' },
      ]),
    ).toBe(
      'step 3: Privacy and Security and Sign out cancel — Assertion is false: id: sign-out-confirm is visible',
    );
  });

  it('returns empty when nothing failed', () => {
    expect(
      firstFailureSummary([
        { stepNumber: 1, label: 'Open', status: 'pass' },
        { stepNumber: 2, label: 'Done', status: 'pass' },
      ]),
    ).toBe('');
  });
});
