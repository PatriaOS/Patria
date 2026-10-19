import { thumbnailTimeMs } from './videoThumb';

describe('video thumbnail time', () => {
  it('uses one second in, or the first frame for very short clips', () => {
    expect(thumbnailTimeMs(1)).toBe(0);
    expect(thumbnailTimeMs(2)).toBe(1000);
    expect(thumbnailTimeMs(14)).toBe(1000);
  });
});
