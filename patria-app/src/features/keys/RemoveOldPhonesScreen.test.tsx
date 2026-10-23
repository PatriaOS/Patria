import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { listOwnPhones, removeOwnPhone } from '../../lib/crypto/deviceAccess';
import { renderScreen } from '../../test/renderScreen';
import { RemoveOldPhonesScreen } from './RemoveOldPhonesScreen';

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

describe('RemoveOldPhonesScreen', () => {
  it('lists old phones preselected and removes them in one tap', async () => {
    (listOwnPhones as jest.Mock).mockResolvedValue([
      {
        deviceId: 'd-this',
        createdAt: '2026-10-12T12:00:00.000Z',
        rejectedAt: null,
        hasWrap: true,
      },
      {
        deviceId: 'd-old-1',
        createdAt: '2026-10-01T12:00:00.000Z',
        rejectedAt: null,
        hasWrap: true,
      },
      {
        deviceId: 'd-old-2',
        createdAt: '2026-10-02T12:00:00.000Z',
        rejectedAt: null,
        hasWrap: true,
      },
    ]);
    const { findByText } = await renderScreen(<RemoveOldPhonesScreen />);
    await fireEvent.press(await findByText(copy.recovery.removeOldAction));
    await waitFor(() => {
      expect(removeOwnPhone).toHaveBeenCalledTimes(2);
    });
    expect(removeOwnPhone).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'd-old-1', thisDeviceId: 'd-this' }),
    );
    expect(removeOwnPhone).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'd-old-2', thisDeviceId: 'd-this' }),
    );
  });
});
