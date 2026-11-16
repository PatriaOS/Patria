import { initialWindowMetrics } from 'react-native-safe-area-context';

/**
 * Native stack can report insets.top as 0 with headerShown:false while the
 * status bar still covers content. Floor with the launch-time window metrics.
 */
export function topSafeInset(insetsTop: number): number {
  const fromWindow = initialWindowMetrics?.insets.top ?? 0;
  return Math.max(insetsTop, fromWindow);
}
