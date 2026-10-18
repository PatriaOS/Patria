const ISO6709_KEY = new TextEncoder().encode('com.apple.quicktime.location.ISO6709');
const XYZ = new Uint8Array([0xa9, 0x78, 0x79, 0x7a]);
const UDTA = new TextEncoder().encode('udta');
const META = new TextEncoder().encode('meta');
const KEYS = new TextEncoder().encode('keys');
const FTYP = new TextEncoder().encode('ftyp');
const MOOV = new TextEncoder().encode('moov');

const CONTAINERS = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'udta',
  'meta',
  'ilst',
  'moof',
  'traf',
]);

function eq(bytes: Uint8Array, at: number, needle: Uint8Array): boolean {
  if (at + needle.length > bytes.length) {
    return false;
  }
  for (let i = 0; i < needle.length; i += 1) {
    if (bytes[at + i] !== needle[i]) {
      return false;
    }
  }
  return true;
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function typeAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) {
    return false;
  }
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

export type VideoLocationScan = 'clean' | 'has_location' | 'unparsed';

function walk(bytes: Uint8Array, start: number, end: number, foundMoov: { value: boolean }): VideoLocationScan {
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = u32(bytes, offset);
    const kind = typeAt(bytes, offset + 4);
    let header = 8;
    let boxEnd: number;
    if (size32 === 1) {
      if (offset + 16 > end) {
        return 'unparsed';
      }
      const high = u32(bytes, offset + 8);
      const low = u32(bytes, offset + 12);
      if (high !== 0) {
        return 'unparsed';
      }
      header = 16;
      boxEnd = offset + low;
    } else if (size32 === 0) {
      boxEnd = end;
    } else {
      boxEnd = offset + size32;
    }
    if (boxEnd > end || boxEnd < offset + header) {
      return 'unparsed';
    }
    if (eq(bytes, offset + 4, FTYP)) {
      // container start
    }
    if (eq(bytes, offset + 4, MOOV)) {
      foundMoov.value = true;
    }
    const payloadStart = offset + header;
    const payload = bytes.subarray(payloadStart, boxEnd);
    if (eq(bytes, offset + 4, UDTA) || eq(bytes, offset + 4, XYZ) || kind === '©xyz') {
      if (contains(payload, XYZ) || contains(payload, ISO6709_KEY) || /[+-]\d+\.\d+[+-]\d+\.\d+/.test(
        String.fromCharCode(...payload.subarray(0, Math.min(payload.length, 256))),
      )) {
        return 'has_location';
      }
    }
    if (eq(bytes, offset + 4, KEYS) || eq(bytes, offset + 4, META)) {
      if (contains(payload, ISO6709_KEY) || contains(payload, XYZ)) {
        return 'has_location';
      }
    }
    if (CONTAINERS.has(kind) || eq(bytes, offset + 4, UDTA) || eq(bytes, offset + 4, META)) {
      const innerStart = kind === 'meta' ? payloadStart + 4 : payloadStart;
      const inner = walk(bytes, innerStart, boxEnd, foundMoov);
      if (inner !== 'clean') {
        return inner;
      }
    }
    offset = boxEnd;
  }
  return 'clean';
}

export function scanVideoLocation(bytes: Uint8Array): VideoLocationScan {
  if (bytes.length < 16) {
    return 'unparsed';
  }
  let hasFtyp = false;
  for (let i = 0; i + 8 <= Math.min(bytes.length, 64); i += 1) {
    if (eq(bytes, i, FTYP) || (i >= 4 && eq(bytes, i, FTYP))) {
      hasFtyp = true;
      break;
    }
  }
  if (!eq(bytes, 4, FTYP) && !hasFtyp) {
    return 'unparsed';
  }
  const foundMoov = { value: false };
  const result = walk(bytes, 0, bytes.length, foundMoov);
  if (result === 'has_location') {
    return 'has_location';
  }
  if (result === 'unparsed' || !foundMoov.value) {
    return 'unparsed';
  }
  return 'clean';
}

export function videoHasLocation(bytes: Uint8Array): boolean {
  return scanVideoLocation(bytes) !== 'clean';
}
