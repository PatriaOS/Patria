import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { memberDisplayName } from '../../lib/displayName';
import {
  approveFirstDevice,
  approveOwnExtraDevice,
  fetchFirstDeviceNotices,
} from '../../lib/crypto/deviceAccess';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { fetchMembers, fetchMemberships } from '../../lib/family';
import { renderScreen } from '../../test/renderScreen';
import { FamilyDeviceNotices } from './FamilyDeviceNotices';

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/family', () => ({
  fetchMemberships: jest.fn(async () => [
    { space: { id: 's1', name: 'The Riveras' }, role: 'family_admin' },
  ]),
  fetchMembers: jest.fn(async () => [
    {
      id: 'm1',
      userId: 'u1',
      role: 'family_admin',
      relationshipLabel: null,
      displayName: 'Family member',
    },
    {
      id: 'm2',
      userId: 'u2',
      role: 'elder',
      relationshipLabel: null,
      displayName: 'Family member',
    },
  ]),
  fetchChildren: jest.fn(async () => []),
  fetchPendingInvites: jest.fn(async () => []),
}));

jest.mock('../../lib/crypto/familyCeremony', () => ({
  ensureKeysForOpenFamily: jest.fn(async () => 'ready'),
}));

jest.mock('../../lib/crypto/deviceAccess', () => ({
  fetchFirstDeviceNotices: jest.fn(async () => []),
  approveFirstDevice: jest.fn(async () => undefined),
  declineFirstDevice: jest.fn(async () => undefined),
  approveOwnExtraDevice: jest.fn(async () => undefined),
  rejectOwnExtraDevice: jest.fn(async () => undefined),
}));

jest.mock('../../lib/crypto/deviceIdentity', () => ({
  ensureDeviceIdentity: jest.fn(async () => ({
    deviceId: 'd-admin',
    publicKey: new Uint8Array(32),
    privateKey: new Uint8Array(32),
  })),
}));

jest.mock('../../lib/crypto/recoverFlow', () => ({
  supabaseRecoverFlowGateway: {
    listRequests: jest.fn(async () => []),
    listRemovedNotices: jest.fn(async () => []),
    listHelperRefreshNotices: jest.fn(async () => []),
    dismissHelperRefreshNotice: jest.fn(async () => undefined),
  },
  cancelRecoveryRequest: jest.fn(async () => undefined),
  approveRecoveryAsContact: jest.fn(async () => undefined),
  cancelledCopyKind: () => 'you',
  requestCanFinish: () => true,
}));

jest.mock('../../lib/crypto/recoverySetup', () => ({
  loadRecoverySnapshot: jest.fn(async () => ({
    contacts: [],
    ownContacts: [],
    accepted: 0,
    pending: [],
    hasPaper: false,
    hasRecoveryPublic: false,
    recoveryKeyEpoch: 1,
    keyEpoch: 1,
    status: 'not_setup',
  })),
  respondRecoveryInvite: jest.fn(async () => undefined),
}));

jest.mock('../../lib/crypto/recoveryAccess', () => ({
  supabaseRecoveryAccessGateway: {
    listHelperRefreshNotices: jest.fn(async () => []),
    dismissHelperRefreshNotice: jest.fn(async () => undefined),
  },
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
  writeCurrentFamilyId: jest.fn(async () => undefined),
}));

