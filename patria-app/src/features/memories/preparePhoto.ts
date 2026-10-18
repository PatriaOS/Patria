import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';

import { jpegHasGps } from './jpegGps';
import { PHOTO_MAX_BYTES } from './sourceHash';

export const FULL_LONG_EDGE = 2048;
export const THUMB_LONG_EDGE = 400;

export type PickedPhoto = {
  uri: string;
  width?: number;
  height?: number;
  exif?: Record<string, unknown> | null;
};

export type PreparedPhoto = {
  fullUri: string;
  thumbUri: string;
  width: number;
  height: number;
  takenAt: string;
  fullBytes: Uint8Array;
  originalBytes: Uint8Array;
};

export function resizeForLongEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const long = Math.max(safeWidth, safeHeight);
  if (long <= maxEdge) {
    return { width: safeWidth, height: safeHeight };
  }
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function exifString(exif: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = exif?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function takenAtFromExif(
  exif: Record<string, unknown> | null | undefined,
  fallback: Date,
): Date {
  const raw = exifString(exif, 'DateTimeOriginal') ?? exifString(exif, 'DateTime');
  if (!raw) {
    return fallback;
  }
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    return fallback;
  }
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

async function bytesFromUri(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function preparePhoto(
  photo: PickedPhoto,
  now: Date = new Date(),
): Promise<PreparedPhoto> {
  const sourceWidth = photo.width && photo.width > 0 ? photo.width : FULL_LONG_EDGE;
  const sourceHeight = photo.height && photo.height > 0 ? photo.height : FULL_LONG_EDGE;
  const takenAt = takenAtFromExif(photo.exif, now).toISOString();
  const originalBytes = await bytesFromUri(photo.uri);
  if (/^https?:\/\//i.test(photo.uri)) {
    if (jpegHasGps(originalBytes)) {
      throw new Error('location-not-stripped');
    }
    if (originalBytes.byteLength > PHOTO_MAX_BYTES) {
      throw new Error('photo-too-big');
    }
    return {
      fullUri: photo.uri,
      thumbUri: photo.uri,
      width: sourceWidth,
      height: sourceHeight,
      takenAt,
      fullBytes: originalBytes,
      originalBytes,
    };
  }
  const fullSize = resizeForLongEdge(sourceWidth, sourceHeight, FULL_LONG_EDGE);
  const full = await manipulateAsync(photo.uri, [{ resize: fullSize }], {
    compress: 0.82,
    format: SaveFormat.JPEG,
  });
  const thumbSize = resizeForLongEdge(full.width, full.height, THUMB_LONG_EDGE);
  const thumb = await manipulateAsync(full.uri, [{ resize: thumbSize }], {
    compress: 0.7,
    format: SaveFormat.JPEG,
  });
  const fullBytes = await bytesFromUri(full.uri);
  if (jpegHasGps(fullBytes)) {
    throw new Error('location-not-stripped');
  }
  if (fullBytes.byteLength > PHOTO_MAX_BYTES) {
    throw new Error('photo-too-big');
  }
  return {
    fullUri: full.uri,
    thumbUri: thumb.uri,
    width: full.width,
    height: full.height,
    takenAt,
    fullBytes,
    originalBytes,
  };
}
