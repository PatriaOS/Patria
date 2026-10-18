import { Image } from 'expo-image';
import * as tus from 'tus-js-client';

import { copy } from '../../lib/copy';
import { supabase } from '../../lib/supabase';
import { RESUMABLE_MIN_BYTES } from './sourceHash';

export const MEMORIES_BUCKET = 'memories';
export const SIGNED_URL_SECONDS = 600;
export const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

export type MemoryCircle = {
  id: string;
  name: string;
  kind: string;
};

export type MemoryItem = {
  id: string;
  familySpaceId: string;
  circleId: string;
  circleName: string;
  circleKind: string;
  uploaderId: string;
  uploaderName: string;
  caption: string | null;
  takenAt: string;
  createdAt: string;
  width: number;
  height: number;
  fullPath: string;
  thumbPath: string;
  thumbUrl: string | null;
  fullUrl: string | null;
  kind: 'photo' | 'video';
  durationSeconds: number | null;
  addedAutomatically: boolean;
  sourceHash: string | null;
};

type MemoryRow = {
  id: string;
  family_space_id: string;
  circle_id: string;
  uploader_id: string;
  caption: string | null;
  taken_at: string;
  created_at: string;
  width: number;
  height: number;
  full_path: string;
  thumb_path: string;
  status: string;
  kind?: string | null;
  duration_seconds?: number | null;
  added_automatically?: boolean | null;
  source_hash?: string | null;
  circles: { name: string; kind: string } | { name: string; kind: string }[] | null;
  profiles: { display_name: string } | { display_name: string }[] | null;
};

function oneRel<T>(value: T | T[] | null): T | null {
  if (!value) {
    return null;
  }
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function signedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(MEMORIES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    return null;
  }
  return data.signedUrl;
}

export function mapMemoryRow(row: MemoryRow, urls: { thumb: string | null; full: string | null }): MemoryItem {
  const circle = oneRel(row.circles);
  const profile = oneRel(row.profiles);
  return {
    id: row.id,
    familySpaceId: row.family_space_id,
    circleId: row.circle_id,
    circleName: circle?.name ?? '',
    circleKind: circle?.kind ?? '',
    uploaderId: row.uploader_id,
    uploaderName: profile?.display_name?.trim() || copy.member.fallbackName,
    caption: row.caption,
    takenAt: row.taken_at,
    createdAt: row.created_at,
    width: row.width,
    height: row.height,
    fullPath: row.full_path,
    thumbPath: row.thumb_path,
    thumbUrl: urls.thumb,
    fullUrl: urls.full,
    kind: row.kind === 'video' ? 'video' : 'photo',
    durationSeconds: row.duration_seconds ?? null,
    addedAutomatically: Boolean(row.added_automatically),
    sourceHash: row.source_hash ?? null,
  };
}

export async function fetchUploaderCircles(spaceId: string, userId: string): Promise<MemoryCircle[]> {
  const { data, error } = await supabase
    .from('circles')
    .select('id, name, kind, owner_user_id, circle_members ( user_id )')
    .eq('family_space_id', spaceId);
  if (error) {
    throw error;
  }
  return (data ?? []).flatMap((row) => {
    const members = (row.circle_members as { user_id: string | null }[] | null) ?? [];
    const inCircle =
      members.some((member) => member.user_id === userId) ||
      (row.kind === 'only_me' && row.owner_user_id === userId);
    if (!inCircle) {
      return [];
    }
    return [{ id: row.id as string, name: row.name as string, kind: row.kind as string }];
  });
}

export async function fetchCircleMemberIds(circleId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('circle_members')
    .select('user_id')
    .eq('circle_id', circleId)
    .not('user_id', 'is', null);
  if (error) {
    throw error;
  }
  return (data ?? [])
    .map((row) => row.user_id as string | null)
    .filter((id): id is string => Boolean(id));
}

