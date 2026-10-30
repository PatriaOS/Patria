import { space } from '../theme/tokens';
import { screenScrollPaddingBottom } from './screenScrollPadding';

describe('screenScrollPaddingBottom', () => {
  it('clears the tab bar with a fixed clearance above the usual page pad', () => {
    expect(screenScrollPaddingBottom({ withTabBar: true, bottomInset: 34 })).toBe(
      space.xxl + 80,
    );
  });

  it('adds page pad plus the home-indicator inset when there is no tab bar', () => {
    expect(screenScrollPaddingBottom({ withTabBar: false, bottomInset: 34 })).toBe(
      space.xxl + space.xl + 34,
    );
    expect(screenScrollPaddingBottom({ withTabBar: false, bottomInset: 0 })).toBe(
      space.xxl + space.xl,
    );
  });
});
