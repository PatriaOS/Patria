import { screenSafeEdges } from './screenEdges';

describe('screenSafeEdges', () => {
  it('applies the top inset only when there is no header', () => {
    expect(screenSafeEdges({})).toEqual(['top', 'left', 'right', 'bottom']);
    expect(screenSafeEdges({ withHeader: true })).toEqual(['left', 'right', 'bottom']);
  });

  it('skips the bottom inset on tab screens', () => {
    expect(screenSafeEdges({ withTabBar: true })).toEqual(['top', 'left', 'right']);
    expect(screenSafeEdges({ withHeader: true, withTabBar: true })).toEqual(['left', 'right']);
  });
});
