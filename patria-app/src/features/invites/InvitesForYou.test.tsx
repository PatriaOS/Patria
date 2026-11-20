import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { InvitesForYou } from './InvitesForYou';
import { declineInviteForMe, inviteTokenForMe, listInvitesForMe } from './invitesForMeApi';

jest.mock('./invitesForMeApi', () => ({
  listInvitesForMe: jest.fn(),
  inviteTokenForMe: jest.fn(),
  declineInviteForMe: jest.fn(),
}));

function mockedRouter(): { push: jest.Mock } {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { push: jest.Mock };
  };
  return expoRouter.useRouter();
}

describe('InvitesForYou', () => {
  beforeEach(() => {
    mockedRouter().push.mockClear();
    (listInvitesForMe as jest.Mock).mockReset();
    (inviteTokenForMe as jest.Mock).mockReset();
    (declineInviteForMe as jest.Mock).mockReset();
  });

  it('hides when empty on Create family', async () => {
    (listInvitesForMe as jest.Mock).mockResolvedValue([]);
    const { queryByText } = await renderScreen(<InvitesForYou hideWhenEmpty />);
    await waitFor(() => {
      expect(listInvitesForMe).toHaveBeenCalled();
    });
    expect(queryByText(copy.invite.forYouTitle)).toBeNull();
  });

  it('opens the accept screen with a token', async () => {
    (listInvitesForMe as jest.Mock).mockResolvedValue([
      {
        id: 'inv-1',
        familySpaceName: 'The Paul family',
        inviterDisplayName: 'Elena',
        role: 'elder',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);
    (inviteTokenForMe as jest.Mock).mockResolvedValue('tok-abc');

    const { getByText } = await renderScreen(<InvitesForYou hideWhenEmpty />);
    await waitFor(() => {
      expect(getByText(copy.invite.forYouTitle)).toBeTruthy();
    });
    expect(getByText('The Paul family')).toBeTruthy();

    fireEvent.press(getByText(copy.invitePreview.accept));
    await waitFor(() => {
      expect(inviteTokenForMe).toHaveBeenCalledWith('inv-1');
      expect(mockedRouter().push).toHaveBeenCalledWith('/invite/tok-abc');
    });
  });

  it('declines without exposing a token', async () => {
    (listInvitesForMe as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 'inv-2',
          familySpaceName: 'The Femi Family',
          inviterDisplayName: 'Femi',
          role: 'teen',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ])
      .mockResolvedValueOnce([]);
    (declineInviteForMe as jest.Mock).mockResolvedValue(undefined);

    const { getByText, queryByText } = await renderScreen(<InvitesForYou />);
    await waitFor(() => {
      expect(getByText('The Femi Family')).toBeTruthy();
    });
    fireEvent.press(getByText(copy.invitePreview.decline));
    await waitFor(() => {
      expect(declineInviteForMe).toHaveBeenCalledWith('inv-2');
      expect(queryByText('The Femi Family')).toBeNull();
    });
  });
});
