import { createContext, useContext, type ReactNode } from 'react';

import type { Palette } from '../theme/tokens';
import type { ButtonVariant } from './Button';

/** Home Today card surfaces: green hero, white surface, warm sand. */
export type CardTone = 'hero' | 'surface' | 'warm';

export type CardToneColors = {
  background: string;
  border: string;
  /** Default title / body ink on this tone. */
  text: string;
  /** Muted / caption ink on this tone. */
  textMuted: string;
  /** Overline ink (mustard on hero, terracotta on warm, default text on surface). */
  overline: string;
  /** Filled CTA: mustard on hero/warm, primary green on surface. */
  buttonVariant: Extract<ButtonVariant, 'primary' | 'accent'>;
  /** Outline / ghost labels on hero use light on-hero ink. */
  onHero: boolean;
};

export function cardToneColors(tone: CardTone, colors: Palette): CardToneColors {
  if (tone === 'hero') {
    return {
      background: colors.heroCard,
      border: colors.heroCardBorder,
      text: colors.heroCardText,
      textMuted: colors.heroCardText,
      overline: colors.accentMustard,
      buttonVariant: 'accent',
      onHero: true,
    };
  }
  if (tone === 'warm') {
    return {
      background: colors.softSurface,
      border: colors.hairline,
      text: colors.text,
      textMuted: colors.textMuted,
      overline: colors.accentTerracotta,
      buttonVariant: 'accent',
      onHero: false,
    };
  }
  return {
    background: colors.surface,
    border: colors.hairline,
    text: colors.text,
    textMuted: colors.textMuted,
    overline: colors.textMuted,
    buttonVariant: 'primary',
    onHero: false,
  };
}

const CardToneContext = createContext<CardToneColors | null>(null);

export function CardToneProvider({
  value,
  children,
}: {
  value: CardToneColors;
  children: ReactNode;
}) {
  return <CardToneContext.Provider value={value}>{children}</CardToneContext.Provider>;
}

export function useCardTone(): CardToneColors | null {
  return useContext(CardToneContext);
}