describe('FamilyDeviceNotices', () => {
  beforeEach(() => {
    (fetchMemberships as jest.Mock).mockResolvedValue([
      { space: { id: 's1', name: 'The Riveras' }, role: 'family_admin' },
    ]);
    (fetchMembers as jest.Mock).mockResolvedValue([
      {
        id: 'm1',
        userId: 'u1',
        role: 'family_admin',
        relationshipLabel: null,
        displayName: memberDisplayName(''),
      },
      {
        id: 'm2',
        userId: 'u2',
        role: 'elder',
        relationshipLabel: null,
        displayName: memberDisplayName(null),
      },
    ]);
    (ensureKeysForOpenFamily as jest.Mock).mockResolvedValue('ready');
    (fetchFirstDeviceNotices as jest.Mock).mockResolvedValue([]);
    (approveFirstDevice as jest.Mock).mockClear();
    (approveOwnExtraDevice as jest.Mock).mockClear();
    (loadRecoverySnapshot as jest.Mock).mockResolvedValue({
      contacts: [],
      ownContacts: [],
      accepted: 0,
      pending: [],
      hasPaper: false,
      hasRecoveryPublic: false,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
      status: 'not_setup',
    });
  });

  it('lets an admin wrap or decline a first device from Family', async () => {
    (fetchFirstDeviceNotices as jest.Mock).mockResolvedValue([
      {
        id: 'n1',
        spaceId: 's1',
        userId: 'u2',
        deviceId: 'd-marco',
        publicKey: new Uint8Array(32),
        deviceCreatedAt: '2026-10-12T12:00:00.000Z',
        kind: 'first_device',
      },
    ]);
    const { findByText, findByTestId, getByText } = await renderScreen(<FamilyDeviceNotices />);
    expect(await findByText(`${copy.member.fallbackName} added a new phone`)).toBeTruthy();
    expect(await findByTestId('let-in-notice')).toBeTruthy();
    await fireEvent.press(getByText(copy.home.letIn));
    await waitFor(() => {
      expect(approveFirstDevice).toHaveBeenCalled();
    });
  });

  it('lets a member approve their own extra phone', async () => {
    (fetchFirstDeviceNotices as jest.Mock).mockResolvedValue([
      {
        id: 'n-extra',
        spaceId: 's1',
        userId: 'u1',
        deviceId: 'd-new',
        publicKey: new Uint8Array(32),
        deviceCreatedAt: '2026-10-12T12:00:00.000Z',
        kind: 'extra_device',
      },
    ]);
    const { findByText, queryByText } = await renderScreen(<FamilyDeviceNotices />);
    expect(await findByText(copy.home.extraDeviceOwnNotice)).toBeTruthy();
    expect(queryByText(copy.home.letIn)).toBeNull();
    await fireEvent.press(await findByText(copy.home.yesMyPhone));
    await waitFor(() => {
      expect(approveOwnExtraDevice).toHaveBeenCalled();
    });
  });

  it('shows admins an information-only extra-device notice', async () => {
    (fetchFirstDeviceNotices as jest.Mock).mockResolvedValue([
      {
        id: 'n-extra-other',
        spaceId: 's1',
        userId: 'u2',
        deviceId: 'd-marco-2',
        publicKey: new Uint8Array(32),
        deviceCreatedAt: '2026-10-12T12:00:00.000Z',
        kind: 'extra_device',
      },
    ]);
    const { findByText, queryByText } = await renderScreen(<FamilyDeviceNotices />);
    expect(await findByText(`${copy.member.fallbackName} added a new phone`)).toBeTruthy();
    expect(queryByText(copy.home.letIn)).toBeNull();
    expect(queryByText(copy.home.yesMyPhone)).toBeNull();
  });

  it('shows helper recovery card title, confirm body, Started date, Help, and This wasn’t me', async () => {
    (fetchMemberships as jest.Mock).mockResolvedValue([
      { space: { id: 's1', name: 'The Riveras' }, role: 'elder' },
    ]);
    (fetchMembers as jest.Mock).mockResolvedValue([
      {
        id: 'm1',
        userId: 'u-owner',
        role: 'family_admin',
        relationshipLabel: null,
        displayName: 'Test 1',
      },
      {
        id: 'm2',
        userId: 'u1',
        role: 'elder',
        relationshipLabel: null,
        displayName: 'Test 2',
      },
    ]);
    (loadRecoverySnapshot as jest.Mock).mockResolvedValue({
      contacts: [
        {
          id: 'c1',
          spaceId: 's1',
          memberId: 'u-owner',
          userId: 'u1',
          slot: 'a',
          status: 'accepted',
        },
      ],
      ownContacts: [],
      accepted: 0,
      pending: [],
      hasPaper: false,
      hasRecoveryPublic: false,
      hasAb: false,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
      status: 'setup',
    });
    const recoverFlow = jest.requireMock('../../lib/crypto/recoverFlow') as {
      supabaseRecoverFlowGateway: {
        listRequests: jest.Mock;
        listRemovedNotices: jest.Mock;
        listHelperRefreshNotices: jest.Mock;
      };
      cancelRecoveryRequest: jest.Mock;
    };
    recoverFlow.supabaseRecoverFlowGateway.listRequests.mockResolvedValue([
      {
        id: 'r1',
        spaceId: 's1',
        userId: 'u-owner',
        newDeviceId: 'd-lost',
        newDeviceCreatedAt: '2026-11-13T23:57:00.000Z',
        startedAt: '2026-11-13T23:57:00.000Z',
        notBefore: '2026-11-13T23:57:00.000Z',
        expiresAt: '2026-11-20T23:57:00.000Z',
        cancelledAt: null,
        cancelledBy: null,
        completedAt: null,
      },
    ]);
    recoverFlow.supabaseRecoverFlowGateway.listRemovedNotices.mockResolvedValue([]);
    recoverFlow.supabaseRecoverFlowGateway.listHelperRefreshNotices.mockResolvedValue([]);
    recoverFlow.cancelRecoveryRequest.mockClear();

    const { findByText, findByTestId, getByText } = await renderScreen(<FamilyDeviceNotices />);
    expect(
      await findByText(copy.home.recoveryContactAskedTitle.replace('{name}', 'Test 1')),
    ).toBeTruthy();
    expect(
      await findByText(copy.home.recoveryContactNotice.replace('{name}', 'Test 1')),
    ).toBeTruthy();
    expect(await findByTestId('help-with-recovery')).toBeTruthy();
    expect(await findByTestId('this-wasnt-me')).toBeTruthy();
    expect(getByText(copy.home.notMyPhone)).toBeTruthy();
    await fireEvent.press(getByText(copy.home.notMyPhone));
    await waitFor(() => {
      expect(recoverFlow.cancelRecoveryRequest).toHaveBeenCalledWith('r1');
    });
  });
});