export async function fetchReadyMemories(spaceId: string): Promise<MemoryItem[]> {
  const { data, error } = await supabase
    .from('memory_items')
    .select(
      'id, family_space_id, circle_id, uploader_id, caption, taken_at, created_at, width, height, full_path, thumb_path, status, kind, duration_seconds, added_automatically, source_hash, circles ( name, kind ), profiles!uploader_id ( display_name )',
    )
    .eq('family_space_id', spaceId)
    .eq('status', 'ready')
    .order('taken_at', { ascending: false });
  if (error) {
    throw error;
  }
  const rows = (data ?? []) as MemoryRow[];
  const names = await displayNamesFor(rows.map((row) => row.uploader_id));
  return Promise.all(
    rows.map(async (row) => {
      const thumb = await signedUrl(row.thumb_path);
      const item = mapMemoryRow(row, { thumb, full: null });
      item.uploaderName = names.get(row.uploader_id) ?? item.uploaderName;
      return item;
    }),
  );
}

async function displayNamesFor(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    return new Map();
  }
  const { data, error } = await supabase.from('profiles').select('id, display_name').in('id', unique);
  if (error) {
    return new Map();
  }
  return new Map(
    (data ?? []).map((row) => [
      row.id as string,
      String(row.display_name ?? '').trim() || copy.member.fallbackName,
    ]),
  );
}

export async function fetchMemoryItem(itemId: string): Promise<MemoryItem | null> {
  const { data, error } = await supabase
    .from('memory_items')
    .select(
      'id, family_space_id, circle_id, uploader_id, caption, taken_at, created_at, width, height, full_path, thumb_path, status, kind, duration_seconds, added_automatically, source_hash, circles ( name, kind ), profiles!uploader_id ( display_name )',
    )
    .eq('id', itemId)
    .eq('status', 'ready')
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  const row = data as MemoryRow;
  const [thumb, full, names] = await Promise.all([
    signedUrl(row.thumb_path),
    signedUrl(row.full_path),
    displayNamesFor([row.uploader_id]),
  ]);
  const item = mapMemoryRow(row, { thumb, full });
  item.uploaderName = names.get(row.uploader_id) ?? item.uploaderName;
  return item;
}

async function jpegBodyFromUri(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  return response.arrayBuffer();
}

async function uploadObject(
  path: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  if (body.byteLength > RESUMABLE_MIN_BYTES) {
    await uploadResumable(path, body, contentType);
    return;
  }
  const uploaded = await supabase.storage.from(MEMORIES_BUCKET).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (uploaded.error) {
    throw uploaded.error;
  }
}

