import { agendaBodyLine, type SyncAgendaItemRow } from './syncApi';

function item(kind: SyncAgendaItemRow['kind'], id: string): SyncAgendaItemRow {
  return {
    id,
    familySpaceId: 's1',
    meetingId: 'm1',
    kind,
    title: id,
    details: '',
    authorUserId: 'u1',
    attributedChildId: null,
    discussedAt: null,
    decisionText: '',
  };
}

describe('agendaBodyLine', () => {
  it('counts every item and names decisions in a sentence', () => {
    expect(agendaBodyLine([])).toBe('No items on the agenda yet.');
    expect(agendaBodyLine([item('discuss', 'a')])).toBe('1 item on the agenda.');
    expect(agendaBodyLine([item('discuss', 'a'), item('win', 'b'), item('plan', 'c')])).toBe(
      '3 items on the agenda.',
    );
    expect(
      agendaBodyLine([
        item('discuss', 'a'),
        item('win', 'b'),
        item('decide', 'c'),
        item('plan', 'd'),
      ]),
    ).toBe('4 items on the agenda, plus 1 decision waiting.');
    expect(agendaBodyLine([item('decide', 'a'), item('decide', 'b')])).toBe(
      '2 items on the agenda, plus 2 decisions waiting.',
    );
  });
});
