import * as ImagePicker from 'expo-image-picker';

import { PICK_LIMIT } from './sourceHash';
import type { PickedPhoto } from './preparePhoto';

export type PickedMedia = PickedPhoto & {
  mediaType: 'photo' | 'video';
  durationSeconds: number | null;
  assetId: string | null;
  fileSize: number | null;
  mimeType: string | null;
};

export async function pickMedia(): Promise<PickedMedia[] | 'cancelled'> {
  if (process.env.EXPO_PUBLIC_E2E === '1') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadE2ePickedMedia } = require('./e2ePhotoSamples.bundle') as typeof import('./e2ePhotoSamples.bundle');
    return loadE2ePickedMedia();
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: PICK_LIMIT,
    exif: true,
    quality: 1,
    videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
    videoMaxDuration: 60,
  });
  if (result.canceled) {
    return 'cancelled';
  }
  return result.assets.map((asset) => {
    const isVideo = asset.type === 'video' || (asset.mimeType ?? '').startsWith('video/');
    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      exif: asset.exif ?? null,
      mediaType: isVideo ? 'video' : 'photo',
      durationSeconds: typeof asset.duration === 'number' ? Math.round(asset.duration) : null,
      assetId: asset.assetId ?? null,
      fileSize: typeof asset.fileSize === 'number' ? asset.fileSize : null,
      mimeType: asset.mimeType ?? null,
    };
  });
}

export async function pickPhotos(): Promise<PickedPhoto[] | 'cancelled'> {
  const picked = await pickMedia();
  if (picked === 'cancelled') {
    return 'cancelled';
  }
  return picked.filter((item) => item.mediaType === 'photo');
}
