import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';

import { VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS } from './sourceHash';
import { scanVideoLocation } from './videoGps';

const BLANK_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A8p+Cvwi8RfGvxuvgnw2LGwhtbKO7uru5tllEMWxATjG53d3AAyPcgCl+NXwi8RfBPxufBXiP7Dfw3dnJd2t3b2yxCWLY4Bxjcjo6YIye2CQaPgp8XfEPwT8cL418Oix1CC6so7S6tLi5SISxbEJGc7kdHTIOD7gg0vxr+L3iH42eOD418RCx0+C0spLS1tLe5SURRbHIGc7nd3fJOB2AAAryfe5vI/Jf9m+rdfaX+Vvy/U//2Q==';

export type PreparedVideo = {
  fullUri: string;
  thumbUri: string;
  width: number;
  height: number;
  takenAt: string;
  durationSeconds: number;
  fullBytes: Uint8Array;
  contentType: 'video/mp4' | 'video/quicktime';
};

async function bytesFromUri(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  return new Uint8Array(await response.arrayBuffer());
}

export function videoLimitError(durationSeconds: number | null, byteLength: number): string | null {
  if (durationSeconds == null || durationSeconds < 1) {
    return 'video-no-duration';
  }
  if (durationSeconds > VIDEO_MAX_SECONDS) {
    return 'video-too-long';
  }
  if (byteLength > VIDEO_MAX_BYTES) {
    return 'video-too-big';
  }
  return null;
}

export async function prepareVideo(input: {
  uri: string;
  width?: number;
  height?: number;
  durationSeconds: number | null;
  mimeType?: string | null;
  takenAt?: string;
}): Promise<PreparedVideo> {
  const fullBytes = await bytesFromUri(input.uri);
  const durationSeconds = input.durationSeconds;
  const limit = videoLimitError(durationSeconds, fullBytes.byteLength);
  if (limit || durationSeconds == null) {
    throw new Error(limit ?? 'video-no-duration');
  }
  const location = scanVideoLocation(fullBytes);
  if (location === 'has_location') {
    throw new Error('video-has-location');
  }
  if (location === 'unparsed') {
    throw new Error('video-unparsed');
  }
  const thumb = await manipulateAsync(BLANK_JPEG, [], { compress: 0.7, format: SaveFormat.JPEG });
  const contentType =
    input.mimeType === 'video/quicktime' || input.uri.toLowerCase().endsWith('.mov')
      ? 'video/quicktime'
      : 'video/mp4';
  return {
    fullUri: input.uri,
    thumbUri: thumb.uri,
    width: input.width && input.width > 0 ? input.width : 16,
    height: input.height && input.height > 0 ? input.height : 9,
    takenAt: input.takenAt ?? new Date().toISOString(),
    durationSeconds,
    fullBytes,
    contentType,
  };
}
