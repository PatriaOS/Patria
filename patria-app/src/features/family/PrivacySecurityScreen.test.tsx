import { fireEvent } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { fetchMemberships, fetchMembers } from '../../lib/family';
import { renderScreen } from '../../test/renderScreen';
import { PrivacySecurityScreen } from './PrivacySecurityScreen';

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/family', () => ({
  fetchMemberships: jest.fn(async () => [
    { space: { id: 's1', name: 'The Riveras' }, role: 'family_admin' },
  ]),
  fetchMembers: jest.fn(async () => []),
  fetchChildren: jest.fn(async () => []),
  fetchPendingInvites: jest.fn(async () => []),
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

function mockedRouter(): { push: jest.Mock } {
  const expoRouter = jest.requireMock('expo-router') as {
    useRouter: () => { push: jest.Mock };
  };
  return expoRouter.useRouter();
}

describe('PrivacySecurityScreen', () => {
  beforeEach(() => {
    mockedRouter().push.mockClear();
    (fetchMemberships as jest.Mock).mockResolvedValue([
      { space: { id: 's1', name: 'The Riveras' }, role: 'family_admin' },
    ]);
    (fetchMembers as jest.Mock).mockResolvedValue([]);
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

  it('opens recovery contacts from the Recovery section', async () => {
    const { findByTestId } = await renderScreen(<PrivacySecurityScreen />);
    expect(await findByTestId('screen-privacy-security')).toBeTruthy();
    await fireEvent.press(await findByTestId('privacy-recovery-contacts'));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/recovery-setup');
  });

  it('offers a printed-code step after two contacts accept', async () => {
    (loadRecoverySnapshot as jest.Mock).mockResolvedValue({
      contacts: [],
      ownContacts: [],
      accepted: 2,
      pending: [],
      hasPaper: false,
      hasRecoveryPublic: true,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
      status: 'setup',
    });
    const { findByTestId, findByText } = await renderScreen(<PrivacySecurityScreen />);
    expect(await findByText(copy.home.recoveryPrintedAction)).toBeTruthy();
    await fireEvent.press(await findByTestId('create-printed-code'));
    expect(mockedRouter().push).toHaveBeenCalledWith('/(signed-in)/printed-code');
  });
});
