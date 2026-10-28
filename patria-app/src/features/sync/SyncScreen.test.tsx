import { act, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { SyncScreen } from './SyncScreen';
import {
  ensureNextMeeting,
  fetchAgendaItems,
  fetchSyncMeetingAnswers,
  fetchSyncMeetings,
  fetchSyncSchedule,
  type SyncMeetingRow,
} from './syncApi';
import { syncAnswersKey } from './syncQueryKeys';

jest.mock('../family/useCurrentFamily', () => ({
  useCurrentFamily: jest.fn(),
}));

jest.mock('../../lib/supabase', () => ({ supabase: {} }));

jest.mock('../../lib/family', () => ({
  fetchCircles: jest.fn(async () => [
    { id: 'c1', name: 'Household', kind: 'household' },
    { id: 'c2', name: 'Extended Family', kind: 'extended_family' },
  ]),
  fetchMembers: jest.fn(async () => [
    { id: 'm1', userId: 'u1', role: 'family_admin', relationshipLabel: null, displayName: 'Elena' },
    { id: 'm2', userId: 'u2', role: 'co_admin', relationshipLabel: null, displayName: 'Marco' },
  ]),
  fetchChildren: jest.fn(async () => []),
}));

jest.mock('../memories/memoryApi', () => ({
  fetchCircleMemberIds: jest.fn(async () => ['u1', 'u2']),
}));

jest.mock('./syncApi', () => ({
  ...jest.requireActual('./syncApi'),
  fetchSyncSchedule: jest.fn(),
  fetchSyncMeetings: jest.fn(),
  fetchAgendaItems: jest.fn(),
  fetchSyncMeetingAnswers: jest.fn(async () => []),
  ensureNextMeeting: jest.fn(async () => 'm-new'),
  startSyncMeeting: jest.fn(),
  upsertSyncSchedule: jest.fn(),
  setSyncMeetingAnswer: jest.fn(),
}));

const admin = {
  userId: 'u1',
  spaceId: 's1',
  current: { role: 'family_admin', space: { id: 's1', name: 'Riveras' } },
  admin: true,
  keyHolder: true,
};

const schedule = {
  familySpaceId: 's1',
  weekday: 0,
  localTime: '19:00:00',
  timezone: 'America/New_York',
  circleId: 'c1',
  frequency: 'weekly' as const,
  monthlyMode: null,
  monthlyOrdinal: null,
  monthDay: null,
  anchorLocalDate: '2026-10-26',
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
    movedIndividually: false,
    ...overrides,
  };
}

const agendaItem = {
  id: 'i1',
  familySpaceId: 's1',
  meetingId: 'meet1',
  kind: 'discuss' as const,
  title: 'Soccer carpool on Thursday',
  details: '',
  authorUserId: 'u2',
  attributedChildId: null,
  discussedAt: null,
  decisionText: '',
};

