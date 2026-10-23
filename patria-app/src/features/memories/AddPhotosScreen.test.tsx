import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { AddPhotosScreen } from './AddPhotosScreen';
import { fetchUploaderCircles, uploadPreparedPhoto, uploadPreparedVideo } from './memoryApi';
import { pickMedia } from './pickMedia';
import { prepareVideo } from './prepareVideo';

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
}));

jest.mock('./pickMedia', () => ({
  pickMedia: jest.fn(async () => [
    {
      uri: 'file://a.jpg',
      width: 100,
      height: 80,
      exif: null,
      mediaType: 'photo',
      durationSeconds: null,
      assetId: 'PH:A',
      fileSize: 10,
      mimeType: 'image/jpeg',
    },
    {
      uri: 'file://b.jpg',
      width: 100,
      height: 80,
      exif: null,
      mediaType: 'photo',
      durationSeconds: null,
      assetId: 'PH:B',
      fileSize: 10,
      mimeType: 'image/jpeg',
    },
  ]),
}));

jest.mock('./sourceKey', () => ({
  getOrCreateSourceKey: jest.fn(async () => Uint8Array.from({ length: 32 }, (_, i) => i)),
}));

jest.mock('./memoryApi', () => ({
  fetchUploaderCircles: jest.fn(async () => [
    { id: 'hh', name: 'Household', kind: 'household' },
    { id: 'ext', name: 'Extended Family', kind: 'extended_family' },
    { id: 'me', name: 'Only Me', kind: 'only_me' },
  ]),
  uploadPreparedPhoto: jest.fn(async () => 'item'),
  uploadPreparedVideo: jest.fn(async () => 'vid'),
}));

jest.mock('./prepareVideo', () => ({
  prepareVideo: jest.fn(),
}));

jest.mock('./preparePhoto', () => ({
  preparePhoto: jest.fn(async () => ({
    fullUri: 'file://full.jpg',
    thumbUri: 'file://thumb.jpg',
    width: 100,
    height: 80,
    takenAt: '2024-05-01T08:30:00.000Z',
    fullBytes: new Uint8Array([0xff, 0xd8]),
    originalBytes: new Uint8Array([1, 2, 3]),
  })),
}));

describe('Add photos', () => {
  it('selects Household by default and explains the circle in plain words', async () => {
    const { findByTestId } = await renderScreen(<AddPhotosScreen />);
    expect(await findByTestId('video-limits')).toBeTruthy();
    await waitFor(() => {
      expect(pickMedia).toHaveBeenCalled();
    });
    expect(await findByTestId('circle-household-selected')).toBeTruthy();
    expect(await findByTestId('circle-extended_family')).toBeTruthy();
    expect(await findByTestId('circle-only_me')).toBeTruthy();
    expect(await findByTestId('circle-explanation')).toBeTruthy();
    expect(await findByTestId('picked-count')).toBeTruthy();
    await waitFor(() => {
      expect(fetchUploaderCircles).toHaveBeenCalled();
    });
  });

  it('offers Share after photos are picked', async () => {
    const { findByText } = await renderScreen(<AddPhotosScreen />);
    const share = await findByText(copy.memories.share);
    await fireEvent.press(share);
    await waitFor(() => {
      expect(share).toBeTruthy();
    });
  });

  it('refuses a long video as soon as the picker returns and keeps the photos', async () => {
    (pickMedia as jest.Mock).mockResolvedValue([
      {
        uri: 'file://a.jpg',
        width: 100,
        height: 80,
        exif: null,
        mediaType: 'photo',
        durationSeconds: null,
        assetId: 'PH:A',
        fileSize: 10,
        mimeType: 'image/jpeg',
      },
      {
        uri: 'file://clip.mp4',
        width: 640,
        height: 360,
        exif: null,
        mediaType: 'video',
        durationSeconds: 61,
        assetId: 'PH:V',
        fileSize: 1000,
        mimeType: 'video/mp4',
      },
    ]);
    const { findByText, findByTestId } = await renderScreen(<AddPhotosScreen />);
    expect(await findByText(copy.memories.skippedVideoTooLong)).toBeTruthy();
    expect(await findByTestId('picked-count')).toBeTruthy();
    expect(await findByText('1 selected')).toBeTruthy();
  });

  it('shows why a video was skipped and still uploads the photos', async () => {
    (pickMedia as jest.Mock).mockResolvedValue([
      {
        uri: 'file://a.jpg',
        width: 100,
        height: 80,
        exif: null,
        mediaType: 'photo',
        durationSeconds: null,
        assetId: 'PH:A',
        fileSize: 10,
        mimeType: 'image/jpeg',
      },
      {
        uri: 'file://clip.mp4',
        width: 640,
        height: 360,
        exif: null,
        mediaType: 'video',
        durationSeconds: 3,
        assetId: 'PH:V',
        fileSize: 1000,
        mimeType: 'video/mp4',
      },
    ]);
    (prepareVideo as jest.Mock).mockRejectedValue(new Error('video-too-long'));
    (uploadPreparedPhoto as jest.Mock).mockClear();
    (uploadPreparedVideo as jest.Mock).mockClear();
    const { findByText } = await renderScreen(<AddPhotosScreen />);
    await fireEvent.press(await findByText(copy.memories.share));
    expect(await findByText(copy.memories.skippedVideoTooLong)).toBeTruthy();
    await waitFor(() => {
      expect(uploadPreparedPhoto).toHaveBeenCalledTimes(1);
    });
    expect(uploadPreparedVideo).not.toHaveBeenCalled();
  });
});
