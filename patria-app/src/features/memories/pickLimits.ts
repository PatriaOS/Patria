import type { PickedMedia } from './pickMedia';
import { videoLimitError } from './videoLimits';

export function pickerVideoLimitError(item: PickedMedia): string | null {
  if (item.mediaType !== 'video') {
    return null;
  }
  return videoLimitError(item.durationSeconds, item.fileSize ?? 0);
}

export function splitPickedByVideoLimits(items: PickedMedia[]): {
  kept: PickedMedia[];
  skips: Error[];
} {
  const kept: PickedMedia[] = [];
  const skips: Error[] = [];
  for (const item of items) {
    const code = pickerVideoLimitError(item);
    if (code) {
      skips.push(new Error(code));
      continue;
    }
    kept.push(item);
  }
  return { kept, skips };
}
