import { scanVideoLocation } from './videoGps';
import { videoLimitError } from './videoLimits';
import { prepareVideoThumb } from './videoThumb';

export type PreparedVideo = {
  fullUri: string;
  thumbUri: string;
  width: number;
  height: number;
  takenAt: string;
  durationSeconds: number;
  fullBytes: Uint8Array;
  contentType: 'video/mp4' | 'video/quicktime';
};

async function bytesFromUri(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  return new Uint8Array(await response.arrayBuffer());
}

export async function prepareVideo(input: {
  uri: string;
  width?: number;
  height?: number;
  durationSeconds: number | null;
  mimeType?: string | null;
  takenAt?: string;
}): Promise<PreparedVideo> {
  const fullBytes = await bytesFromUri(input.uri);
  const durationSeconds = input.durationSeconds;
  const limit = videoLimitError(durationSeconds, fullBytes.byteLength);
  if (limit || durationSeconds == null) {
    throw new Error(limit ?? 'video-no-duration');
  }
  const location = scanVideoLocation(fullBytes);
  if (location === 'has_location') {
    throw new Error('video-has-location');
  }
  if (location === 'unparsed') {
    throw new Error('video-unparsed');
  }
  const thumbUri = await prepareVideoThumb({
    uri: input.uri,
    durationSeconds,
    width: input.width,
    height: input.height,
  });
  const contentType =
    input.mimeType === 'video/quicktime' || input.uri.toLowerCase().endsWith('.mov')
      ? 'video/quicktime'
      : 'video/mp4';
  return {
    fullUri: input.uri,
    thumbUri,
    width: input.width && input.width > 0 ? input.width : 16,
    height: input.height && input.height > 0 ? input.height : 9,
    takenAt: input.takenAt ?? new Date().toISOString(),
    durationSeconds,
    fullBytes,
    contentType,
  };
}
