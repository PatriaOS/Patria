import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { finishLostPhoneRecovery, startLostPhoneRecovery } from '../../lib/crypto/recoverFlow';
import { renderScreen } from '../../test/renderScreen';
import { RecoverLostPhoneScreen } from './RecoverLostPhoneScreen';

const now = Date.now();

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
}));

jest.mock('../../lib/family', () => ({
  fetchMemberships: jest.fn(async () => [
    { space: { id: 's1', name: 'The Riveras' }, role: 'family_admin' },
  ]),
}));

jest.mock('../../lib/crypto/deviceIdentity', () => ({
  ensureDeviceIdentity: jest.fn(async () => ({
    deviceId: 'd-new',
    publicKey: new Uint8Array(32),
    privateKey: new Uint8Array(32),
  })),
}));

jest.mock('../../lib/crypto/recoverFlow', () => ({
  supabaseRecoverFlowGateway: {
    listRequests: jest.fn(async () => []),
    listHelpers: jest.fn(async () => []),
  },
  startLostPhoneRecovery: jest.fn(async () => 'r1'),
  finishLostPhoneRecovery: jest.fn(async () => undefined),
  cancelledCopyKind: (cancelledBy: string, userId: string) =>
    cancelledBy === userId ? 'you' : 'admin',
  requestCanFinish: (request: { cancelledAt: string | null; completedAt: string | null; notBefore: string; expiresAt: string }) =>
    request.cancelledAt == null &&
    request.completedAt == null &&
    Date.now() >= Date.parse(request.notBefore) &&
    Date.now() < Date.parse(request.expiresAt),
  requestIsWaiting: () => false,
}));

describe('RecoverLostPhoneScreen', () => {
  beforeEach(() => {
    const recoverFlow = jest.requireMock('../../lib/crypto/recoverFlow') as {
      supabaseRecoverFlowGateway: { listRequests: jest.Mock; listHelpers: jest.Mock };
      startLostPhoneRecovery: jest.Mock;
      finishLostPhoneRecovery: jest.Mock;
    };
    recoverFlow.supabaseRecoverFlowGateway.listRequests.mockReset();
    recoverFlow.supabaseRecoverFlowGateway.listRequests.mockResolvedValue([]);
    recoverFlow.supabaseRecoverFlowGateway.listHelpers.mockResolvedValue([]);
    recoverFlow.startLostPhoneRecovery.mockClear();
    recoverFlow.finishLostPhoneRecovery.mockReset();
    recoverFlow.finishLostPhoneRecovery.mockResolvedValue(undefined);
  });

  it('starts recovery from the new phone', async () => {
    const { findByText } = await renderScreen(<RecoverLostPhoneScreen />);
    await fireEvent.press(await findByText(copy.recovery.lostStart));
    await waitFor(() => {
      expect(startLostPhoneRecovery).toHaveBeenCalled();
    });
  });

  it('shows cancelled by a family admin', async () => {
    const recoverFlow = jest.requireMock('../../lib/crypto/recoverFlow') as {
      supabaseRecoverFlowGateway: { listRequests: jest.Mock };
    };
    recoverFlow.supabaseRecoverFlowGateway.listRequests.mockResolvedValueOnce([
      {
        id: 'r1',
        spaceId: 's1',
        userId: 'u1',
        newDeviceId: 'd-new',
        newDeviceCreatedAt: new Date(now).toISOString(),
        startedAt: new Date(now).toISOString(),
        notBefore: new Date(now + 1000).toISOString(),
        expiresAt: new Date(now + 7 * 86400_000).toISOString(),
        cancelledAt: new Date(now).toISOString(),
        cancelledBy: 'u-admin',
        completedAt: null,
      },
    ]);
    const { findByText } = await renderScreen(<RecoverLostPhoneScreen />);
    expect(await findByText(copy.home.recoveryCancelledByAdmin)).toBeTruthy();
  });

  it('clears typed paper words when the mnemonic is wrong', async () => {
    const recoverFlow = jest.requireMock('../../lib/crypto/recoverFlow') as {
      supabaseRecoverFlowGateway: { listRequests: jest.Mock; listHelpers: jest.Mock };
      finishLostPhoneRecovery: jest.Mock;
    };
    recoverFlow.supabaseRecoverFlowGateway.listRequests.mockResolvedValue([
      {
        id: 'r1',
        spaceId: 's1',
        userId: 'u1',
        newDeviceId: 'd-new',
        newDeviceCreatedAt: new Date(now - 49 * 3600_000).toISOString(),
        startedAt: new Date(now - 49 * 3600_000).toISOString(),
        notBefore: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 6 * 86400_000).toISOString(),
        cancelledAt: null,
        cancelledBy: null,
        completedAt: null,
      },
    ]);
    recoverFlow.supabaseRecoverFlowGateway.listHelpers.mockResolvedValue([
      { slot: 'a', wrappedSecret: new Uint8Array(80) },
    ]);
    recoverFlow.finishLostPhoneRecovery.mockRejectedValueOnce(new Error('printed code failed'));
    const { findByText, getByLabelText } = await renderScreen(<RecoverLostPhoneScreen />);
    await findByText(copy.recovery.lostFinish);
    await fireEvent.changeText(getByLabelText(copy.recovery.lostPaperLabel), 'not a mnemonic at all');
    await fireEvent.press(getByLabelText(copy.recovery.lostFinish));
    await waitFor(() => {
      expect(finishLostPhoneRecovery).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(getByLabelText(copy.recovery.lostPaperLabel).props.value).toBe('');
    });
  });
});
