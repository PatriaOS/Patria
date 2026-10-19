import { assertContrast, contrastRatio } from './contrast';
import { contrastPairs } from './contrastPairs';

describe('Hearth contrast', () => {
  it('meets 4.5:1 for body pairs and 3:1 for large type', () => {
    for (const pair of contrastPairs) {
      expect(() => assertContrast(pair)).not.toThrow();
      expect(contrastRatio(pair.foreground, pair.background)).toBeGreaterThanOrEqual(pair.min);
    }
  });
});
