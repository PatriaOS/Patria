import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { routes } from '../../lib/navigation';
import { supabase } from '../../lib/supabase';
import { renderScreen } from '../../test/renderScreen';
import { AddChildScreen } from './AddChildScreen';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
}));

function mockedReplace(): jest.Mock {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { replace: jest.Mock };
  };
  return expoRouter.useRouter().replace;
}

describe('add child', () => {
  it('does not ask for email or a password', () => {
    expect(copy.child.noEmail.length).toBeGreaterThan(0);
    expect(JSON.stringify(copy.child)).not.toMatch(/password/i);
    expect(copy.child.body).toMatch(/No email/i);
  });

  it('adds a child on the first tap after the name is filled', async () => {
    mockedReplace().mockClear();
    (supabase.from as jest.Mock).mockReturnValue({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'c1' }, error: null }),
        }),
      }),
    });
    const { findByLabelText, getByText } = await renderScreen(<AddChildScreen />);
    await waitFor(() => {
      expect(readCurrentFamilyId).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await fireEvent.changeText(await findByLabelText(copy.child.nameLabel), 'Amina');
    await fireEvent.press(getByText(copy.child.submit));
    await waitFor(() => {
      expect(mockedReplace()).toHaveBeenCalledWith(routes.family);
    });
  });
});
