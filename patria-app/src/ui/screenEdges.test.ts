import { screenSafeEdges } from './screenEdges';

describe('screenSafeEdges', () => {
  it('leaves top to Screen padding (status bar) and keeps left/right/bottom', () => {
    expect(screenSafeEdges({})).toEqual(['left', 'right', 'bottom']);
    expect(screenSafeEdges({ withHeader: true })).toEqual(['left', 'right', 'bottom']);
  });

  it('skips the bottom inset on tab screens', () => {
    expect(screenSafeEdges({ withTabBar: true })).toEqual(['left', 'right']);
    expect(screenSafeEdges({ withHeader: true, withTabBar: true })).toEqual(['left', 'right']);
  });
});
