import { copy } from '../../lib/copy';
import { formatDuration, shareItemMessage, shareSkipSummary } from './shareMessages';

describe('share messages', () => {
  it('names the circle when the photo is already shared', () => {
    expect(shareItemMessage(new Error('already-shared:Household'))).toBe(
      copy.memories.alreadyShared.replace('{circle}', 'Household'),
    );
  });

  it('formats a video length for the tile', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  it('names a skipped video in a mixed batch', () => {
    expect(shareSkipSummary([new Error('video-too-long')])).toBe(copy.memories.skippedVideoTooLong);
  });
});
