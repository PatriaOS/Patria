import {
  syncAgendaKey,
  syncAnswersKey,
  syncMeetingsKey,
  syncScheduleKey,
  syncTasksKey,
} from './syncQueryKeys';

describe('sync query keys (refresh loop guard)', () => {
  it('stay stable across repeated calls with the same ids', () => {
    const first = {
      schedule: syncScheduleKey('space-1'),
      meetings: syncMeetingsKey('space-1'),
      answers: syncAnswersKey('meeting-1'),
      agenda: syncAgendaKey('meeting-1'),
      tasks: syncTasksKey('space-1'),
    };
    const second = {
      schedule: syncScheduleKey('space-1'),
      meetings: syncMeetingsKey('space-1'),
      answers: syncAnswersKey('meeting-1'),
      agenda: syncAgendaKey('meeting-1'),
      tasks: syncTasksKey('space-1'),
    };
    expect(second).toEqual(first);
  });

  it('never embeds a ticking clock in the key', () => {
    const serialized = JSON.stringify([
      syncScheduleKey('s'),
      syncMeetingsKey('s'),
      syncAnswersKey('m'),
      syncAgendaKey('m'),
      syncTasksKey('s'),
    ]);
    expect(serialized).not.toMatch(/\d{10,}/);
    expect(serialized).not.toContain('Date');
  });
});
