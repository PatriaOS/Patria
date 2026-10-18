import { copy } from '../../lib/copy';

export function shareItemMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  if (raw.startsWith('already-shared:')) {
    return copy.memories.alreadyShared.replace('{circle}', raw.slice('already-shared:'.length));
  }
  if (raw === 'video-too-long') {
    return copy.memories.videoTooLong;
  }
  if (raw === 'video-too-big') {
    return copy.memories.videoTooBig;
  }
  if (raw === 'video-has-location') {
    return copy.memories.videoHasLocation;
  }
  if (raw === 'video-unparsed') {
    return copy.memories.videoUnparsed;
  }
  if (raw === 'photo-too-big') {
    return copy.memories.photoTooBig;
  }
  return copy.memories.itemFailed;
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null || totalSeconds < 0) {
    return '';
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return copy.memories.duration
    .replace('{minutes}', String(minutes))
    .replace('{seconds}', String(seconds).padStart(2, '0'));
}
