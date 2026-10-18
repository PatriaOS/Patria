import * as ImagePicker from 'expo-image-picker';

import { loadE2ePickedPhotos } from './e2ePhotoSamples.blocked';
import { pickPhotos } from './pickPhotos';

const launch = ImagePicker.launchImageLibraryAsync as jest.MockedFunction<
  typeof ImagePicker.launchImageLibraryAsync
>;

describe('e2e photo samples gating', () => {
  const previous = process.env.EXPO_PUBLIC_E2E;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.EXPO_PUBLIC_E2E;
    } else {
      process.env.EXPO_PUBLIC_E2E = previous;
    }
    launch.mockClear();
    jest.dontMock('./e2ePhotoSamples.bundle');
    jest.resetModules();
  });

  it('throws when bundled samples are loaded without EXPO_PUBLIC_E2E=1', () => {
    delete process.env.EXPO_PUBLIC_E2E;
    expect(() => loadE2ePickedPhotos()).toThrow(/not available in this build/);
  });

  it('opens the system picker when the e2e flag is off', async () => {
    delete process.env.EXPO_PUBLIC_E2E;
    launch.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://picked.jpg', width: 10, height: 8 }],
    } as never);
    const picked = await pickPhotos();
    expect(launch).toHaveBeenCalled();
    expect(picked).toEqual([
      {
        uri: 'file://picked.jpg',
        width: 10,
        height: 8,
        exif: null,
        mediaType: 'photo',
        durationSeconds: null,
        assetId: null,
        fileSize: null,
        mimeType: null,
      },
    ]);
  });

  it('fails startup when sample photos load in a non-e2e build', () => {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_E2E = '';
      jest.doMock('./e2ePhotoSamples.bundle', () => ({
        loadE2ePickedPhotos: () => [{ uri: 'e2e://sample', width: 1, height: 1, exif: null }],
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gated = require('./e2ePhotoSamples') as typeof import('./e2ePhotoSamples');
      expect(() => gated.assertE2ePhotoSamplesGated()).toThrow(/reachable in a non-e2e build/);
    });
  });

  it('passes startup when the e2e flag is off and samples cannot load', () => {
    jest.isolateModules(() => {
      delete process.env.EXPO_PUBLIC_E2E;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gated = require('./e2ePhotoSamples') as typeof import('./e2ePhotoSamples');
      expect(() => gated.assertE2ePhotoSamplesGated()).not.toThrow();
    });
  });
});
