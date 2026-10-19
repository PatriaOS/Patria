import { fontGateShouldContinue } from './fonts';
import { FONT_LOAD_TIMEOUT_MS } from './tokens';

describe('font load timeout', () => {
  it('gives up after four seconds so the splash cannot hang', () => {
    expect(FONT_LOAD_TIMEOUT_MS).toBe(4000);
    expect(fontGateShouldContinue(false, false, false)).toBe(false);
    expect(fontGateShouldContinue(true, false, false)).toBe(true);
    expect(fontGateShouldContinue(false, true, false)).toBe(true);
    expect(fontGateShouldContinue(false, false, true)).toBe(true);
  });
});