async function uploadResumable(path: string, body: ArrayBuffer, contentType: string): Promise<void> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!token || !url) {
    throw new Error('upload-session');
  }
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(new Blob([body], { type: contentType }), {
      endpoint: `${url.replace(/\/$/, '')}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${token}`,
        apikey: anon,
        'x-upsert': 'true',
      },
      metadata: {
        bucketName: MEMORIES_BUCKET,
        objectName: path,
        contentType,
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024,
      onError: (error) => reject(error),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

export async function findMemoryBySourceHash(
  spaceId: string,
  uploaderId: string,
  sourceHash: string,
): Promise<{ id: string; circleName: string } | null> {
  const { data, error } = await supabase
    .from('memory_items')
    .select('id, circles ( name )')
    .eq('family_space_id', spaceId)
    .eq('uploader_id', uploaderId)
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  const circle = oneRel(data.circles as { name: string } | { name: string }[] | null);
  return { id: data.id as string, circleName: circle?.name ?? copy.circles.custom };
}

export async function uploadPreparedPhoto(input: {
  spaceId: string;
  circleId: string;
  uploaderId: string;
  caption: string | null;
  takenAt: string;
  width: number;
  height: number;
  fullUri: string;
  thumbUri: string;
  sourceHash?: string | null;
  source?: 'picker' | 'library_sync';
  addedAutomatically?: boolean;
}): Promise<string> {
  return uploadPreparedMedia({
    ...input,
    kind: 'photo',
    durationSeconds: null,
    fullContentType: 'image/jpeg',
    source: input.source ?? 'picker',
    addedAutomatically: input.addedAutomatically ?? false,
  });
}

export async function uploadPreparedVideo(input: {
  spaceId: string;
  circleId: string;
  uploaderId: string;
  caption: string | null;
  takenAt: string;
  width: number;
  height: number;
  fullUri: string;
  thumbUri: string;
  durationSeconds: number;
  fullContentType: 'video/mp4' | 'video/quicktime';
  sourceHash?: string | null;
}): Promise<string> {
  return uploadPreparedMedia({
    ...input,
    kind: 'video',
    source: 'picker',
    addedAutomatically: false,
  });
}

async function uploadPreparedMedia(input: {
  spaceId: string;
  circleId: string;
  uploaderId: string;
  caption: string | null;
  takenAt: string;
  width: number;
  height: number;
  fullUri: string;
  thumbUri: string;
  kind: 'photo' | 'video';
  durationSeconds: number | null;
  fullContentType: string;
  sourceHash?: string | null;
  source: 'picker' | 'library_sync';
  addedAutomatically: boolean;
}): Promise<string> {
  if (input.sourceHash) {
    const existing = await findMemoryBySourceHash(input.spaceId, input.uploaderId, input.sourceHash);
    if (existing) {
      const error = new Error(`already-shared:${existing.circleName}`);
      throw error;
    }
    const uploading = await supabase
      .from('memory_items')
      .select('id, full_path, thumb_path, status')
      .eq('family_space_id', input.spaceId)
      .eq('uploader_id', input.uploaderId)
      .eq('source_hash', input.sourceHash)
      .eq('status', 'uploading')
      .maybeSingle();
    if (uploading.data) {
      return finishUpload(uploading.data.id as string, uploading.data.full_path as string, uploading.data.thumb_path as string, input);
    }
  }
  const insert = await supabase
    .from('memory_items')
    .insert({
      family_space_id: input.spaceId,
      circle_id: input.circleId,
      uploader_id: input.uploaderId,
      caption: input.caption,
      taken_at: input.takenAt,
      width: input.width,
      height: input.height,
      status: 'uploading',
      kind: input.kind,
      duration_seconds: input.durationSeconds,
      source: input.source,
      source_hash: input.sourceHash ?? null,
      added_automatically: input.addedAutomatically,
    })
    .select('id, full_path, thumb_path')
    .single();
  if (insert.error || !insert.data) {
    throw insert.error ?? new Error('insert failed');
  }
  return finishUpload(insert.data.id as string, insert.data.full_path as string, insert.data.thumb_path as string, input);
}

async function finishUpload(
  itemId: string,
  fullPath: string,
  thumbPath: string,
  input: {
    fullUri: string;
    thumbUri: string;
    fullContentType: string;
  },
): Promise<string> {
  try {
    const fullBody = await jpegBodyFromUri(input.fullUri);
    const thumbBody = await jpegBodyFromUri(input.thumbUri);
    await uploadObject(fullPath, fullBody, input.fullContentType);
    await uploadObject(thumbPath, thumbBody, 'image/jpeg');
    const ready = await supabase.from('memory_items').update({ status: 'ready' }).eq('id', itemId);
    if (ready.error) {
      throw ready.error;
    }
    return itemId;
  } catch (error) {
    await supabase.storage.from(MEMORIES_BUCKET).remove([fullPath, thumbPath]);
    await supabase.from('memory_items').delete().eq('id', itemId);
    throw error;
  }
}

export async function deleteMemoryItem(item: {
  id: string;
  fullPath: string;
  thumbPath: string;
}): Promise<void> {
  const removed = await supabase.storage.from(MEMORIES_BUCKET).remove([item.fullPath, item.thumbPath]);
  if (removed.error) {
    throw removed.error;
  }
  const deleted = await supabase.from('memory_items').delete().eq('id', item.id);
  if (deleted.error) {
    throw deleted.error;
  }
}

export async function moveMemoryItem(itemId: string, circleId: string): Promise<void> {
  const { error } = await supabase.from('memory_items').update({ circle_id: circleId }).eq('id', itemId);
  if (error) {
    throw error;
  }
}

export async function cleanupStaleUploads(uploaderId: string, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_UPLOAD_MS).toISOString();
  const { data, error } = await supabase
    .from('memory_items')
    .select('id, full_path, thumb_path')
    .eq('uploader_id', uploaderId)
    .eq('status', 'uploading')
    .lt('created_at', cutoff);
  if (error) {
    throw error;
  }
  for (const row of data ?? []) {
    await deleteMemoryItem({
      id: row.id as string,
      fullPath: row.full_path as string,
      thumbPath: row.thumb_path as string,
    });
  }
}

export async function clearImageCacheIfItemsLost(
  previousIds: string[],
  nextIds: string[],
): Promise<void> {
  const next = new Set(nextIds);
  const lost = previousIds.some((id) => !next.has(id));
  if (!lost) {
    return;
  }
  await Image.clearMemoryCache();
  await Image.clearDiskCache();
}
