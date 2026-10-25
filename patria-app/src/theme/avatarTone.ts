/** Deterministic soft avatar colors from the Hearth palette (D35). */

export const AVATAR_TONE_KEYS = [
  'sage',
  'peach',
  'cream',
  'clay',
  'mustard',
  'softForest',
] as const;

export type AvatarToneKey = (typeof AVATAR_TONE_KEYS)[number];

export type AvatarTone = {
  background: string;
  text: string;
};

/** Soft fills that sit on linen; text is dark enough for 4.5:1. */
export const avatarTonesLight: Record<AvatarToneKey, AvatarTone> = {
  sage: { background: '#DCE6DD', text: '#22302A' },
  peach: { background: '#F2DCCB', text: '#22302A' },
  cream: { background: '#EFE3C4', text: '#22302A' },
  clay: { background: '#E4D6CF', text: '#22302A' },
  mustard: { background: '#D9A441', text: '#22302A' },
  softForest: { background: '#C9D8CC', text: '#22302A' },
};

/**
 * Soft pastels on deep forest (closer to light sage/peach/cream/mustard), with dark
 * initials that meet 4.5:1 — avoids muddy brown fills.
 */
export const avatarTonesDark: Record<AvatarToneKey, AvatarTone> = {
  sage: { background: '#B8C9BB', text: '#1A2420' },
  peach: { background: '#E0C4B0', text: '#1A2420' },
  cream: { background: '#DCCFA8', text: '#1A2420' },
  clay: { background: '#D0C0B6', text: '#1A2420' },
  mustard: { background: '#C9963A', text: '#1A2420' },
  softForest: { background: '#A8BFAF', text: '#1A2420' },
};

export function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Stable tone for one id. When `peerIds` has 2–6 people, every person in that
 * set gets a distinct tone (so AvatarStack neighbours never match).
 */
export function avatarToneKeyForId(id: string, peerIds?: readonly string[]): AvatarToneKey {
  const peers = peerIds && peerIds.length > 0 ? [...new Set(peerIds)] : [id];
  if (peers.length <= 1 || peers.length > AVATAR_TONE_KEYS.length) {
    return AVATAR_TONE_KEYS[hashId(id) % AVATAR_TONE_KEYS.length];
  }
  const sorted = [...peers].sort();
  const used = new Set<AvatarToneKey>();
  const byId = new Map<string, AvatarToneKey>();
  for (const peer of sorted) {
    const preferred = hashId(peer) % AVATAR_TONE_KEYS.length;
    let chosen = AVATAR_TONE_KEYS[preferred];
    for (let offset = 0; offset < AVATAR_TONE_KEYS.length; offset += 1) {
      const candidate = AVATAR_TONE_KEYS[(preferred + offset) % AVATAR_TONE_KEYS.length];
      if (!used.has(candidate)) {
        chosen = candidate;
        break;
      }
    }
    used.add(chosen);
    byId.set(peer, chosen);
  }
  return byId.get(id) ?? AVATAR_TONE_KEYS[hashId(id) % AVATAR_TONE_KEYS.length];
}

export function avatarToneForId(
  id: string,
  scheme: 'light' | 'dark',
  peerIds?: readonly string[],
): AvatarTone {
  const key = avatarToneKeyForId(id, peerIds);
  return scheme === 'dark' ? avatarTonesDark[key] : avatarTonesLight[key];
}
