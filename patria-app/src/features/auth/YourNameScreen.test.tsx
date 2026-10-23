import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { ownDisplayNameQueryKey } from '../../lib/ownDisplayName';
import { queryClient } from '../../lib/queryClient';
import { supabase } from '../../lib/supabase';
import { renderScreen } from '../../test/renderScreen';
import { YourNameScreen } from './YourNameScreen';

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/queryClient', () => ({
  queryClient: {
    setQueryData: jest.fn(),
    invalidateQueries: jest.fn(),
  },
}));

jest.mock('../../lib/supabase', () => {
  const eq = jest.fn(async () => ({ error: null }));
  const update = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ update }));
  return { supabase: { from, eq, update } };
});

type MockedProfiles = {
  from: jest.Mock;
  eq: jest.Mock;
  update: jest.Mock;
};

const mockedProfiles = supabase as unknown as MockedProfiles;

function mockedReplace(): jest.Mock {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { replace: jest.Mock };
  };
  return expoRouter.useRouter().replace;
}

describe('YourNameScreen', () => {
  beforeEach(() => {
    mockedReplace().mockClear();
    mockedProfiles.from.mockClear();
    mockedProfiles.update.mockClear();
    mockedProfiles.eq.mockClear();
  });

  it('saves a name with existing copy then returns to the gate', async () => {
    const { getByLabelText, getByText } = await renderScreen(<YourNameScreen />);

    await fireEvent.changeText(getByLabelText(copy.auth.nameLabel), 'Elena Rivera');
    await fireEvent.press(getByText(copy.common.save));

    await waitFor(() => {
      expect(mockedProfiles.from).toHaveBeenCalledWith('profiles');
    });
    expect(mockedProfiles.update).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'Elena Rivera' }),
    );
    expect(mockedProfiles.eq).toHaveBeenCalledWith('id', 'u1');
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ownDisplayNameQueryKey('u1'),
      'Elena Rivera',
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ownDisplayNameQueryKey('u1'),
    });
    await waitFor(() => {
      expect(mockedReplace()).toHaveBeenCalledWith('/');
    });
  });
});
