import { copy } from '../../lib/copy';
import { canTurnOnSharing, libraryStatusTone } from './connectSettings';

describe('canTurnOnSharing', () => {
  it('never allows sharing without a circle', () => {
    expect(
      canTurnOnSharing({ mode: 'all_new', circleId: null, albumIds: [] }),
    ).toBe(false);
    expect(
      canTurnOnSharing({ mode: 'selected_albums', circleId: null, albumIds: ['a1'] }),
    ).toBe(false);
  });

  it('allows All new photos once a circle is chosen, without network or cellular', () => {
    expect(
      canTurnOnSharing({ mode: 'all_new', circleId: 'hh', albumIds: [] }),
    ).toBe(true);
  });

  it('requires at least one album for Selected albums', () => {
    expect(
      canTurnOnSharing({ mode: 'selected_albums', circleId: 'hh', albumIds: [] }),
    ).toBe(false);
    expect(
      canTurnOnSharing({ mode: 'selected_albums', circleId: 'hh', albumIds: ['a1'] }),
    ).toBe(true);
  });
});

describe('libraryStatusTone', () => {
  it('marks up to date as success and waiting states as wait', () => {
    expect(libraryStatusTone(copy.memories.statusUpToDate)).toBe('success');
    expect(libraryStatusTone(copy.memories.statusWifi)).toBe('wait');
    expect(libraryStatusTone(copy.memories.statusPaused)).toBe('wait');
    expect(libraryStatusTone(copy.memories.statusChooseCircle)).toBe('danger');
  });
});
