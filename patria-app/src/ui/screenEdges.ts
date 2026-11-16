export type ScreenEdge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Horizontal + bottom edges for SafeAreaView.
 * Top inset is applied explicitly in Screen via useSafeAreaInsets so
 * headerless onboarding screens never sit under the status bar (iOS).
 */
export function screenSafeEdges({
  withHeader = false,
  withTabBar = false,
}: {
  withHeader?: boolean;
  withTabBar?: boolean;
}): ScreenEdge[] {
  void withHeader;
  const edges: ScreenEdge[] = ['left', 'right'];
  if (!withTabBar) {
    edges.push('bottom');
  }
  return edges;
}
