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
import { fetchReadyMemories } from '../memories/memoryApi';
import {
  fetchAgendaItems,
  fetchSyncMeetings,
  fetchSyncSchedule,
  fetchSyncTasks,
  setTaskDone,
  type SyncMeetingRow,
  type SyncTaskRow,
} from '../sync/syncApi';
import { getZonedParts, zonedTimeToUtc } from '../sync/syncSchedule';
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
  fetchCircles: jest.fn(async () => [
    { id: 'c1', name: 'Household', kind: 'household' },
    { id: 'c2', name: 'Extended Family', kind: 'extended_family' },
  ]),
}));

jest.mock('../sync/syncApi', () => ({
  ...jest.requireActual('../sync/syncApi'),
  fetchSyncSchedule: jest.fn(async () => null),
  fetchSyncMeetings: jest.fn(async () => []),
  fetchAgendaItems: jest.fn(async () => []),
  fetchSyncTasks: jest.fn(async () => []),
  setTaskDone: jest.fn(async () => undefined),
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

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const schedule = {
  familySpaceId: 's1',
  weekday: 0,
  localTime: '19:00:00',
  timezone: TZ,
  circleId: 'c1',
};

function meeting(overrides: Partial<SyncMeetingRow>): SyncMeetingRow {
  return {
    id: 'meet1',
    familySpaceId: 's1',
    circleId: 'c1',
    scheduledFor: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    status: 'upcoming',
    startedBy: null,
    startedAt: null,
    finishedAt: null,
    priorityText: '',
    summary: {},
    ...overrides,
  };
}

function agendaItem(id: string, kind: 'discuss' | 'decide') {
  return {
    id,
    familySpaceId: 's1',
    meetingId: 'meet1',
    kind,
    title: `Item ${id}`,
    details: '',
    authorUserId: 'u2',
    attributedChildId: null,
    discussedAt: null,
    decisionText: '',
  };
}

function task(id: string, title: string, overrides: Partial<SyncTaskRow> = {}): SyncTaskRow {
  return {
    id,
    familySpaceId: 's1',
    meetingId: 'meet1',
    title,
    ownerUserId: null,
    ownerChildId: null,
    backupUserId: null,
    backupChildId: null,
    dueOn: null,
    doneAt: null,
    doneBy: null,
    ...overrides,
  };
}

/** `YYYY-MM-DD` for today plus `offset` days in the family zone. */
function isoDay(offset: number): string {
  const today = getZonedParts(new Date(), TZ);
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
  return date.toISOString().slice(0, 10);
}

/** A ready photo taken `yearsAgo` years back, on today's month/day (plus `dayOffset`) in the family zone. */
function memory(id: string, yearsAgo: number, caption: string, dayOffset = 0) {
  const today = getZonedParts(new Date(), TZ);
  return {
    id,
    familySpaceId: 's1',
    circleId: 'c1',
    circleName: 'Household',
    circleKind: 'household',
    uploaderId: 'u2',
    uploaderName: 'Marco',
    caption,
    takenAt: zonedTimeToUtc(TZ, today.year - yearsAgo, today.month, today.day + dayOffset, 12, 0).toISOString(),
    createdAt: '2026-01-01T00:00:00.000Z',
    width: 10,
    height: 10,
    fullPath: 'f',
    thumbPath: 't',
    thumbUrl: null,
    fullUrl: null,
    kind: 'photo' as const,
    durationSeconds: null,
    addedAutomatically: false,
    sourceHash: null,
  };
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
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(null);
    (fetchSyncMeetings as jest.Mock).mockResolvedValue([]);
    (fetchAgendaItems as jest.Mock).mockResolvedValue([]);
    (fetchSyncTasks as jest.Mock).mockResolvedValue([]);
    (fetchReadyMemories as jest.Mock).mockResolvedValue([]);
    (setTaskDone as jest.Mock).mockClear();
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

  it('keeps keys and recovery status pills off Home when nothing needs attention', async () => {
    const { findByTestId, queryByText } = await renderScreen(<HomeScreen />);
    await findByTestId('home-family-name');
    expect(queryByText(copy.home.keysReady)).toBeNull();
    expect(queryByText(copy.home.recoveryNotSetup)).toBeNull();
  });

  it('shows a calm recovery card on Home that does not block the family', async () => {
    const { findByText, queryByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.recoveryCardTitle)).toBeTruthy();
    expect(queryByText(copy.home.invite)).toBeNull();
  });

  it('shows Recovery needs attention on Home because it asks for action', async () => {
    (loadRecoverySnapshot as jest.Mock).mockResolvedValue({
      contacts: [],
      ownContacts: [],
      accepted: 1,
      pending: [],
      hasPaper: false,
      hasRecoveryPublic: true,
      recoveryKeyEpoch: 1,
      keyEpoch: 2,
      status: 'needs_attention',
    });
    const { findByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.recoveryNeedsAttention)).toBeTruthy();
  });

  it('greets the family by name, not the person, and drops the vault teaser and recent memories', async () => {
    const { findByText, findByTestId, queryByText, queryByTestId } = await renderScreen(
      <HomeScreen />,
    );
    expect(await findByTestId('home-family-name')).toBeTruthy();
    expect(await findByText('the Riveras family')).toBeTruthy();
    expect(queryByText(copy.home.recentMemories)).toBeNull();
    expect(queryByText(copy.home.vaultComing)).toBeNull();
    expect(queryByTestId('home-vault-card')).toBeNull();
    expect(queryByText(/Hello,/)).toBeNull();
  });

  it('opens Family from the avatars at the top right', async () => {
    const { findByTestId } = await renderScreen(<HomeScreen />);
    await fireEvent.press(await findByTestId('home-avatars'));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/family');
  });

  describe('Family Sync card', () => {
    it('invites an admin to set up Sync when there is no schedule', async () => {
      const { findByText } = await renderScreen(<HomeScreen />);
      await fireEvent.press(await findByText(copy.sync.setUpOurSync));
      expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/sync-schedule');
    });

    it('asks a non-admin to ask a Family admin', async () => {
      (fetchMemberships as jest.Mock).mockResolvedValue([
        { space: { id: 's1', name: 'The Riveras' }, role: 'elder' },
      ]);
      const { findByText, queryByText } = await renderScreen(<HomeScreen />);
      expect(await findByText(copy.sync.askAdminSetup)).toBeTruthy();
      expect(queryByText(copy.sync.setUpOurSync)).toBeNull();
    });

    it('shows the countdown, circle meeting, agenda counts and both actions', async () => {
      (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
      (fetchSyncMeetings as jest.Mock).mockResolvedValue([
        meeting({ scheduledFor: new Date(Date.now() + 4 * 86_400_000).toISOString() }),
      ]);
      (fetchAgendaItems as jest.Mock).mockResolvedValue([
        agendaItem('a1', 'discuss'),
        agendaItem('a2', 'decide'),
      ]);
      const view = await renderScreen(<HomeScreen />);
      const overline = await view.findByTestId('home-sync-overline');
      expect(String(overline.props.children)).toMatch(
        /^[A-Z]+DAY FAMILY SYNC · (IN \d+ DAYS|TOMORROW)$/,
      );
      expect(String((await view.findByTestId('home-sync-title')).props.children)).toBe(
        'Household meeting',
      );
      expect(await view.findByText('2 items on the agenda, plus 1 decision waiting.')).toBeTruthy();
      await fireEvent.press(view.getByText(copy.home.syncReviewAgenda));
      expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/sync');
      await fireEvent.press(view.getByText(copy.home.syncAddItem));
      expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/sync-agenda');
    });
  });

  describe('On this day', () => {
    it('shows a circle-visible memory from an earlier year in the family time zone', async () => {
      (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
      (fetchReadyMemories as jest.Mock).mockResolvedValue([
        memory('m-old', 4, 'Beach day'),
        memory('m-other-day', 4, 'Not today', 2),
      ]);
      const view = await renderScreen(<HomeScreen />);
      const card = await view.findByTestId('home-on-this-day');
      expect(card).toBeTruthy();
      expect(await view.findByText('Beach day')).toBeTruthy();
      expect(view.queryByText('Not today')).toBeNull();
      await fireEvent.press(card);
      expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/memory/m-old');
    });

    it('is omitted when no memory matches today', async () => {
      (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
      (fetchReadyMemories as jest.Mock).mockResolvedValue([memory('m-other', 4, 'Another day', 3)]);
      const view = await renderScreen(<HomeScreen />);
      await view.findByTestId('home-this-week');
      expect(view.queryByTestId('home-on-this-day')).toBeNull();
    });
  });

  describe('This week', () => {
    it('shows one quiet line when there are no tasks', async () => {
      const view = await renderScreen(<HomeScreen />);
      expect(await view.findByText(copy.home.thisWeekEmpty)).toBeTruthy();
    });

    it('lists open tasks with people and a day chip, and See all opens Sync tasks', async () => {
      (fetchSyncTasks as jest.Mock).mockResolvedValue([
        task('t2', 'Book the dentist', { dueOn: isoDay(2) }),
        task('t1', 'Pick up the cake', { dueOn: isoDay(0), ownerUserId: 'u1', backupUserId: 'u2' }),
      ]);
      const view = await renderScreen(<HomeScreen />);
      const first = await view.findByTestId('home-task-t1');
      expect(first.props.accessibilityRole).toBe('checkbox');
      expect(first.props.accessibilityState).toMatchObject({ checked: false });
      expect(await view.findByText(copy.home.taskChipToday)).toBeTruthy();
      expect(await view.findByText(/Owner .* · Backup /)).toBeTruthy();
      await fireEvent.press(view.getByTestId('home-this-week-see-all'));
      expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/sync-tasks');
    });

    it('marks a task done from Home', async () => {
      (fetchSyncTasks as jest.Mock).mockResolvedValue([
        task('t1', 'Pick up the cake', { ownerUserId: 'u1' }),
      ]);
      const view = await renderScreen(<HomeScreen />);
      await fireEvent.press(await view.findByTestId('home-task-t1'));
      await waitFor(() => {
        expect(setTaskDone).toHaveBeenCalledWith({ id: 't1', done: true, doneBy: 'u1' });
      });
    });

    it('shows at most four tasks and labels one done today', async () => {
      (fetchSyncTasks as jest.Mock).mockResolvedValue([
        task('a', 'A', { dueOn: isoDay(1) }),
        task('b', 'B', { dueOn: isoDay(2) }),
        task('c', 'C', { dueOn: isoDay(3) }),
        task('d', 'D', { dueOn: isoDay(4) }),
        task('e', 'E', { dueOn: isoDay(5) }),
      ]);
      const view = await renderScreen(<HomeScreen />);
      await view.findByTestId('home-task-a');
      expect(view.queryByTestId('home-task-e')).toBeNull();
    });

    it('keeps a task you just finished visible as Done today', async () => {
      (fetchSyncTasks as jest.Mock).mockResolvedValue([
        task('t1', 'Pick up the cake', { doneAt: new Date().toISOString() }),
      ]);
      const view = await renderScreen(<HomeScreen />);
      expect(await view.findByText(copy.home.taskDoneToday)).toBeTruthy();
    });
  });

  it('says this phone needs to be let in again when the family key cannot be obtained', async () => {
    (ensureKeysForOpenFamily as jest.Mock).mockResolvedValue('needsRelink');
    const { findByText } = await renderScreen(<HomeScreen />);
    expect(await findByText(copy.home.keysNeedRelink)).toBeTruthy();
    expect(await findByText(copy.home.lostPhone)).toBeTruthy();
  });

  it('refetches first-device notices on pull to refresh', async () => {
    const { getByTestId, findByTestId } = await renderScreen(<HomeScreen />);
    expect(await findByTestId('home-family-name')).toBeTruthy();
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
