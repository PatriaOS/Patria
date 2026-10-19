import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { jpegHasGps } from './jpegGps';
import { THUMB_LONG_EDGE, resizeForLongEdge } from './preparePhoto';

/** Valid JPEG resized to thumb size so a failed frame is a flat matte, not a stretched speck. */
const PLACEHOLDER_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A8p+Cvwi8RfGvxuvgnw2LGwhtbKO7uru5tllEMWxATjG53d3AAyPcgCl+NXwi8RfBPxufBXiP7Dfw3dnJd2t3b2yxCWLY4Bxjcjo6YIye2CQaPgp8XfEPwT8cL418Oix1CC6so7S6tLi5SISxbEJGc7kdHTIOD7gg0vxr+L3iH42eOD418RCx0+C0spLS1tLe5SURRbHIGc7nd3fJOB2AAAryfe5vI/Jf9m+rdfaX+Vvy/U//2Q==';

export function thumbnailTimeMs(durationSeconds: number): number {
  return durationSeconds > 1 ? 1000 : 0;
}

async function placeholderThumbUri(): Promise<string> {
  const plain = await manipulateAsync(PLACEHOLDER_JPEG, [], { compress: 0.7, format: SaveFormat.JPEG });
  try {
    const height = Math.max(1, Math.round((THUMB_LONG_EDGE * 9) / 16));
    const sized = await manipulateAsync(
      plain.uri,
      [{ resize: { width: THUMB_LONG_EDGE, height } }],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
    return sized.uri;
  } catch {
    return plain.uri;
  }
}

function videoThumbnails(): typeof import('expo-video-thumbnails') | null {
  try {
    if (!requireOptionalNativeModule('ExpoVideoThumbnails')) {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-video-thumbnails');
  } catch {
    return null;
  }
}

async function bytesFromUri(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  return new Uint8Array(await response.arrayBuffer());
}

export async function prepareVideoThumb(input: {
  uri: string;
  durationSeconds: number;
  width?: number;
  height?: number;
}): Promise<string> {
  try {
    const thumbs = videoThumbnails();
    if (thumbs) {
      const shot = await thumbs.getThumbnailAsync(input.uri, {
        time: thumbnailTimeMs(input.durationSeconds),
        quality: 0.7,
      });
      const sourceWidth = shot.width > 0 ? shot.width : input.width && input.width > 0 ? input.width : THUMB_LONG_EDGE;
      const sourceHeight =
        shot.height > 0 ? shot.height : input.height && input.height > 0 ? input.height : Math.round((THUMB_LONG_EDGE * 9) / 16);
      const size = resizeForLongEdge(sourceWidth, sourceHeight, THUMB_LONG_EDGE);
      const jpeg = await manipulateAsync(shot.uri, [{ resize: size }], {
        compress: 0.7,
        format: SaveFormat.JPEG,
      });
      const bytes = await bytesFromUri(jpeg.uri);
      if (!jpegHasGps(bytes)) {
        return jpeg.uri;
      }
    }
  } catch {
    // Fall through to the designed placeholder.
  }
  return placeholderThumbUri();
}
