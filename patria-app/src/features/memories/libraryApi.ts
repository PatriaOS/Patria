import { Platform } from 'react-native';

import { supabase } from '../../lib/supabase';

export type LibraryMode = 'all_new' | 'selected_albums';

export type LibraryConnectionRow = {
  id: string;
  user_id: string;
  family_space_id: string;
  device_id: string;
  mode: LibraryMode;
  circle_id: string;
  started_at: string;
  allow_cellular: boolean;
  paused: boolean;
  needs_circle: boolean;
  last_synced_at: string | null;
};

export function librarySyncSupported(): boolean {
  return Platform.OS === 'ios';
}

export async function fetchOwnConnection(
  userId: string,
  spaceId: string,
  deviceId: string,
): Promise<LibraryConnectionRow | null> {
  const { data, error } = await supabase
    .from('memory_library_connections')
    .select(
      'id, user_id, family_space_id, device_id, mode, circle_id, started_at, allow_cellular, paused, needs_circle, last_synced_at',
    )
    .eq('user_id', userId)
    .eq('family_space_id', spaceId)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as LibraryConnectionRow | null) ?? null;
}

export async function upsertConnection(input: {
  userId: string;
  spaceId: string;
  deviceId: string;
  mode: LibraryMode;
  circleId: string;
  startedAt: string;
  allowCellular: boolean;
}): Promise<LibraryConnectionRow> {
  const { data, error } = await supabase
    .from('memory_library_connections')
    .upsert(
      {
        user_id: input.userId,
        family_space_id: input.spaceId,
        device_id: input.deviceId,
        mode: input.mode,
        circle_id: input.circleId,
        started_at: input.startedAt,
        allow_cellular: input.allowCellular,
        paused: false,
        needs_circle: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,family_space_id,device_id' },
    )
    .select(
      'id, user_id, family_space_id, device_id, mode, circle_id, started_at, allow_cellular, paused, needs_circle, last_synced_at',
    )
    .single();
  if (error || !data) {
    throw error ?? new Error('connection failed');
  }
  return data as LibraryConnectionRow;
}

export async function patchConnection(
  id: string,
  patch: Partial<{
    paused: boolean;
    allow_cellular: boolean;
    needs_circle: boolean;
    circle_id: string;
    last_synced_at: string;
  }>,
): Promise<void> {
  const { error } = await supabase.from('memory_library_connections').update(patch).eq('id', id);
  if (error) {
    throw error;
  }
}

export async function deleteConnection(id: string): Promise<void> {
  const { error } = await supabase.from('memory_library_connections').delete().eq('id', id);
  if (error) {
    throw error;
  }
}

export async function fetchOwnHashes(userId: string, spaceId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('memory_items')
    .select('source_hash')
    .eq('uploader_id', userId)
    .eq('family_space_id', spaceId)
    .not('source_hash', 'is', null);
  if (error) {
    throw error;
  }
  return (data ?? [])
    .map((row) => row.source_hash as string | null)
    .filter((value): value is string => Boolean(value));
}

export async function fetchOwnTombstones(userId: string, spaceId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('memory_item_tombstones')
    .select('source_hash')
    .eq('uploader_id', userId)
    .eq('family_space_id', spaceId);
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => row.source_hash as string);
}
