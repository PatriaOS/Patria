import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { memberDisplayName } from '../../lib/displayName';
import { fetchChildren, fetchMembers, fetchMemberships } from '../../lib/family';
import { supabase } from '../../lib/supabase';
import { renderScreen } from '../../test/renderScreen';
import { FamilyScreen } from './FamilyScreen';

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/family', () => ({
  fetchMemberships: jest.fn(async () => [
    { space: { id: 's1', name: 'The Riveras' }, role: 'family_admin' },
  ]),
  fetchMembers: jest.fn(async () => [
    {
      id: 'm1',
      userId: 'u1',
      role: 'family_admin',
      relationshipLabel: null,
      displayName: 'Family member',
    },
    {
      id: 'm2',
      userId: 'u2',
      role: 'co_admin',
      relationshipLabel: null,
      displayName: 'Family member',
    },
  ]),
  fetchChildren: jest.fn(async () => []),
  fetchPendingInvites: jest.fn(async () => []),
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
  writeCurrentFamilyId: jest.fn(async () => undefined),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { signOut: jest.fn(async () => ({ error: null })) },
  },
}));

function mockedRouter(): { push: jest.Mock; replace: jest.Mock } {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { push: jest.Mock; replace: jest.Mock };
  };
  return expoRouter.useRouter();
}

describe('Family tab', () => {
  beforeEach(() => {
    mockedRouter().push.mockClear();
    mockedRouter().replace.mockClear();
    (supabase.auth.signOut as jest.Mock).mockClear();
    (fetchMemberships as jest.Mock).mockResolvedValue([
      { space: { id: 's1', name: 'The Riveras' }, role: 'family_admin' },
    ]);
    (fetchMembers as jest.Mock).mockResolvedValue([
      {
        id: 'm1',
        userId: 'u1',
        role: 'family_admin',
        relationshipLabel: null,
        displayName: memberDisplayName(''),
      },
      {
        id: 'm2',
        userId: 'u2',
        role: 'co_admin',
        relationshipLabel: null,
        displayName: memberDisplayName(null),
      },
    ]);
    (fetchChildren as jest.Mock).mockResolvedValue([]);
  });

  it('offers invite, add a child, Appearance and sign out', async () => {
    const { findByText, findByTestId } = renderScreen(<FamilyScreen />);
    expect(await findByTestId('screen-family')).toBeTruthy();
    expect(await findByText(copy.home.invite)).toBeTruthy();
    fireEvent.press(await findByText(copy.home.addChild));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/add-child');
    fireEvent.press(await findByText(copy.appearance.title));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/appearance');
  });

  it('offers Create another family next to Join another family', async () => {
    const view = renderScreen(<FamilyScreen />);
    await view.findByLabelText(copy.home.createAnotherFamily);
    fireEvent.press(view.getByLabelText(copy.home.createAnotherFamily));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/create');
  });

  it('uses a Join another family link instead of a paste box', async () => {
    const view = renderScreen(<FamilyScreen />);
    await view.findByLabelText(copy.home.joinFamily);
    expect(view.queryByText(copy.invite.pastePrompt)).toBeNull();
    fireEvent.press(view.getByLabelText(copy.home.joinFamily));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/join-family');
  });

  it('signs out then replaces to welcome', async () => {
    const { findByText } = renderScreen(<FamilyScreen />);
    fireEvent.press(await findByText(copy.auth.signOut));
    await waitFor(() => {
      expect(supabase.auth.signOut).toHaveBeenCalled();
    });
    expect(mockedRouter().replace).toHaveBeenCalledWith('/(signed-out)/welcome');
  });

  it('opens Your phones from Family', async () => {
    const { findByText } = renderScreen(<FamilyScreen />);
    fireEvent.press(await findByText(copy.home.yourPhones));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/your-phones');
  });

  it('lists a child with a subtitle test id for kid profile and no email', async () => {
    (fetchChildren as jest.Mock).mockResolvedValueOnce([
      { id: 'c1', displayName: 'Lily', dateOfBirth: null },
    ]);
    const { findByTestId } = renderScreen(<FamilyScreen />);
    const subtitle = await findByTestId('child-lily-subtitle');
    expect(String(subtitle.props.children)).toMatch(/Kid profile/);
    expect(String(subtitle.props.children)).toMatch(/no email/i);
  });

  it('never shows a blank member card', async () => {
    const { findAllByText, getAllByText } = renderScreen(<FamilyScreen />);
    expect((await findAllByText(copy.member.fallbackName)).length).toBeGreaterThan(0);
    expect(getAllByText(copy.roles.co_admin).length).toBeGreaterThan(0);
  });
});
