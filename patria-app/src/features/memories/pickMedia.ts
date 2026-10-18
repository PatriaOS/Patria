import * as ImagePicker from 'expo-image-picker';

import { durationSecondsFromPicker } from './durationFromPicker';
import { PICK_LIMIT } from './sourceHash';
import type { PickedPhoto } from './preparePhoto';

export type PickedMedia = PickedPhoto & {
  mediaType: 'photo' | 'video';
  durationSeconds: number | null;
  assetId: string | null;
  fileSize: number | null;
  mimeType: string | null;
};

export type PickerAssetInput = {
  uri: string;
  width: number;
  height: number;
  exif?: Record<string, unknown> | null;
  type?: string | null;
  mimeType?: string | null;
  duration?: number | null;
  assetId?: string | null;
  fileSize?: number | null;
};

export function fromPickerAsset(asset: PickerAssetInput): PickedMedia {
  const isVideo = asset.type === 'video' || (asset.mimeType ?? '').startsWith('video/');
  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    exif: asset.exif ?? null,
    mediaType: isVideo ? 'video' : 'photo',
    durationSeconds: isVideo ? durationSecondsFromPicker(asset.duration) : null,
    assetId: asset.assetId ?? null,
    fileSize: typeof asset.fileSize === 'number' ? asset.fileSize : null,
    mimeType: asset.mimeType ?? null,
  };
}

export async function pickMedia(): Promise<PickedMedia[] | 'cancelled'> {
  if (process.env.EXPO_PUBLIC_E2E === '1') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadE2ePickerAssets } = require('./e2ePhotoSamples.bundle') as typeof import('./e2ePhotoSamples.bundle');
    return loadE2ePickerAssets().map(fromPickerAsset);
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
  return result.assets.map(fromPickerAsset);
}

export async function pickPhotos(): Promise<PickedPhoto[] | 'cancelled'> {
  const picked = await pickMedia();
  if (picked === 'cancelled') {
    return 'cancelled';
  }
  return picked.filter((item) => item.mediaType === 'photo');
}
