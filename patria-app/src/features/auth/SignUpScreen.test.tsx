import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { routes } from '../../lib/navigation';
import { supabase } from '../../lib/supabase';
import { renderScreen } from '../../test/renderScreen';
import { SignUpScreen } from './SignUpScreen';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: jest.fn(),
    },
  },
}));

function mockedReplace(): jest.Mock {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { replace: jest.Mock };
  };
  return expoRouter.useRouter().replace;
}

describe('SignUpScreen', () => {
  beforeEach(() => {
    mockedReplace().mockClear();
    (supabase.auth.signUp as jest.Mock).mockReset();
    (supabase.auth.signUp as jest.Mock).mockResolvedValue({
      data: { session: { access_token: 't' } },
      error: null,
    });
  });

  it('marks the screen, keeps AutoFill, and submits from the password Go key', async () => {
    const { getByTestId, getByLabelText } = await renderScreen(<SignUpScreen />);

    expect(getByTestId('screen-sign-up')).toBeTruthy();
    expect(getByTestId('screen-keyboard')).toBeTruthy();

    const password = getByLabelText(copy.auth.passwordLabel);
    expect(password.props.returnKeyType).toBe('go');
    expect(password.props.textContentType).toBe('newPassword');
    expect(password.props.autoComplete).toBe('new-password');
    expect(password.props.secureTextEntry).toBe(true);

    await fireEvent.changeText(getByLabelText(copy.auth.nameLabel), 'Test 1');
    await fireEvent.changeText(getByLabelText(copy.auth.emailLabel), 'test1@example.com');
    await fireEvent.changeText(password, 'secret-password');
    await fireEvent(password, 'submitEditing');

    await waitFor(() => {
      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: 'test1@example.com',
        password: 'secret-password',
        options: { data: { display_name: 'Test 1' } },
      });
    });
    await waitFor(() => {
      expect(mockedReplace()).toHaveBeenCalledWith(routes.gate);
    });
  });

  it('submits from the first tap after the fields are filled', async () => {
    const { getByLabelText, getByText } = await renderScreen(<SignUpScreen />);
    await fireEvent.changeText(getByLabelText(copy.auth.nameLabel), 'Test 1');
    await fireEvent.changeText(getByLabelText(copy.auth.emailLabel), 'test1@example.com');
    await fireEvent.changeText(getByLabelText(copy.auth.passwordLabel), 'secret-password');
    await fireEvent.press(getByText(copy.auth.signUpSubmit));
    await waitFor(() => {
      expect(supabase.auth.signUp).toHaveBeenCalledTimes(1);
    });
  });
});
