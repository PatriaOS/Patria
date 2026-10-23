import { fireEvent, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { copy } from '../../lib/copy';
import { resolveEntryHref } from '../../lib/sessionGate';
import { supabase } from '../../lib/supabase';
import { renderScreen } from '../../test/renderScreen';
import { InvitePreviewScreen } from './InvitePreviewScreen';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: null, loading: false }),
}));

function mockedReplace(): jest.Mock {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { replace: jest.Mock };
  };
  return expoRouter.useRouter().replace;
}

describe('InvitePreviewScreen invalid invite', () => {
  beforeEach(() => {
    mockedReplace().mockClear();
    (SecureStore.deleteItemAsync as jest.Mock).mockClear();
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });
  });

  it('clears the pending token as soon as the preview is invalid', async () => {
    await renderScreen(<InvitePreviewScreen token="deadbeef" />);

    await waitFor(() => {
      expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
    });
  });

  it('Continue replaces to the gate, which sends signed-out users to welcome', async () => {
    const { getByText } = await renderScreen(<InvitePreviewScreen token="deadbeef" />);

    await waitFor(() => {
      expect(getByText(copy.invitePreview.invalid)).toBeTruthy();
    });
    expect(getByText(copy.invitePreview.invalid).props.testID).toBe('invite-no-longer-valid');
    await fireEvent.press(getByText(copy.common.continue));

    await waitFor(() => {
      expect(mockedReplace()).toHaveBeenCalledWith('/');
    });
    expect(
      resolveEntryHref({
        hasSession: false,
        membershipCount: 0,
        pendingInviteToken: null,
      }),
    ).toBe('/(signed-out)/welcome');
  });

  it('Continue then the gate sends signed-in users to create family or home, never back to the invite', async () => {
    const { getByText } = await renderScreen(<InvitePreviewScreen token="deadbeef" />);

    await waitFor(() => {
      expect(getByText(copy.common.continue)).toBeTruthy();
    });
    await fireEvent.press(getByText(copy.common.continue));

    await waitFor(() => {
      expect(mockedReplace()).toHaveBeenCalledWith('/');
    });
    expect(
      resolveEntryHref({
        hasSession: true,
        membershipCount: 0,
        pendingInviteToken: null,
      }),
    ).toBe('/(signed-in)/create');
    expect(
      resolveEntryHref({
        hasSession: true,
        membershipCount: 1,
        pendingInviteToken: null,
      }),
    ).toBe('/(signed-in)/home');
    expect(
      resolveEntryHref({
        hasSession: true,
        membershipCount: 0,
        pendingInviteToken: null,
      }),
    ).not.toMatch(/^\/invite\//);
  });
});
