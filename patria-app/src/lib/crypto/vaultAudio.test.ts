// SECURITY REVIEW REQUIRED
import { randomKey32 } from './random';
import {
  openVaultAudio,
  padVaultAudio,
  sealVaultAudio,
  shouldStopVaultRecording,
  unpadVaultAudio,
  VAULT_AUDIO_MAX_SECONDS,
  VAULT_AUDIO_PAD_BLOCK,
} from './vaultAudio';

const AAD = {
  familySpaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  entryId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  audioId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};

describe('vault audio', () => {
  it('pads plaintext to the next 256 KB', () => {
    const plain = new Uint8Array([1, 2, 3, 4]);
    const padded = padVaultAudio(plain);
    expect(padded.length).toBe(VAULT_AUDIO_PAD_BLOCK);
    expect(unpadVaultAudio(padded)).toEqual(plain);
  });

  it('round-trips and fails closed on a wrong AAD or a tampered byte', () => {
    const plain = new Uint8Array([9, 8, 7, 6, 5]);
    const sealed = sealVaultAudio(plain, AAD);
    expect(openVaultAudio(sealed.fileKey, sealed.nonce, sealed.ciphertext, AAD)).toEqual(plain);
    expect(() =>
      openVaultAudio(sealed.fileKey, sealed.nonce, sealed.ciphertext, {
        ...AAD,
        audioId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      }),
    ).toThrow('unwrap failed');
    const tampered = new Uint8Array(sealed.ciphertext);
    tampered[0] = tampered[0] ^ 1;
    expect(() => openVaultAudio(sealed.fileKey, sealed.nonce, tampered, AAD)).toThrow(
      'unwrap failed',
    );
    const otherKey = randomKey32();
    expect(() => openVaultAudio(otherKey, sealed.nonce, sealed.ciphertext, AAD)).toThrow(
      'unwrap failed',
    );
  });

  it('stops recording at five minutes', () => {
    expect(shouldStopVaultRecording(VAULT_AUDIO_MAX_SECONDS - 1)).toBe(false);
    expect(shouldStopVaultRecording(VAULT_AUDIO_MAX_SECONDS)).toBe(true);
    expect(shouldStopVaultRecording(VAULT_AUDIO_MAX_SECONDS + 12)).toBe(true);
  });
});
