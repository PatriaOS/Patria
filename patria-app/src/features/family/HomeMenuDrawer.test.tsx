import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { HomeMenuDrawer } from './HomeMenuDrawer';

jest.mock('../vault/vaultPlayback', () => ({
  wipeVaultAudioCache: jest.fn(async () => undefined),
}));

describe('HomeMenuDrawer', () => {
  it('shows an in-app sign-out confirm that Cancel dismisses', async () => {
    const onSignOut = jest.fn();
    const { findByTestId, queryByTestId, getByText } = await renderScreen(
      <HomeMenuDrawer
        open
        onClose={jest.fn()}
        displayName="Test 1"
        familyName="The E2E Family"
        onSignOut={onSignOut}
      />,
    );

    await fireEvent.press(await findByTestId('menu-sign-out'));
    expect(await findByTestId('sign-out-confirm')).toBeTruthy();
    expect(getByText(copy.home.signOutConfirmTitle)).toBeTruthy();
    expect(getByText(copy.common.cancel)).toBeTruthy();

    await fireEvent.press(await findByTestId('sign-out-cancel'));
    await waitFor(() => {
      expect(queryByTestId('sign-out-confirm')).toBeNull();
    });
    expect(await findByTestId('menu-sign-out')).toBeTruthy();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('confirms sign out from the in-app sheet', async () => {
    const onSignOut = jest.fn();
    const { findByTestId } = await renderScreen(
      <HomeMenuDrawer
        open
        onClose={jest.fn()}
        displayName="Test 1"
        familyName="The E2E Family"
        onSignOut={onSignOut}
      />,
    );

    await fireEvent.press(await findByTestId('menu-sign-out'));
    await fireEvent.press(await findByTestId('sign-out-confirm-yes'));
    await waitFor(() => {
      expect(onSignOut).toHaveBeenCalled();
    });
  });
});
