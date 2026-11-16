import { initialWindowMetrics } from 'react-native-safe-area-context';

import { topSafeInset } from './screenTopInset';

describe('topSafeInset', () => {
  it('uses the larger of live insets and initial window metrics', () => {
    const windowTop = initialWindowMetrics?.insets.top ?? 0;
    expect(topSafeInset(0)).toBe(windowTop);
    expect(topSafeInset(59)).toBe(Math.max(59, windowTop));
  });
});