describe('Sync tab', () => {
  beforeEach(() => {
    (useCurrentFamily as jest.Mock).mockReturnValue(admin);
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(null);
    (fetchSyncMeetings as jest.Mock).mockResolvedValue([]);
    (fetchAgendaItems as jest.Mock).mockResolvedValue([]);
    (fetchSyncMeetingAnswers as jest.Mock).mockResolvedValue([]);
    (ensureNextMeeting as jest.Mock).mockClear();
    (fetchSyncSchedule as jest.Mock).mockClear();
    (fetchSyncMeetings as jest.Mock).mockClear();
    (fetchSyncMeetingAnswers as jest.Mock).mockClear();
  });

  it('invites an admin to set up Sync when there is no schedule', async () => {
    const { findByText, getByTestId } = await renderScreen(<SyncScreen />);
    expect(await findByText(copy.sync.setUpBody)).toBeTruthy();
    expect(getByTestId('set-up-our-sync')).toBeTruthy();
  });

  it('asks other members to ask an admin', async () => {
    (useCurrentFamily as jest.Mock).mockReturnValue({
      ...admin,
      userId: 'u3',
      current: { role: 'elder', space: { id: 's1', name: 'Riveras' } },
      admin: false,
    });
    const { findByText, queryByTestId } = await renderScreen(<SyncScreen />);
    expect(await findByText(copy.sync.askAdminSetup)).toBeTruthy();
    expect(queryByTestId('set-up-our-sync')).toBeNull();
  });

  it('shows the agenda, the flow and a start control for an admin', async () => {
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
    (fetchSyncMeetings as jest.Mock).mockResolvedValue([meeting({})]);
    (fetchAgendaItems as jest.Mock).mockResolvedValue([agendaItem]);
    const { findByText, getByText, getByTestId, queryByTestId } = await renderScreen(<SyncScreen />);
    expect(await findByText('Soccer carpool on Thursday')).toBeTruthy();
    expect(getByText('Added by Marco')).toBeTruthy();
    expect(getByText(copy.sync.kinds.discuss)).toBeTruthy();
    expect(getByTestId('sync-tonight-flow')).toBeTruthy();
    expect(getByTestId('move-this-meeting')).toBeTruthy();
    expect(getByTestId('schedule')).toBeTruthy();
    expect(getByText(/HOUSEHOLD/)).toBeTruthy();
    expect(
      queryByTestId('start-early') ?? queryByTestId('start-the-sync') ?? queryByTestId('continue'),
    ).toBeTruthy();
    expect(getByTestId('add-to-the-agenda')).toBeTruthy();
  });

  it('offers Hold it now, without guilt, when the time has passed', async () => {
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
    (fetchSyncMeetings as jest.Mock).mockResolvedValue([
      meeting({ scheduledFor: new Date(Date.now() - 86_400_000).toISOString() }),
    ]);
    const { findByText, getByTestId, queryByTestId } = await renderScreen(<SyncScreen />);
    expect(await findByText(copy.sync.missedNoGuilt)).toBeTruthy();
    expect(getByTestId('sync-missed')).toBeTruthy();
    expect(getByTestId('hold-it-now')).toBeTruthy();
    expect(queryByTestId('start-early')).toBeNull();
    expect(queryByTestId('start-the-sync')).toBeNull();
    expect(queryByTestId('continue')).toBeNull();
  });

  it('shows who is running the Sync when it is on another phone', async () => {
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
    (fetchSyncMeetings as jest.Mock).mockResolvedValue([
      meeting({ status: 'in_progress', startedBy: 'u2', startedAt: new Date().toISOString() }),
    ]);
    const { findByText, getByTestId, queryByTestId } = await renderScreen(<SyncScreen />);
    expect(await findByText('The Sync is running on Marco’s phone')).toBeTruthy();
    expect(getByTestId('follow-along')).toBeTruthy();
    expect(queryByTestId('start-early')).toBeNull();
    expect(queryByTestId('start-the-sync')).toBeNull();
    expect(queryByTestId('continue')).toBeNull();
  });

  it('makes sure there is a next meeting when a schedule has none', async () => {
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
    await renderScreen(<SyncScreen />);
    await waitFor(() => {
      expect(ensureNextMeeting).toHaveBeenCalledTimes(1);
    });
  });

  it('runs focus refresh once; answer refetches do not re-fire it', async () => {
    // Guards the D37 loop: useFocusEffect must not depend on the answersQuery
    // object. If it does, every answers update recreates the callback, the
    // focus effect re-runs, and refresh() invalidates the schedule again.
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
    (fetchSyncMeetings as jest.Mock).mockResolvedValue([meeting({})]);
    (fetchAgendaItems as jest.Mock).mockResolvedValue([agendaItem]);

    const { queryClient, findByTestId } = await renderScreen(<SyncScreen />);
    await findByTestId('sync-tonight-flow');

    await waitFor(() => {
      expect(fetchSyncMeetingAnswers).toHaveBeenCalled();
      expect(fetchSyncSchedule).toHaveBeenCalled();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    invalidate.mockClear();
    (fetchSyncSchedule as jest.Mock).mockClear();

    const answerRows = [
      [{ meetingId: 'meet1', userId: 'u2', answer: 'going' as const }],
      [{ meetingId: 'meet1', userId: 'u2', answer: 'cant' as const }],
      [
        { meetingId: 'meet1', userId: 'u2', answer: 'cant' as const },
        { meetingId: 'meet1', userId: 'u1', answer: 'going' as const },
      ],
    ];
    for (const rows of answerRows) {
      await act(async () => {
        queryClient.setQueryData(syncAnswersKey('meet1'), rows);
      });
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    const scheduleInvalidations = invalidate.mock.calls.filter((call) => {
      const key = (call[0] as { queryKey?: unknown } | undefined)?.queryKey;
      return Array.isArray(key) && key[0] === 'syncSchedule';
    });
    expect(scheduleInvalidations).toHaveLength(0);
    expect(fetchSyncSchedule).not.toHaveBeenCalled();
  });
});
