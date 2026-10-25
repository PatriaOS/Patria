import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { DesignSyncScreen } from './DesignSyncScreen';

describe('Sync design preview', () => {
  it('renders the Sync hub with fixture data', async () => {
    const { getByTestId, getByText } = await renderScreen(<DesignSyncScreen />);
    expect(getByTestId('design-sync')).toBeTruthy();
    expect(getByText('Soccer carpool on Thursday')).toBeTruthy();
    expect(getByText(copy.sync.tonightFlow)).toBeTruthy();
  });
});
