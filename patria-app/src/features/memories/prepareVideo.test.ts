import { videoLimitError } from './videoLimits';

describe('video limits', () => {
  it('refuses videos longer than a minute or larger than 50 MB', () => {
    expect(videoLimitError(61, 10)).toBe('video-too-long');
    expect(videoLimitError(30, 50 * 1024 * 1024 + 1)).toBe('video-too-big');
    expect(videoLimitError(12, 1024)).toBeNull();
  });

  it('refuses a missing duration instead of guessing', () => {
    expect(videoLimitError(null, 10)).toBe('video-no-duration');
    expect(videoLimitError(0, 10)).toBe('video-no-duration');
  });
});
