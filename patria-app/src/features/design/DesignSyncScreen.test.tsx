import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { DesignSyncScreen } from './DesignSyncScreen';

describe('Sync design preview', () => {
  const previousE2e = process.env.EXPO_PUBLIC_E2E;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_E2E = '1';
  });

  afterEach(() => {
    if (previousE2e === undefined) {
      delete process.env.EXPO_PUBLIC_E2E;
    } else {
      process.env.EXPO_PUBLIC_E2E = previousE2e;
    }
  });

  it('renders the Sync hub with fixture data', async () => {
    const { getByTestId, getByText } = await renderScreen(<DesignSyncScreen />);
    expect(getByTestId('design-sync')).toBeTruthy();
    expect(getByText('Soccer carpool on Thursday')).toBeTruthy();
    expect(getByText(copy.sync.tonightFlow)).toBeTruthy();
  });
});
