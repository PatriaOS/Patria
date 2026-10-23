import { Image, type ImageResolvedAssetSource } from 'react-native';

import type { PickerAssetInput } from './pickMedia';
import type { PickedPhoto } from './preparePhoto';

function requiredAsset(source: ImageResolvedAssetSource | undefined): ImageResolvedAssetSource {
  if (!source) {
    throw new Error('E2E photo samples are not available in this build.');
  }
  return source;
}

export function loadE2ePickedPhotos(): PickedPhoto[] {
  if (process.env.EXPO_PUBLIC_E2E !== '1') {
    throw new Error('E2E photo samples are not available in this build.');
  }
  const first = requiredAsset(Image.resolveAssetSource(require('../../../assets/e2e/sample1.jpg')));
  const second = requiredAsset(Image.resolveAssetSource(require('../../../assets/e2e/sample2.jpg')));
  return [
    { uri: first.uri, width: first.width, height: first.height, exif: null },
    { uri: second.uri, width: second.width, height: second.height, exif: null },
  ];
}

export function loadE2ePickerAssets(): PickerAssetInput[] {
  const photos = loadE2ePickedPhotos().map((photo) => ({
    uri: photo.uri,
    width: photo.width ?? 1,
    height: photo.height ?? 1,
    exif: photo.exif,
    type: 'image' as const,
    mimeType: 'image/jpeg',
    duration: null,
    assetId: null,
    fileSize: null,
  }));
  const video = requiredAsset(Image.resolveAssetSource(require('../../../assets/e2e/sample.mp4')));
  return [
    ...photos,
    {
      uri: video.uri,
      width: video.width || 640,
      height: video.height || 360,
      exif: null,
      type: 'video',
      mimeType: 'video/mp4',
      duration: 2000,
      assetId: null,
      fileSize: null,
    },
  ];
}
