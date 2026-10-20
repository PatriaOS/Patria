// SECURITY REVIEW REQUIRED
import * as SecureStore from 'expo-secure-store';

import { clearVaultDraft, loadVaultDraft, saveVaultDraft, type VaultDraftFileGateway } from './vaultDrafts';

function installMemoryStore(store: Map<string, string>): void {
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    return store.get(key) ?? null;
  });
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    store.delete(key);
  });
}

function memoryFiles(): VaultDraftFileGateway & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    documentDirectory: () => 'file:///docs/',
    writeBase64: async (path, value) => {
      files.set(path, value);
    },
    readBase64: async (path) => files.get(path) ?? null,
    delete: async (path) => {
      files.delete(path);
    },
  };
}

describe('vault drafts', () => {
  it('stores a draft key in SecureStore and ciphertext as a file, then wipes both', async () => {
    const store = new Map<string, string>();
    installMemoryStore(store);
    const files = memoryFiles();
    await saveVaultDraft(
      'u1',
      's1',
      { title: 'Move', body: 'Near Abuela.', for: 'Lily' },
      files,
    );
    expect(store.size).toBe(1);
    expect(files.files.size).toBe(1);
    const loaded = await loadVaultDraft('u1', 's1', files);
    expect(loaded).toEqual({ title: 'Move', body: 'Near Abuela.', for: 'Lily' });
    await clearVaultDraft('u1', 's1', files);
    expect(store.size).toBe(0);
    expect(files.files.size).toBe(0);
    await expect(loadVaultDraft('u1', 's1', files)).resolves.toBeNull();
  });
});
