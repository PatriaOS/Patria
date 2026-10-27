import { cardToneColors } from './CardTone';
import { dark, light } from '../theme/tokens';

describe('cardToneColors', () => {
  it('maps hero to green box and mustard CTA', () => {
    const tone = cardToneColors('hero', light);
    expect(tone.background).toBe(light.heroCard);
    expect(tone.text).toBe(light.heroCardText);
    expect(tone.buttonVariant).toBe('accent');
    expect(tone.onHero).toBe(true);
  });

  it('maps surface to white box and primary CTA', () => {
    const tone = cardToneColors('surface', light);
    expect(tone.background).toBe(light.surface);
    expect(tone.buttonVariant).toBe('primary');
    expect(tone.onHero).toBe(false);
  });

  it('maps warm to softSurface and mustard CTA', () => {
    const tone = cardToneColors('warm', dark);
    expect(tone.background).toBe(dark.softSurface);
    expect(tone.buttonVariant).toBe('accent');
    expect(tone.overline).toBe(dark.accentTerracotta);
  });
});
