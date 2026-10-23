import { fireEvent, waitFor } from '@testing-library/react-native';
import * as MediaLibrary from 'expo-media-library/legacy';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { ConnectPhotosScreen } from './ConnectPhotosScreen';
import { ConnectPhotosSettingsScreen } from './ConnectPhotosSettingsScreen';
import { upsertConnection } from './libraryApi';

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
}));

jest.mock('../../lib/crypto/deviceIdentity', () => ({
  ensureDeviceIdentity: jest.fn(async () => ({ deviceId: 'd1', publicKey: new Uint8Array(), privateKey: new Uint8Array() })),
}));

jest.mock('./memoryApi', () => ({
  fetchUploaderCircles: jest.fn(async () => [{ id: 'hh', name: 'Household', kind: 'household' }]),
}));

jest.mock('./libraryApi', () => ({
  librarySyncSupported: () => true,
  upsertConnection: jest.fn(async () => ({ id: 'c1' })),
}));

jest.mock('./libraryAlbums', () => ({
  writeAlbumIds: jest.fn(async () => undefined),
}));

function mockAccess(privileges: 'all' | 'limited' | 'none') {
  if (privileges === 'none') {
    (MediaLibrary.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
      accessPrivileges: 'none',
    });
    return;
  }
  (MediaLibrary.getPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'granted',
    accessPrivileges: privileges,
  });
}

describe('Connect photos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess('all');
  });

  it('explains before asking for library access', async () => {
    const { findByText } = await renderScreen(<ConnectPhotosScreen />);
    expect(await findByText(copy.memories.connectBody)).toBeTruthy();
    await fireEvent.press(await findByText(copy.memories.connectContinue));
    await waitFor(() => {
      expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalled();
    });
  });

  it('shows Full access without Open Settings', async () => {
    const { findByTestId, queryByTestId, findByText } = await renderScreen(
      <ConnectPhotosSettingsScreen />,
    );
    expect(await findByTestId('photo-access-full')).toBeTruthy();
    expect(await findByText(copy.memories.photoAccessFull)).toBeTruthy();
    expect(queryByTestId('open-settings')).toBeNull();
    expect(await findByTestId('step-what')).toBeTruthy();
    expect(await findByTestId('step-who')).toBeTruthy();
    expect(await findByTestId('mode-faces')).toBeTruthy();
  });

  it('explains limited access and offers the picker and Settings', async () => {
    mockAccess('limited');
    const { findByTestId, findByText } = await renderScreen(<ConnectPhotosSettingsScreen />);
    expect(await findByTestId('limited-body')).toBeTruthy();
    expect(await findByText(copy.memories.limitedBody)).toBeTruthy();
    expect(await findByTestId('choose-allowed-photos')).toBeTruthy();
    expect(await findByTestId('open-settings')).toBeTruthy();
    expect(await findByTestId('albums-need-full')).toBeTruthy();
  });

  it('explains denied access and offers Settings', async () => {
    mockAccess('none');
    const { findByTestId, queryByTestId } = await renderScreen(<ConnectPhotosSettingsScreen />);
    expect(await findByTestId('photo-access-denied')).toBeTruthy();
    expect(await findByTestId('open-settings')).toBeTruthy();
    expect(queryByTestId('photo-access-full')).toBeNull();
  });

  it('does not turn on sharing without a circle', async () => {
    const { findByTestId, findAllByText } = await renderScreen(<ConnectPhotosSettingsScreen />);
    const turnOn = await findByTestId('turn-on-sharing');
    expect(turnOn.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    expect(await findByTestId('choose-who')).toBeTruthy();
    await fireEvent.press(turnOn);
    expect((await findAllByText(copy.memories.chooseCircleFirst)).length).toBeGreaterThan(0);
    expect(upsertConnection).not.toHaveBeenCalled();
  });

  it('keeps Turn on sharing pressable regardless of the cellular switch', async () => {
    const { findByTestId } = await renderScreen(<ConnectPhotosSettingsScreen />);
    const turnOn = await findByTestId('turn-on-sharing');
    const cellular = await findByTestId('use-cellular');
    expect(turnOn.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    await fireEvent(cellular, 'valueChange', true);
    expect(turnOn.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    await fireEvent.press(turnOn);
    expect(upsertConnection).not.toHaveBeenCalled();
  });

  it('turns on sharing after a circle is chosen, even on WiFi only', async () => {
    const { findByTestId, queryByTestId } = await renderScreen(<ConnectPhotosSettingsScreen />);
    await fireEvent.press(await findByTestId('connect-circle-household'));
    expect(await findByTestId('connect-circle-household-selected')).toBeTruthy();
    expect(queryByTestId('choose-who')).toBeNull();
    await fireEvent.press(await findByTestId('turn-on-sharing'));
    await waitFor(() => {
      expect(upsertConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          circleId: 'hh',
          allowCellular: false,
          mode: 'all_new',
        }),
      );
    });
  });
});
