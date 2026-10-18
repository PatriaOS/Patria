import { copy } from '../../lib/copy';

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

export function shareItemMessage(error: unknown): string {
  const raw = errorCode(error);
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
  if (raw === 'video-no-duration') {
    return copy.memories.videoNoDuration;
  }
  if (raw === 'photo-too-big') {
    return copy.memories.photoTooBig;
  }
  return copy.memories.itemFailed;
}

function skipSentence(raw: string): string {
  if (raw === 'video-too-long') {
    return copy.memories.skippedVideoTooLong;
  }
  if (raw.startsWith('already-shared:')) {
    return copy.memories.skippedOne
      .replace('{kind}', copy.memories.kindPhoto)
      .replace('{reason}', copy.memories.skipReasonAlreadyShared.replace('{circle}', raw.slice('already-shared:'.length)));
  }
  const kind =
    raw.startsWith('video-') ? copy.memories.kindVideo : raw.startsWith('photo-') ? copy.memories.kindPhoto : copy.memories.kindItem;
  const reason =
    raw === 'video-too-big'
      ? copy.memories.skipReasonTooBig
      : raw === 'video-has-location'
        ? copy.memories.skipReasonHasLocation
        : raw === 'video-unparsed'
          ? copy.memories.skipReasonUnparsed
          : raw === 'video-no-duration'
            ? copy.memories.skipReasonNoDuration
            : raw === 'photo-too-big'
              ? copy.memories.skipReasonPhotoTooBig
              : copy.memories.skipReasonFailed;
  return copy.memories.skippedOne.replace('{kind}', kind).replace('{reason}', reason);
}

export function shareSkipSummary(errors: unknown[]): string {
  if (errors.length === 0) {
    return '';
  }
  const sentences = errors.map((error) => skipSentence(errorCode(error)));
  if (sentences.length === 1) {
    return sentences[0];
  }
  return `${copy.memories.skippedMany.replace('{count}', String(sentences.length))} ${sentences.join(' ')}`;
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
