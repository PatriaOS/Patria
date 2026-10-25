import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { memberDisplayName } from '../../lib/displayName';
import { fetchChildren, fetchMembers, fetchMemberships } from '../../lib/family';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
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

jest.mock('../../lib/crypto/familyCeremony', () => ({
  ensureKeysForOpenFamily: jest.fn(async () => 'ready'),
}));

jest.mock('../../lib/crypto/recoverySetup', () => ({
  loadRecoverySnapshot: jest.fn(async () => ({
    contacts: [],
    ownContacts: [],
    accepted: 0,
    pending: [],
    hasPaper: false,
    hasRecoveryPublic: false,
    recoveryKeyEpoch: 1,
    keyEpoch: 1,
    status: 'not_setup',
  })),
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
    (ensureKeysForOpenFamily as jest.Mock).mockResolvedValue('ready');
    (loadRecoverySnapshot as jest.Mock).mockResolvedValue({
      contacts: [],
      ownContacts: [],
      accepted: 0,
      pending: [],
      hasPaper: false,
      hasRecoveryPublic: false,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
      status: 'not_setup',
    });
  });

  it('shows the keys and recovery status that moved off Home', async () => {
    const { findByTestId, findByText } = await renderScreen(<FamilyScreen />);
    expect(await findByTestId('family-keys-status', {}, { timeout: 10000 })).toBeTruthy();
    expect(await findByText(copy.home.keysReady)).toBeTruthy();
    expect(await findByTestId('family-recovery-status')).toBeTruthy();
    expect(await findByText(copy.home.recoveryNotSetup)).toBeTruthy();
  });

  it('says when this phone is still waiting to be let in', async () => {
    (ensureKeysForOpenFamily as jest.Mock).mockResolvedValue('waiting');
    const { findByText } = await renderScreen(<FamilyScreen />);
    expect(await findByText(copy.home.keysWaiting)).toBeTruthy();
  });

  it('offers invite, add a child, Appearance and sign out', async () => {
    const { findByText, findByTestId } = await renderScreen(<FamilyScreen />);
    expect(await findByTestId('screen-family')).toBeTruthy();
    expect(await findByText(copy.home.invite)).toBeTruthy();
    await fireEvent.press(await findByText(copy.home.addChild));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/add-child');
    await fireEvent.press(await findByText(copy.appearance.title));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/appearance');
  });

  it('offers Create another family next to Join another family', async () => {
    const view = await renderScreen(<FamilyScreen />);
    await view.findByLabelText(copy.home.createAnotherFamily);
    await fireEvent.press(view.getByLabelText(copy.home.createAnotherFamily));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/create');
  });

  it('uses a Join another family link instead of a paste box', async () => {
    const view = await renderScreen(<FamilyScreen />);
    await view.findByLabelText(copy.home.joinFamily);
    expect(view.queryByText(copy.invite.pastePrompt)).toBeNull();
    await fireEvent.press(view.getByLabelText(copy.home.joinFamily));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/join-family');
  });

  it('signs out then replaces to welcome', async () => {
    const { findByText } = await renderScreen(<FamilyScreen />);
    await fireEvent.press(await findByText(copy.auth.signOut));
    await waitFor(() => {
      expect(supabase.auth.signOut).toHaveBeenCalled();
    });
    expect(mockedRouter().replace).toHaveBeenCalledWith('/(signed-out)/welcome');
  });

  it('opens Your phones from Family', async () => {
    const { findByText } = await renderScreen(<FamilyScreen />);
    await fireEvent.press(await findByText(copy.home.yourPhones));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/your-phones');
  });

  it('lists a child with a subtitle test id for kid profile and no email', async () => {
    (fetchChildren as jest.Mock).mockResolvedValueOnce([
      { id: 'c1', displayName: 'Lily', dateOfBirth: null },
    ]);
    const { findByTestId } = await renderScreen(<FamilyScreen />);
    const subtitle = await findByTestId('child-lily-subtitle');
    expect(String(subtitle.props.children)).toMatch(/Kid profile/);
    expect(String(subtitle.props.children)).toMatch(/no email/i);
  });

  it('never shows a blank member card', async () => {
    const { findAllByText, getAllByText } = await renderScreen(<FamilyScreen />);
    expect((await findAllByText(copy.member.fallbackName)).length).toBeGreaterThan(0);
    expect(getAllByText(copy.roles.co_admin).length).toBeGreaterThan(0);
  });
});
