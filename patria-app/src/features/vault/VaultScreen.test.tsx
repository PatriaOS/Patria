import { copy } from '../../lib/copy';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { fetchMembers } from '../../lib/family';
import { renderScreen } from '../../test/renderScreen';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { canWriteVault, VaultScreen } from './VaultScreen';
import { fetchVaultEntries } from './vaultApi';

jest.mock('../family/useCurrentFamily', () => ({
  useCurrentFamily: jest.fn(),
}));

jest.mock('../../lib/crypto/familyCeremony', () => ({
  ensureKeysForOpenFamily: jest.fn(async () => 'ready'),
}));

jest.mock('../../lib/crypto/recoverySetup', () => ({
  loadRecoverySnapshot: jest.fn(async () => ({
    accepted: 2,
    hasRecoveryPublic: true,
    contacts: [],
    ownContacts: [],
    pending: [],
    hasPaper: true,
    recoveryKeyEpoch: 1,
    keyEpoch: 1,
    status: 'setup',
  })),
}));

jest.mock('../../lib/family', () => ({
  fetchMembers: jest.fn(async () => []),
}));

jest.mock('./vaultApi', () => ({
  fetchVaultEntries: jest.fn(async () => []),
  fetchFamilyKeyEpoch: jest.fn(async () => 1),
}));

jest.mock('./useFamilyKey', () => ({
  loadFamilyKeyForVault: jest.fn(async () => new Uint8Array(32)),
  withFamilyKey: (_key: Uint8Array, run: (key: Uint8Array) => unknown) => run(new Uint8Array(32)),
}));

const adminFamily = {
  userId: 'u1',
  spaceId: 's1',
  current: { role: 'family_admin', space: { id: 's1', name: 'Riveras' } },
  keyHolder: true,
  admin: true,
};

describe('Vault tab', () => {
  beforeEach(() => {
    (useCurrentFamily as jest.Mock).mockReturnValue(adminFamily);
    (ensureKeysForOpenFamily as jest.Mock).mockResolvedValue('ready');
    (loadRecoverySnapshot as jest.Mock).mockResolvedValue({
      accepted: 2,
      hasRecoveryPublic: true,
      contacts: [],
      ownContacts: [],
      pending: [],
      hasPaper: true,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
      status: 'setup',
    });
    (fetchVaultEntries as jest.Mock).mockResolvedValue([]);
    (fetchMembers as jest.Mock).mockResolvedValue([]);
  });

  it('lets a writer with recovery add a decision, and shows the empty vault', async () => {
    const { getByTestId, findByText, queryByText } = renderScreen(<VaultScreen />);
    expect(getByTestId('screen-vault')).toBeTruthy();
    expect(await findByText(copy.vault.emptyTitle)).toBeTruthy();
    expect(getByTestId('new-decision')).toBeTruthy();
    expect(queryByText(copy.vault.recoveryFirst)).toBeNull();
  });

  it('hides New decision for a teen', async () => {
    (useCurrentFamily as jest.Mock).mockReturnValue({
      ...adminFamily,
      current: { role: 'teen', space: { id: 's1', name: 'Riveras' } },
      admin: false,
    });
    const { findByText, queryByText } = renderScreen(<VaultScreen />);
    expect(await findByText(copy.vault.emptyTitle)).toBeTruthy();
    expect(queryByText(copy.vault.newDecision)).toBeNull();
  });

  it('asks writers to set up recovery before they write', async () => {
    (loadRecoverySnapshot as jest.Mock).mockResolvedValue({
      accepted: 0,
      hasRecoveryPublic: false,
      contacts: [],
      ownContacts: [],
      pending: [],
      hasPaper: false,
      recoveryKeyEpoch: 1,
      keyEpoch: 1,
      status: 'not_setup',
    });
    const { findByText, queryByText } = renderScreen(<VaultScreen />);
    expect(await findByText(copy.vault.recoveryFirst)).toBeTruthy();
    expect(queryByText(copy.vault.newDecision)).toBeNull();
  });

  it('gates write on role, keys, and two accepted recovery contacts', () => {
    expect(
      canWriteVault({
        role: 'family_admin',
        keyReady: true,
        acceptedContacts: 2,
        hasRecoveryPublic: true,
      }),
    ).toBe(true);
    expect(
      canWriteVault({
        role: 'teen',
        keyReady: true,
        acceptedContacts: 2,
        hasRecoveryPublic: true,
      }),
    ).toBe(false);
    expect(
      canWriteVault({
        role: 'elder',
        keyReady: true,
        acceptedContacts: 1,
        hasRecoveryPublic: true,
      }),
    ).toBe(false);
  });
});
