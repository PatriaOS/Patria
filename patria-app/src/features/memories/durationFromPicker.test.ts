import { durationSecondsFromPicker } from './durationFromPicker';
import { fromPickerAsset } from './pickMedia';
import { videoLimitError } from './videoLimits';

describe('picker video duration', () => {
  it('always treats picker duration as milliseconds', () => {
    expect(durationSecondsFromPicker(900)).toBe(1);
    expect(durationSecondsFromPicker(3000)).toBe(3);
    expect(durationSecondsFromPicker(14000)).toBe(14);
    expect(durationSecondsFromPicker(59000)).toBe(59);
    expect(durationSecondsFromPicker(61000)).toBe(61);
    expect(durationSecondsFromPicker(1_200_000)).toBe(1200);
  });

  it('refuses a missing or zero duration instead of guessing', () => {
    expect(durationSecondsFromPicker(null)).toBeNull();
    expect(durationSecondsFromPicker(undefined)).toBeNull();
    expect(durationSecondsFromPicker(0)).toBeNull();
    expect(durationSecondsFromPicker(Number.NaN)).toBeNull();
  });

  it('passes short clips and refuses over a minute after normalizing', () => {
    expect(videoLimitError(durationSecondsFromPicker(900), 1024)).toBeNull();
    expect(videoLimitError(durationSecondsFromPicker(3000), 1024)).toBeNull();
    expect(videoLimitError(durationSecondsFromPicker(14000), 1024)).toBeNull();
    expect(videoLimitError(durationSecondsFromPicker(59000), 1024)).toBeNull();
    expect(videoLimitError(durationSecondsFromPicker(61000), 1024)).toBe('video-too-long');
    expect(videoLimitError(durationSecondsFromPicker(1_200_000), 1024)).toBe('video-too-long');
    expect(videoLimitError(durationSecondsFromPicker(null), 1024)).toBe('video-no-duration');
  });

  it('maps a picker-shaped sample (milliseconds) to stored seconds', () => {
    expect(
      fromPickerAsset({
        uri: 'file://sample.mp4',
        width: 640,
        height: 360,
        type: 'video',
        mimeType: 'video/mp4',
        duration: 2000,
      }).durationSeconds,
    ).toBe(2);
  });
});
