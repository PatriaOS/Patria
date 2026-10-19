import { copy } from '../../lib/copy';
import { splitPickedByVideoLimits } from './pickLimits';
import type { PickedMedia } from './pickMedia';
import { shareSkipSummary } from './shareMessages';
import { VIDEO_MAX_BYTES } from './sourceHash';

function photo(uri: string): PickedMedia {
  return {
    uri,
    width: 100,
    height: 80,
    exif: null,
    mediaType: 'photo',
    durationSeconds: null,
    assetId: null,
    fileSize: 10,
    mimeType: 'image/jpeg',
  };
}

function video(input: { durationSeconds: number | null; fileSize: number | null }): PickedMedia {
  return {
    uri: 'file://clip.mp4',
    width: 640,
    height: 360,
    exif: null,
    mediaType: 'video',
    durationSeconds: input.durationSeconds,
    assetId: null,
    fileSize: input.fileSize,
    mimeType: 'video/mp4',
  };
}

describe('picker video limits', () => {
  it('refuses a long or huge video immediately and keeps the other items', () => {
    const long = splitPickedByVideoLimits([
      photo('file://a.jpg'),
      video({ durationSeconds: 61, fileSize: 1000 }),
      photo('file://b.jpg'),
    ]);
    expect(long.kept.map((item) => item.uri)).toEqual(['file://a.jpg', 'file://b.jpg']);
    expect(shareSkipSummary(long.skips)).toBe(copy.memories.skippedVideoTooLong);

    const huge = splitPickedByVideoLimits([
      photo('file://a.jpg'),
      video({ durationSeconds: 14, fileSize: VIDEO_MAX_BYTES + 1 }),
    ]);
    expect(huge.kept).toEqual([photo('file://a.jpg')]);
    expect(huge.skips).toHaveLength(1);
    expect(huge.skips[0].message).toBe('video-too-big');
  });

  it('keeps a short video within the size limit', () => {
    const result = splitPickedByVideoLimits([
      photo('file://a.jpg'),
      video({ durationSeconds: 14, fileSize: 1000 }),
    ]);
    expect(result.skips).toHaveLength(0);
    expect(result.kept).toHaveLength(2);
  });
});
