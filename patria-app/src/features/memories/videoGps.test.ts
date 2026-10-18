import { scanVideoLocation } from './videoGps';

function box(type: string, payload: Uint8Array): Uint8Array {
  const size = 8 + payload.length;
  const out = new Uint8Array(size);
  out[0] = (size >>> 24) & 0xff;
  out[1] = (size >>> 16) & 0xff;
  out[2] = (size >>> 8) & 0xff;
  out[3] = size & 0xff;
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('video location scan', () => {
  it('refuses bytes that are not a media file', () => {
    expect(scanVideoLocation(new Uint8Array([1, 2, 3, 4]))).toBe('unparsed');
  });

  it('finds ISO6709 in meta/keys and ©xyz in udta', () => {
    const ftyp = box('ftyp', new TextEncoder().encode('isom'));
    const keys = box('keys', new TextEncoder().encode('xxcom.apple.quicktime.location.ISO6709'));
    const meta = box('meta', concat(new Uint8Array(4), keys));
    const moov = box('moov', meta);
    expect(scanVideoLocation(concat(ftyp, moov))).toBe('has_location');

    const xyzPayload = new Uint8Array([0xa9, 0x78, 0x79, 0x7a, 0, 0, 0, 0, 43, 51, 46, 48]);
    const udta = box('udta', box('©xyz', xyzPayload));
    const moovXyz = box('moov', udta);
    expect(scanVideoLocation(concat(ftyp, moovXyz))).toBe('has_location');
  });

  it('treats a parsed file with no location atoms as clean', () => {
    const ftyp = box('ftyp', new TextEncoder().encode('isom'));
    const moov = box('moov', box('mvhd', new Uint8Array(12)));
    expect(scanVideoLocation(concat(ftyp, moov))).toBe('clean');
  });
});
