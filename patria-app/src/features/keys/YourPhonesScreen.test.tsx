import { fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { copy } from '../../lib/copy';
import { listOwnPhones, removeOwnPhone } from '../../lib/crypto/deviceAccess';
import { ensureDeviceIdentity } from '../../lib/crypto/deviceIdentity';
import { renderScreen } from '../../test/renderScreen';
import { YourPhonesScreen } from './YourPhonesScreen';

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
}));

jest.mock('../../lib/crypto/deviceAccess', () => ({
  listOwnPhones: jest.fn(async () => []),
  removeOwnPhone: jest.fn(async () => undefined),
}));

jest.mock('../../lib/crypto/deviceIdentity', () => ({
  ensureDeviceIdentity: jest.fn(async () => ({
    deviceId: 'd-this',
    publicKey: new Uint8Array(32),
    privateKey: new Uint8Array(32),
  })),
}));

describe('YourPhonesScreen', () => {
  beforeEach(() => {
    (listOwnPhones as jest.Mock).mockResolvedValue([
      {
        deviceId: 'd-this',
        createdAt: '2026-10-12T12:00:00.000Z',
        rejectedAt: null,
        hasWrap: true,
      },
      {
        deviceId: 'd-other',
        createdAt: '2026-10-11T12:00:00.000Z',
        rejectedAt: null,
        hasWrap: true,
      },
    ]);
    (removeOwnPhone as jest.Mock).mockClear();
    (ensureDeviceIdentity as jest.Mock).mockResolvedValue({
      deviceId: 'd-this',
      publicKey: new Uint8Array(32),
      privateKey: new Uint8Array(32),
    });
  });

  it('marks this phone and lets the member remove another', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const remove = buttons?.find((item) => item.text === copy.phones.remove);
      remove?.onPress?.();
    });
    const { findByText, findByTestId } = await renderScreen(<YourPhonesScreen />);
    expect(await findByTestId('screen-your-phones')).toBeTruthy();
    expect(await findByText(copy.phones.thisPhone)).toBeTruthy();
    await fireEvent.press(await findByTestId('remove-phone'));
    await waitFor(() => {
      expect(removeOwnPhone).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'd-other',
          thisDeviceId: 'd-this',
        }),
      );
    });
    alertSpy.mockRestore();
  });
});
