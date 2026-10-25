import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { SyncScreen } from './SyncScreen';
import {
  ensureNextMeeting,
  fetchAgendaItems,
  fetchSyncMeetings,
  fetchSyncSchedule,
  type SyncMeetingRow,
} from './syncApi';

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

jest.mock('./syncApi', () => ({
  ...jest.requireActual('./syncApi'),
  fetchSyncSchedule: jest.fn(),
  fetchSyncMeetings: jest.fn(),
  fetchAgendaItems: jest.fn(),
  ensureNextMeeting: jest.fn(async () => 'm-new'),
  startSyncMeeting: jest.fn(),
  upsertSyncSchedule: jest.fn(),
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
    (ensureNextMeeting as jest.Mock).mockClear();
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

  it('shows the agenda, the flow and Continue for an admin', async () => {
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
    (fetchSyncMeetings as jest.Mock).mockResolvedValue([meeting({})]);
    (fetchAgendaItems as jest.Mock).mockResolvedValue([agendaItem]);
    const { findByText, getByText, getByTestId } = await renderScreen(<SyncScreen />);
    expect(await findByText('Soccer carpool on Thursday')).toBeTruthy();
    expect(getByText('Added by Marco')).toBeTruthy();
    expect(getByText(copy.sync.kinds.discuss)).toBeTruthy();
    expect(getByText(copy.sync.tonightFlow)).toBeTruthy();
    expect(getByText(/HOUSEHOLD/)).toBeTruthy();
    expect(getByTestId('continue')).toBeTruthy();
    expect(getByTestId('add-to-agenda')).toBeTruthy();
  });

  it('offers Hold it now, without guilt, when the time has passed', async () => {
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
    (fetchSyncMeetings as jest.Mock).mockResolvedValue([
      meeting({ scheduledFor: new Date(Date.now() - 86_400_000).toISOString() }),
    ]);
    const { findByText, getByTestId, queryByTestId } = await renderScreen(<SyncScreen />);
    expect(await findByText(copy.sync.missedNoGuilt)).toBeTruthy();
    expect(getByTestId('hold-it-now')).toBeTruthy();
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
    expect(queryByTestId('continue')).toBeNull();
  });

  it('makes sure there is a next meeting when a schedule has none', async () => {
    (fetchSyncSchedule as jest.Mock).mockResolvedValue(schedule);
    await renderScreen(<SyncScreen />);
    await jest.requireActual('@testing-library/react-native').waitFor(() => {
      expect(ensureNextMeeting).toHaveBeenCalledTimes(1);
    });
  });
});
