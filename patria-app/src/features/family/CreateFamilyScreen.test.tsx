import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { supabase } from '../../lib/supabase';
import { renderScreen } from '../../test/renderScreen';
import { CreateFamilyScreen } from './CreateFamilyScreen';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { signOut: jest.fn(async () => ({ error: null })) },
  },
}));

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/crypto/familyCeremony', () => ({
  ensureKeysForOpenFamily: jest.fn(async () => 'ready'),
}));

function mockedRouter(): { push: jest.Mock; replace: jest.Mock } {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { push: jest.Mock; replace: jest.Mock };
  };
  return expoRouter.useRouter();
}

describe('CreateFamilyScreen', () => {
  beforeEach(() => {
    mockedRouter().push.mockClear();
    mockedRouter().replace.mockClear();
    (supabase.auth.signOut as jest.Mock).mockClear();
    (ensureKeysForOpenFamily as jest.Mock).mockClear();
  });

  it('opens a pasted invite on the accept screen instead of creating a family', async () => {
    const { getByLabelText, getByText, getByTestId } = await renderScreen(<CreateFamilyScreen />);

    expect(getByTestId('screen-create-family')).toBeTruthy();
    expect(getByText(copy.invite.pastePrompt)).toBeTruthy();
    await fireEvent.changeText(
      getByLabelText(copy.invite.pasteLabel),
      'patria://invite/abc123def456',
    );
    await fireEvent.press(getByText(copy.invite.openLink));

    expect(mockedRouter().push).toHaveBeenCalledWith('/invite/abc123def456');
  });

  it('shows a friendly error when the pasted invite link is not valid', async () => {
    const { getByLabelText, getByText } = await renderScreen(<CreateFamilyScreen />);

    await fireEvent.changeText(getByLabelText(copy.invite.pasteLabel), 'not-an-invite');
    await fireEvent.press(getByText(copy.invite.openLink));

    expect(getByText(copy.invite.pasteInvalid)).toBeTruthy();
    expect(mockedRouter().push).not.toHaveBeenCalled();
  });

  it('signs out with a spinner then replaces to welcome', async () => {
    const { getByText } = await renderScreen(<CreateFamilyScreen />);

    await fireEvent.press(getByText(copy.auth.signOut));

    await waitFor(() => {
      expect(supabase.auth.signOut).toHaveBeenCalled();
    });
    expect(mockedRouter().replace).toHaveBeenCalledWith('/(signed-out)/welcome');
  });

  it('runs the founding key ceremony after the family space is created', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 's1', error: null });
    const { getByLabelText, getByText } = await renderScreen(<CreateFamilyScreen />);

    await fireEvent.changeText(getByLabelText(copy.createFamily.spaceNameLabel), 'The Riveras');
    await fireEvent.press(getByText(copy.createFamily.submit));

    await waitFor(() => {
      expect(ensureKeysForOpenFamily).toHaveBeenCalledWith({
        spaceId: 's1',
        userId: 'u1',
        role: 'family_admin',
      });
    });
    expect(mockedRouter().replace).toHaveBeenCalledWith('/(signed-in)/ready');
  });
});
