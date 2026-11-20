import { fireEvent, waitFor } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';

import { copy } from '../../lib/copy';
import { fetchInviteCircles, fetchInviteShareToken, fetchPendingInvites } from '../../lib/family';
import { inviteUrlFromToken } from '../../lib/inviteUrl';
import { renderScreen } from '../../test/renderScreen';
import { InviteScreen } from './InviteScreen';

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({
    session: { user: { id: 'admin-1', user_metadata: { display_name: 'Elena' } } },
    loading: false,
  }),
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 'space-1'),
}));

jest.mock('../../lib/family', () => ({
  fetchInviteCircles: jest.fn(),
  fetchPendingInvites: jest.fn(),
  fetchInviteShareToken: jest.fn(),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(async () => ({ data: { id: 'new-inv' }, error: null })),
        })),
      })),
      update: jest.fn(() => ({
        eq: jest.fn(async () => ({ error: null })),
      })),
    })),
  },
}));

describe('InviteScreen', () => {
  beforeEach(() => {
    (fetchInviteCircles as jest.Mock).mockResolvedValue([
      { id: 'circ-h', name: 'Household', kind: 'household' },
    ]);
    (fetchPendingInvites as jest.Mock).mockResolvedValue([
      {
        id: 'pend-1',
        email: 'guest@example.com',
        role: 'elder',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);
    (fetchInviteShareToken as jest.Mock).mockResolvedValue('share-tok');
    jest.spyOn(Share, 'share').mockResolvedValue({
      action: Share.sharedAction,
      activityType: undefined,
    });
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as unknown as void);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shares again from a Waiting to join card', async () => {
    const { getByText } = await renderScreen(<InviteScreen />);
    await waitFor(() => {
      expect(getByText(copy.invite.pendingTitle)).toBeTruthy();
      expect(getByText('guest@example.com')).toBeTruthy();
    });

    fireEvent.press(getByText(copy.invite.shareAgain));
    await waitFor(() => {
      expect(fetchInviteShareToken).toHaveBeenCalledWith('pend-1');
      expect(Share.share).toHaveBeenCalledWith({
        message: inviteUrlFromToken('share-tok'),
      });
    });
  });

  it('opens Mail again from a Waiting to join card', async () => {
    const { getByText } = await renderScreen(<InviteScreen />);
    await waitFor(() => {
      expect(getByText(copy.invite.sendEmailAgain)).toBeTruthy();
    });

    fireEvent.press(getByText(copy.invite.sendEmailAgain));
    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalled();
      const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
      expect(url.startsWith('mailto:guest@example.com')).toBe(true);
      expect(url).toContain(encodeURIComponent(inviteUrlFromToken('share-tok')));
    });
  });
});
