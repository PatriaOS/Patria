import { fireEvent, waitFor } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import { copy } from '../../lib/copy';
import { memberDisplayName } from '../../lib/displayName';
import {
  fetchChildren,
  fetchMembers,
  fetchMemberships,
  fetchPendingInvites,
} from '../../lib/family';
import {
  approveFirstDevice,
  approveOwnExtraDevice,
  declineFirstDevice,
  fetchFirstDeviceNotices,
  rejectOwnExtraDevice,
} from '../../lib/crypto/deviceAccess';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { rotateFamilyKeyIfNeeded } from '../../lib/crypto/rotateFamilyKey';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { supabase } from '../../lib/supabase';
import { renderScreen } from '../../test/renderScreen';
import { HomeScreen } from './HomeScreen';

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
      role: 'co_admin',
      relationshipLabel: null,
      displayName: 'Family member',
    },
  ]),
  fetchChildren: jest.fn(async () => []),
  fetchPendingInvites: jest.fn(async () => []),
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
  writeCurrentFamilyId: jest.fn(async () => undefined),
}));

jest.mock('../../lib/crypto/familyCeremony', () => ({
  ensureKeysForOpenFamily: jest.fn(async () => 'ready'),
}));

jest.mock('../../lib/crypto/rotateFamilyKey', () => ({
  rotateFamilyKeyIfNeeded: jest.fn(async () => 'idle'),
  homeRotationQueryKey: (spaceId: string) => ['homeRotationUi', spaceId],
  homeRotationUiFromOutcome: (outcome: string) =>
    outcome === 'failed' ? 'failed' : outcome === 'idle' ? 'hidden' : 'upToDate',
}));

jest.mock('../../lib/crypto/deviceAccess', () => ({
  fetchFirstDeviceNotices: jest.fn(async () => []),
  approveFirstDevice: jest.fn(async () => undefined),
  declineFirstDevice: jest.fn(async () => undefined),
  approveOwnExtraDevice: jest.fn(async () => undefined),
  rejectOwnExtraDevice: jest.fn(async () => undefined),
}));

jest.mock('../../lib/crypto/recoverFlow', () => ({
  supabaseRecoverFlowGateway: {
    listRequests: jest.fn(async () => []),
    listRemovedNotices: jest.fn(async () => []),
  },
  cancelRecoveryRequest: jest.fn(async () => undefined),
  approveRecoveryAsContact: jest.fn(async () => undefined),
  cancelledCopyKind: (cancelledBy: string, userId: string) =>
    cancelledBy === userId ? 'you' : 'admin',
  requestCanFinish: () => false,
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
  fulfillAcceptedContacts: jest.fn(async () => undefined),
  respondRecoveryInvite: jest.fn(async () => undefined),
}));

jest.mock('../../lib/crypto/deviceIdentity', () => ({
  ensureDeviceIdentity: jest.fn(async () => ({
    deviceId: 'd-admin',
    publicKey: new Uint8Array(32),
    privateKey: new Uint8Array(32),
  })),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { signOut: jest.fn(async () => ({ error: null })) },
  },
}));

jest.mock('../memories/memoryApi', () => ({
  fetchReadyMemories: jest.fn(async () => []),
}));

function mockedRouter(): { push: jest.Mock; replace: jest.Mock } {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { push: jest.Mock; replace: jest.Mock };
  };
  return expoRouter.useRouter();
}

function hostByType(node: TestInstance, type: string): TestInstance {
  if (node.type === type) {
    return node;
  }
  for (const child of node.children) {
    if (typeof child !== 'string') {
      try {
        return hostByType(child, type);
      } catch {
        continue;
      }
    }
  }
  throw new Error(`missing host ${type}`);
}

