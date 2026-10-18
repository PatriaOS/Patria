import { Image } from 'react-native';

import type { PickedMedia } from './pickMedia';
import type { PickedPhoto } from './preparePhoto';

export function loadE2ePickedPhotos(): PickedPhoto[] {
  if (process.env.EXPO_PUBLIC_E2E !== '1') {
    throw new Error('E2E photo samples are not available in this build.');
  }
  const first = Image.resolveAssetSource(require('../../../assets/e2e/sample1.jpg'));
  const second = Image.resolveAssetSource(require('../../../assets/e2e/sample2.jpg'));
  return [
    { uri: first.uri, width: first.width, height: first.height, exif: null },
    { uri: second.uri, width: second.width, height: second.height, exif: null },
  ];
}

export function loadE2ePickedMedia(): PickedMedia[] {
  const photos = loadE2ePickedPhotos().map((photo) => ({
    ...photo,
    mediaType: 'photo' as const,
    durationSeconds: null,
    assetId: null,
    fileSize: null,
    mimeType: 'image/jpeg',
  }));
  const video = Image.resolveAssetSource(require('../../../assets/e2e/sample.mp4'));
  return [
    ...photos,
    {
      uri: video.uri,
      width: video.width || 640,
      height: video.height || 360,
      exif: null,
      mediaType: 'video',
      durationSeconds: 2,
      assetId: null,
      fileSize: null,
      mimeType: 'video/mp4',
    },
  ];
}
