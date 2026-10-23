import { fireEvent, waitFor } from '@testing-library/react-native';
import * as MediaLibrary from 'expo-media-library/legacy';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { ConnectPhotosScreen } from './ConnectPhotosScreen';
import { ConnectPhotosSettingsScreen } from './ConnectPhotosSettingsScreen';

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

describe('Connect photos', () => {
  it('explains before asking for library access', async () => {
    const { findByText } = await renderScreen(<ConnectPhotosScreen />);
    expect(await findByText(copy.memories.connectBody)).toBeTruthy();
    await fireEvent.press(await findByText(copy.memories.connectContinue));
    await waitFor(() => {
      expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalled();
    });
  });

  it('explains limited access and offers the picker and Settings', async () => {
    (MediaLibrary.getPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      accessPrivileges: 'limited',
    });
    const { findByTestId, findByText } = await renderScreen(<ConnectPhotosSettingsScreen />);
    expect(await findByTestId('limited-body')).toBeTruthy();
    expect(await findByText(copy.memories.limitedBody)).toBeTruthy();
    expect(await findByTestId('choose-allowed-photos')).toBeTruthy();
    expect(await findByTestId('open-settings')).toBeTruthy();
    expect(await findByTestId('albums-need-full')).toBeTruthy();
  });
});
