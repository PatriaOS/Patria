import { getSecretText, setSecretText } from '../../lib/crypto/secureKeys';

function storeKey(userId: string, spaceId: string): string {
  return `patria.u.${userId}.library.albums.${spaceId}`;
}

export async function readAlbumIds(userId: string, spaceId: string): Promise<string[]> {
  const raw = await getSecretText(storeKey(userId, spaceId));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export async function writeAlbumIds(userId: string, spaceId: string, albumIds: string[]): Promise<void> {
  await setSecretText(storeKey(userId, spaceId), JSON.stringify(albumIds));
}
