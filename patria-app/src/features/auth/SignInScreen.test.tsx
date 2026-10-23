import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { routes } from '../../lib/navigation';
import { supabase } from '../../lib/supabase';
import { renderScreen } from '../../test/renderScreen';
import { SignInScreen } from './SignInScreen';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
    },
  },
}));

function mockedReplace(): jest.Mock {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { replace: jest.Mock };
  };
  return expoRouter.useRouter().replace;
}

describe('SignInScreen', () => {
  beforeEach(() => {
    mockedReplace().mockClear();
    (supabase.auth.signInWithPassword as jest.Mock).mockReset();
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({ error: null });
  });

  it('marks the screen, keeps AutoFill, and submits from the password Go key', async () => {
    const { getByTestId, getByLabelText } = await renderScreen(<SignInScreen />);

    expect(getByTestId('screen-sign-in')).toBeTruthy();
    expect(getByTestId('screen-keyboard')).toBeTruthy();

    const password = getByLabelText(copy.auth.passwordLabel);
    expect(password.props.returnKeyType).toBe('go');
    expect(password.props.textContentType).toBe('password');
    expect(password.props.autoComplete).toBe('password');
    expect(password.props.secureTextEntry).toBe(true);

    await fireEvent.changeText(getByLabelText(copy.auth.emailLabel), 'test1@example.com');
    await fireEvent.changeText(password, 'secret-password');
    await fireEvent(password, 'submitEditing');

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test1@example.com',
        password: 'secret-password',
      });
    });
    await waitFor(() => {
      expect(mockedReplace()).toHaveBeenCalledWith(routes.gate);
    });
  });

  it('shows a calm error when sign in fails', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
      error: { message: 'invalid' },
    });
    const { getByLabelText, getByText, findByText } = await renderScreen(<SignInScreen />);

    await fireEvent.changeText(getByLabelText(copy.auth.emailLabel), 'test1@example.com');
    await fireEvent.changeText(getByLabelText(copy.auth.passwordLabel), 'secret-password');
    await fireEvent.press(getByText(copy.auth.signInSubmit));

    expect(await findByText(copy.auth.signInFailed)).toBeTruthy();
  });
});
