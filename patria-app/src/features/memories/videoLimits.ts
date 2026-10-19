import { VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS } from './sourceHash';

export function videoLimitError(durationSeconds: number | null, byteLength: number): string | null {
  if (durationSeconds == null || durationSeconds < 1) {
    return 'video-no-duration';
  }
  if (durationSeconds > VIDEO_MAX_SECONDS) {
    return 'video-too-long';
  }
  if (byteLength > VIDEO_MAX_BYTES) {
    return 'video-too-big';
  }
  return null;
}
