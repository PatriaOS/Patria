import { parseAppearance } from './appearance';

describe('appearance choice', () => {
  it('accepts system, light and dark', () => {
    expect(parseAppearance('system')).toBe('system');
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('dark')).toBe('dark');
  });

  it('falls back to system when missing or unknown', () => {
    expect(parseAppearance(null)).toBe('system');
    expect(parseAppearance('sepia')).toBe('system');
  });
});
