import { fromPgBytea, toPgBytea } from '../../lib/crypto/pgBytea';
import { supabase } from '../../lib/supabase';
import type { SealedVaultEntry } from '../../lib/crypto/vaultEnvelope';

export type VaultEntryRow = {
  id: string;
  familySpaceId: string;
  authorId: string;
  parentEntryId: string | null;
  kind: 'decision';
  version: number;
  keyEpoch: number;
  createdAt: string;
  updatedAt: string;
  sealed: SealedVaultEntry;
};

type VaultEntryDb = {
  id: string;
  family_space_id: string;
  author_id: string;
  parent_entry_id: string | null;
  kind: string;
  version: number;
  key_epoch: number;
  content_nonce: unknown;
  ciphertext: unknown;
  cek_nonce: unknown;
  wrapped_cek: unknown;
  created_at: string;
  updated_at: string;
};

function fromRow(row: VaultEntryDb): VaultEntryRow {
  return {
    id: row.id,
    familySpaceId: row.family_space_id,
    authorId: row.author_id,
    parentEntryId: row.parent_entry_id,
    kind: 'decision',
    version: row.version,
    keyEpoch: row.key_epoch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sealed: {
      contentNonce: fromPgBytea(row.content_nonce),
      ciphertext: fromPgBytea(row.ciphertext),
      cekNonce: fromPgBytea(row.cek_nonce),
      wrappedCek: fromPgBytea(row.wrapped_cek),
    },
  };
}

export async function fetchFamilyKeyEpoch(spaceId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('family_key_meta')
    .select('key_epoch')
    .eq('family_space_id', spaceId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data ? (data.key_epoch as number) : null;
}

export async function fetchVaultEntries(spaceId: string): Promise<VaultEntryRow[]> {
  const { data, error } = await supabase
    .from('vault_entries')
    .select(
      'id, family_space_id, author_id, parent_entry_id, kind, version, key_epoch, content_nonce, ciphertext, cek_nonce, wrapped_cek, created_at, updated_at',
    )
    .eq('family_space_id', spaceId)
    .order('created_at', { ascending: false });
  if (error) {
    throw error;
  }
  return ((data ?? []) as VaultEntryDb[]).map(fromRow);
}

export async function insertVaultEntry(input: {
  id: string;
  familySpaceId: string;
  authorId: string;
  parentEntryId?: string | null;
  keyEpoch: number;
  sealed: SealedVaultEntry;
}): Promise<void> {
  const { error } = await supabase.from('vault_entries').insert({
    id: input.id,
    family_space_id: input.familySpaceId,
    author_id: input.authorId,
    parent_entry_id: input.parentEntryId ?? null,
    kind: 'decision',
    version: 1,
    key_epoch: input.keyEpoch,
    content_nonce: toPgBytea(input.sealed.contentNonce),
    ciphertext: toPgBytea(input.sealed.ciphertext),
    cek_nonce: toPgBytea(input.sealed.cekNonce),
    wrapped_cek: toPgBytea(input.sealed.wrappedCek),
  });
  if (error) {
    throw new Error(
      `${error.code ?? 'insert'}: ${error.message}${error.details ? ` ${error.details}` : ''}`,
    );
  }
}

export async function updateVaultEntry(input: {
  id: string;
  expectedVersion: number;
  keyEpoch: number;
  sealed: SealedVaultEntry;
}): Promise<void> {
  const { data, error } = await supabase
    .from('vault_entries')
    .update({
      version: input.expectedVersion + 1,
      key_epoch: input.keyEpoch,
      content_nonce: toPgBytea(input.sealed.contentNonce),
      ciphertext: toPgBytea(input.sealed.ciphertext),
      cek_nonce: toPgBytea(input.sealed.cekNonce),
      wrapped_cek: toPgBytea(input.sealed.wrappedCek),
    })
    .eq('id', input.id)
    .eq('version', input.expectedVersion)
    .select('id');
  if (error) {
    throw error;
  }
  if (!data?.length) {
    throw new Error('version mismatch');
  }
}

export async function deleteVaultEntry(id: string): Promise<void> {
  const { error } = await supabase.from('vault_entries').delete().eq('id', id);
  if (error) {
    throw error;
  }
}
