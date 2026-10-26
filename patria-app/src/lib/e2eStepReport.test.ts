// @ts-nocheck
/**
 * Keep aligned with scripts/e2e-lib.mjs notReachedRows.
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
});
