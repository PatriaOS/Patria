export type ScreenEdge = 'top' | 'bottom' | 'left' | 'right';

export function screenSafeEdges({
  withHeader = false,
  withTabBar = false,
}: {
  withHeader?: boolean;
  withTabBar?: boolean;
}): ScreenEdge[] {
  const edges: ScreenEdge[] = ['left', 'right'];
  if (!withHeader) {
    edges.unshift('top');
  }
  if (!withTabBar) {
    edges.push('bottom');
  }
  return edges;
}
