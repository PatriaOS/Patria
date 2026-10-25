import { contrastRatio } from './contrast';
import {
  AVATAR_TONE_KEYS,
  avatarToneForId,
  avatarToneKeyForId,
  avatarTonesDark,
  avatarTonesLight,
} from './avatarTone';

describe('avatarTone', () => {
  it('returns the same tone for the same id', () => {
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    expect(avatarToneKeyForId(id)).toBe(avatarToneKeyForId(id));
    expect(avatarToneForId(id, 'light')).toEqual(avatarToneForId(id, 'light'));
  });

  it('gives distinct tones to a family of six or fewer', () => {
    const ids = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444',
      '55555555-5555-5555-5555-555555555555',
      '66666666-6666-6666-6666-666666666666',
    ];
    const tones = ids.map((id) => avatarToneKeyForId(id, ids));
    expect(new Set(tones).size).toBe(6);
    for (let i = 1; i < tones.length; i += 1) {
      expect(tones[i]).not.toBe(tones[i - 1]);
    }
  });

  it('keeps a person stable when peers are present', () => {
    const peers = ['a', 'b', 'c', 'd'];
    expect(avatarToneKeyForId('b', peers)).toBe(avatarToneKeyForId('b', peers));
  });

  it('uses only known keys', () => {
    for (const key of AVATAR_TONE_KEYS) {
      expect(avatarTonesLight[key]).toBeTruthy();
      expect(avatarTonesDark[key]).toBeTruthy();
    }
  });
});

describe('avatarTone contrast', () => {
  it('meets 4.5:1 for initials on every light and dark tone', () => {
    for (const key of AVATAR_TONE_KEYS) {
      const light = avatarTonesLight[key];
      const dark = avatarTonesDark[key];
      expect(contrastRatio(light.text, light.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark.text, dark.background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
