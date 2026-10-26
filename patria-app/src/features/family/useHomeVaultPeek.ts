// SECURITY REVIEW REQUIRED
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { wipe } from '../../lib/crypto/bytes';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { personalKeyNeedsOtherPhone } from '../../lib/crypto/keyStore';
import { loadPersonalKeyIfPresent } from '../../lib/crypto/personalKey';
import { fetchMembers } from '../../lib/family';
import { isKeyEligibleRole } from '../../lib/roles';
import { fetchVaultEntries } from '../vault/vaultApi';
import { loadFamilyKeyForVault } from '../vault/useFamilyKey';
import {
  peekHomeVault,
  type HomeVaultHighlight,
  type HomeVoicePeek,
} from './homeVaultPeek';

export type HomeVaultPeekUi = {
  loading: boolean;
  failed: boolean;
  locked: boolean;
  voice: HomeVoicePeek;
  vault: HomeVaultHighlight;
  refetch: () => void;
};

type DecryptedPeek = {
  voice: HomeVoicePeek;
  vault: HomeVaultHighlight;
};

/**
 * Sealed Vault rows stay in the query cache. Decrypted titles and audio refs
 * live only in this hook's React state and clear when the hook unmounts
 * (including sign out). Never write them to AsyncStorage or SecureStore.
 */
export function useHomeVaultPeek(input: {
  spaceId: string | undefined;
  userId: string | undefined;
  role: string | null | undefined;
  keyHolder: boolean;
}): HomeVaultPeekUi {
  const { spaceId, userId, role, keyHolder } = input;
  const [decrypted, setDecrypted] = useState<DecryptedPeek | null>(null);
  const [decryptFailed, setDecryptFailed] = useState(false);
  const [decrypting, setDecrypting] = useState(false);

  const keyStatusQuery = useQuery({
    queryKey: ['familyKeyStatus', spaceId, userId, role],
    enabled: Boolean(spaceId && userId && isKeyEligibleRole(role)),
    queryFn: () =>
      ensureKeysForOpenFamily({
        spaceId: spaceId as string,
        userId: userId as string,
        role,
      }),
  });

  const rowsQuery = useQuery({
    queryKey: ['vaultEntries', spaceId, 'home-sealed'],
    enabled: Boolean(spaceId && userId),
    queryFn: () => fetchVaultEntries(spaceId as string),
  });

  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchMembers(spaceId as string),
  });

  const locked =
    isKeyEligibleRole(role) &&
    (keyStatusQuery.data == null || keyStatusQuery.data !== 'ready');

  const queriesReady =
    Boolean(spaceId && userId) &&
    !rowsQuery.isLoading &&
    !membersQuery.isLoading &&
    !(isKeyEligibleRole(role) && keyStatusQuery.isLoading);

  const queryFailed = rowsQuery.isError || membersQuery.isError;

  useEffect(() => {
    if (!queriesReady || queryFailed || locked || !spaceId || !userId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      setDecrypting(true);
      setDecryptFailed(false);
      let familyKey: Uint8Array | null = null;
      let personalKey: Uint8Array | null = null;
      try {
        if (keyHolder && keyStatusQuery.data === 'ready') {
          familyKey = await loadFamilyKeyForVault(userId, spaceId);
        }
        try {
          personalKey = await loadPersonalKeyIfPresent({ spaceId, userId });
        } catch (error) {
          if (!(error instanceof Error && error.message === personalKeyNeedsOtherPhone)) {
            throw error;
          }
        }
        if (cancelled) {
          return;
        }
        const peek = peekHomeVault({
          rows: rowsQuery.data ?? [],
          members: membersQuery.data ?? [],
          keys: { familyKey, personalKey },
          locked: false,
        });
        setDecrypted({ voice: peek.voice, vault: peek.vault });
      } catch {
        if (!cancelled) {
          setDecryptFailed(true);
          setDecrypted(null);
        }
      } finally {
        if (familyKey) {
          wipe(familyKey);
        }
        if (personalKey) {
          wipe(personalKey);
        }
        if (!cancelled) {
          setDecrypting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      // Clear plaintext titles/audio refs from memory on unmount or dependency change.
      setDecrypted(null);
    };
  }, [
    queriesReady,
    queryFailed,
    locked,
    spaceId,
    userId,
    keyHolder,
    keyStatusQuery.data,
    rowsQuery.data,
    membersQuery.data,
  ]);

  if (locked) {
    return {
      loading: false,
      failed: false,
      locked: true,
      voice: { state: 'locked' },
      vault: { state: 'locked' },
      refetch: () => {
        void rowsQuery.refetch();
        void membersQuery.refetch();
        void keyStatusQuery.refetch();
      },
    };
  }

  return {
    loading: !queriesReady || decrypting || (queriesReady && !queryFailed && decrypted == null && !decryptFailed),
    failed: queryFailed || decryptFailed,
    locked: false,
    voice: decrypted?.voice ?? { state: 'empty' },
    vault: decrypted?.vault ?? { state: 'empty' },
    refetch: () => {
      void rowsQuery.refetch();
      void membersQuery.refetch();
      void keyStatusQuery.refetch();
    },
  };
}
