import { fromPgBytea, toPgBytea } from '../../lib/crypto/pgBytea';
import { supabase } from '../../lib/supabase';
import type { SealedVaultEntry, VaultVisibility } from '../../lib/crypto/vaultEnvelope';

export type VaultEntryRow = {
  id: string;
  familySpaceId: string;
  authorId: string;
  parentEntryId: string | null;
  kind: 'decision';
  version: number;
  keyEpoch: number | null;
  visibility: VaultVisibility;
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
  key_epoch: number | null;
  visibility: string;
  content_nonce: unknown;
  ciphertext: unknown;
  cek_nonce: unknown;
  wrapped_cek: unknown;
  created_at: string;
  updated_at: string;
};

function asVisibility(value: string): VaultVisibility {
  return value === 'private' ? 'private' : 'family';
}

function fromRow(row: VaultEntryDb): VaultEntryRow {
  return {
    id: row.id,
    familySpaceId: row.family_space_id,
    authorId: row.author_id,
    parentEntryId: row.parent_entry_id,
    kind: 'decision',
    version: row.version,
    keyEpoch: row.key_epoch,
    visibility: asVisibility(row.visibility),
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

const ENTRY_COLUMNS =
  'id, family_space_id, author_id, parent_entry_id, kind, version, key_epoch, visibility, content_nonce, ciphertext, cek_nonce, wrapped_cek, created_at, updated_at';

export function vaultAudioObjectPath(
  spaceId: string,
  entryId: string,
  audioId: string,
): string {
  return `${spaceId}/${entryId}/${audioId}`;
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
    .select(ENTRY_COLUMNS)
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
  keyEpoch: number | null;
  visibility: VaultVisibility;
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
    visibility: input.visibility,
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
  keyEpoch: number | null;
  visibility: VaultVisibility;
  sealed: SealedVaultEntry;
}): Promise<void> {
  const { data, error } = await supabase
    .from('vault_entries')
    .update({
      version: input.expectedVersion + 1,
      key_epoch: input.keyEpoch,
      visibility: input.visibility,
      content_nonce: toPgBytea(input.sealed.contentNonce),
      ciphertext: toPgBytea(input.sealed.ciphertext),
      cek_nonce: toPgBytea(input.sealed.cekNonce),
      wrapped_cek: toPgBytea(input.sealed.wrappedCek),
    })
    .eq('id', input.id)
    .eq('version', input.expectedVersion)
    .select('id');
  if (error) {
    throw new Error(
      `${error.code ?? 'update'}: ${error.message}${error.details ? ` ${error.details}` : ''}`,
    );
  }
  if (!data?.length) {
    throw new Error('update refused: version mismatch or row-level security');
  }
}

export async function commitVaultVisibilitySwitch(input: {
  parentId: string;
  visibility: VaultVisibility;
  parentExpectedVersion: number;
  parentKeyEpoch: number | null;
  parentSealed: SealedVaultEntry;
  children: {
    id: string;
    expectedVersion: number;
    keyEpoch: number | null;
    sealed: SealedVaultEntry;
  }[];
}): Promise<void> {
  const { error } = await supabase.rpc('commit_vault_visibility_switch', {
    p_parent_id: input.parentId,
    p_visibility: input.visibility,
    p_parent_expected_version: input.parentExpectedVersion,
    p_parent_key_epoch: input.parentKeyEpoch,
    p_parent_content_nonce: toPgBytea(input.parentSealed.contentNonce),
    p_parent_ciphertext: toPgBytea(input.parentSealed.ciphertext),
    p_parent_cek_nonce: toPgBytea(input.parentSealed.cekNonce),
    p_parent_wrapped_cek: toPgBytea(input.parentSealed.wrappedCek),
    p_child_ids: input.children.map((row) => row.id),
    p_child_expected_versions: input.children.map((row) => row.expectedVersion),
    p_child_key_epochs: input.children.map((row) => row.keyEpoch),
    p_child_content_nonces: input.children.map((row) => toPgBytea(row.sealed.contentNonce)),
    p_child_ciphertexts: input.children.map((row) => toPgBytea(row.sealed.ciphertext)),
    p_child_cek_nonces: input.children.map((row) => toPgBytea(row.sealed.cekNonce)),
    p_child_wrapped_ceks: input.children.map((row) => toPgBytea(row.sealed.wrappedCek)),
  });
  if (error) {
    throw new Error(
      `${error.code ?? 'switch'}: ${error.message}${error.details ? ` ${error.details}` : ''}`,
    );
  }
}

export async function deleteVaultEntry(id: string): Promise<void> {
  const { error } = await supabase.from('vault_entries').delete().eq('id', id);
  if (error) {
    throw error;
  }
}

export async function uploadVaultAudio(input: {
  spaceId: string;
  entryId: string;
  audioId: string;
  ciphertext: Uint8Array;
}): Promise<void> {
  const path = vaultAudioObjectPath(input.spaceId, input.entryId, input.audioId);
  const bytes = Uint8Array.from(input.ciphertext);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  // Insert only: the vault bucket has no UPDATE policy, and upsert:true is
  // refused even for a new path. Each save remints a fresh audio id so a
  // leftover object is never treated as a successful upload.
  const uploaded = await supabase.storage.from('vault').upload(path, body, {
    contentType: 'application/octet-stream',
    upsert: false,
  });
  if (uploaded.error) {
    throw uploaded.error;
  }
}

export async function downloadVaultAudio(input: {
  spaceId: string;
  entryId: string;
  audioId: string;
}): Promise<Uint8Array> {
  const path = vaultAudioObjectPath(input.spaceId, input.entryId, input.audioId);
  const downloaded = await supabase.storage.from('vault').download(path);
  if (downloaded.error || !downloaded.data) {
    throw downloaded.error ?? new Error('missing audio');
  }
  return new Uint8Array(await downloaded.data.arrayBuffer());
}

export async function deleteVaultAudio(input: {
  spaceId: string;
  entryId: string;
  audioId: string;
}): Promise<void> {
  const path = vaultAudioObjectPath(input.spaceId, input.entryId, input.audioId);
  const removed = await supabase.storage.from('vault').remove([path]);
  if (removed.error) {
    throw removed.error;
  }
}