describe('HomeScreen invite entry', () => {
  // First HomeScreen mount is slow on Linux; collection is not billed to an `it`.
  beforeAll(async () => {
    const warmed = await renderScreen(<HomeScreen />);
    await warmed.unmount();
    warmed.queryClient.clear();
  });

  beforeEach(() => {
    mockedRouter().push.mockClear();
    mockedRouter().replace.mockClear();
    (supabase.auth.signOut as jest.Mock).mockClear();
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
        role: 'co_admin',
        relationshipLabel: null,
        displayName: memberDisplayName(null),
      },
    ]);
    (fetchChildren as jest.Mock).mockResolvedValue([]);
    (fetchPendingInvites as jest.Mock).mockResolvedValue([]);
    (fetchFirstDeviceNotices as jest.Mock).mockResolvedValue([]);
    (ensureKeysForOpenFamily as jest.Mock).mockResolvedValue('ready');
    (rotateFamilyKeyIfNeeded as jest.Mock).mockResolvedValue('idle');
    (approveFirstDevice as jest.Mock).mockClear();
    (declineFirstDevice as jest.Mock).mockClear();
    (approveOwnExtraDevice as jest.Mock).mockClear();
    (rejectOwnExtraDevice as jest.Mock).mockClear();
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

  it('shows the family key is up to date after a lost rotation race', async () => {
    (rotateFamilyKeyIfNeeded as jest.Mock).mockResolvedValue('alreadyCurrent');
    const { findByText, queryByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.rotationUpToDate)).toBeTruthy();
    expect(queryByText(copy.home.rotationFailed)).toBeNull();
  });

  it('shows the family key is up to date after a completed rotation', async () => {
    (rotateFamilyKeyIfNeeded as jest.Mock).mockImplementation(
      async (_input: unknown, _gateway: unknown, onWorking?: () => void) => {
        onWorking?.();
        return 'rotated';
      },
    );
    const { findByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.rotationUpToDate)).toBeTruthy();
  });

  it('marks the family Home with a stable testID', async () => {
    const { findByTestId } = await renderScreen(<HomeScreen />);
    expect(await findByTestId('home')).toBeTruthy();
  });

  it('shows a quiet family-keys status on Home', async () => {
    const { findByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.keysReady)).toBeTruthy();
  });

  it('shows a calm recovery card on Home that does not block the family', async () => {
    const { findByText, queryByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.recoveryNotSetup)).toBeTruthy();
    expect(await findByText(copy.home.recoveryCardTitle)).toBeTruthy();
    expect(queryByText(copy.home.invite)).toBeNull();
  });

  it('greets the family by name, not the person, and offers recent memories', async () => {
    const { findByText, findByTestId, queryByText } = await renderScreen(<HomeScreen />);
    expect(await findByTestId('home-family-name')).toBeTruthy();
    expect(await findByText('The Riveras')).toBeTruthy();
    expect(await findByText(copy.home.recentMemories)).toBeTruthy();
    expect(await findByText(copy.memories.addPhotos)).toBeTruthy();
    expect(await findByText(copy.home.vaultComing)).toBeTruthy();
    expect(queryByText(/Hello,/)).toBeNull();
  });

  it('says this phone needs to be let in again when the family key cannot be obtained', async () => {
    (ensureKeysForOpenFamily as jest.Mock).mockResolvedValue('needsRelink');
    const { findByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.keysNeedRelink)).toBeTruthy();
    expect(await findByText(copy.home.lostPhone)).toBeTruthy();
  });

  it('refetches first-device notices on pull to refresh', async () => {
    const { getByTestId, findByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.keysReady)).toBeTruthy();
    const callsBefore = (fetchFirstDeviceNotices as jest.Mock).mock.calls.length;
    await fireEvent(hostByType(getByTestId('home'), 'RCTRefreshControl'), 'refresh');
    await waitFor(() => {
      expect((fetchFirstDeviceNotices as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('lets an admin wrap or decline a first device from Home', async () => {
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
    const { findByText, findByTestId, getByText } = await renderScreen(<HomeScreen />);

    expect(await findByText(`${copy.member.fallbackName} wants this phone let in`)).toBeTruthy();
    expect((await findByTestId('let-in-notice')).props.testID).toBe('let-in-notice');
    await fireEvent.press(getByText(copy.home.letIn));
    await waitFor(() => {
      expect(approveFirstDevice).toHaveBeenCalled();
    });
  });

  it('lets a member approve their own extra phone and hides Let in for admins', async () => {
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
    const { findByText, queryByText } = await renderScreen(<HomeScreen />);
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
    const { findByText, queryByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(`${copy.member.fallbackName} added a new phone`)).toBeTruthy();
    expect(queryByText(copy.home.letIn)).toBeNull();
    expect(queryByText(copy.home.yesMyPhone)).toBeNull();
  });

  it('waits for one of your phones when this is an extra device', async () => {
    (ensureKeysForOpenFamily as jest.Mock).mockResolvedValue('waitingOwnPhone');
    const { findByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.keysWaitingOwnPhone)).toBeTruthy();
  });

  it('offers a printed-code step from Home after two contacts accept', async () => {
    (loadRecoverySnapshot as jest.Mock).mockResolvedValue({
      contacts: [],
      ownContacts: [],
      accepted: 2,
      pending: [],
      hasPaper: false,
      hasRecoveryPublic: true,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
      status: 'setup',
    });
    const { findByTestId } = await renderScreen(<HomeScreen />);
    await fireEvent.press(await findByTestId('create-printed-code'));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/printed-code');
  });

  it('refetches memberships when family members fail to load', async () => {
    (fetchMembers as jest.Mock).mockRejectedValue(new Error('rls'));
    const view = await renderScreen(<HomeScreen />);
    expect(await view.findByText(copy.common.error)).toBeTruthy();
    const membershipsBefore = (fetchMemberships as jest.Mock).mock.calls.length;
    await fireEvent.press(view.getByText(copy.home.rotationRetry));
    await waitFor(() => {
      expect((fetchMemberships as jest.Mock).mock.calls.length).toBeGreaterThan(membershipsBefore);
    });
  });

  it('drops the family from Home when memberships become empty', async () => {
    (fetchMemberships as jest.Mock).mockResolvedValue([]);
    const { findByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.noFamilyTitle)).toBeTruthy();
  });

});
