import { space } from '../theme/tokens';

/** Extra room under tab icons (bar height above the home-indicator inset). */
const TAB_BAR_CONTENT_CLEARANCE = 80;

/**
 * Bottom padding for Screen ScrollView content so the last lines clear the
 * tab bar and sit above the phone's home indicator with room to breathe.
 * SafeAreaView still applies the bottom edge when there is no tab bar; this
 * padding is the scrollable gap after the last line (xxl was flush at large
 * text).
 */
export function screenScrollPaddingBottom(options: {
  withTabBar: boolean;
  bottomInset: number;
}): number {
  const inset = Math.max(options.bottomInset, 0);
  if (options.withTabBar) {
    return space.xxl + TAB_BAR_CONTENT_CLEARANCE;
  }
  return space.xxl + space.xl + inset;
}
