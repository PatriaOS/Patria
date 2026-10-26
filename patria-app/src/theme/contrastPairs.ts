import { type ContrastPair } from './contrast';
import { AVATAR_TONE_KEYS, avatarTonesDark, avatarTonesLight } from './avatarTone';
import { dark, light } from './tokens';

const AA = 4.5;
const AA_LARGE = 3;

export const contrastPairs: ContrastPair[] = [
  { name: 'light text on background', foreground: light.text, background: light.background, min: AA },
  { name: 'light text on surface', foreground: light.text, background: light.surface, min: AA },
  { name: 'light text on softSurface', foreground: light.text, background: light.softSurface, min: AA },
  { name: 'light muted on background', foreground: light.textMuted, background: light.background, min: AA },
  { name: 'light muted on surface', foreground: light.textMuted, background: light.surface, min: AA },
  { name: 'light muted on softSurface', foreground: light.textMuted, background: light.softSurface, min: AA },
  { name: 'light onPrimary on primary', foreground: light.onPrimary, background: light.primary, min: AA },
  { name: 'light primary on background', foreground: light.primary, background: light.background, min: AA },
  { name: 'light onMustard on mustard', foreground: light.onMustard, background: light.accentMustard, min: AA },
  { name: 'light terracotta on background (overline)', foreground: light.accentTerracotta, background: light.background, min: AA },
  { name: 'light terracotta on surface', foreground: light.accentTerracotta, background: light.surface, min: AA },
  { name: 'light terracotta on softSurface', foreground: light.accentTerracotta, background: light.softSurface, min: AA },
  { name: 'light hero text on hero', foreground: light.heroCardText, background: light.heroCard, min: AA },
  { name: 'light success text on background', foreground: light.successText, background: light.background, min: AA },
  { name: 'light danger on background', foreground: light.danger, background: light.background, min: AA },
  { name: 'light danger on surface', foreground: light.danger, background: light.surface, min: AA },
  { name: 'light onDanger on danger', foreground: light.onDanger, background: light.danger, min: AA },
  { name: 'light danger on dangerSoft', foreground: light.danger, background: light.dangerSoft, min: AA },
  { name: 'light display on background (large)', foreground: light.text, background: light.background, min: AA_LARGE },

  { name: 'dark text on background', foreground: dark.text, background: dark.background, min: AA },
  { name: 'dark text on surface', foreground: dark.text, background: dark.surface, min: AA },
  { name: 'dark text on softSurface', foreground: dark.text, background: dark.softSurface, min: AA },
  { name: 'dark text on tabBar', foreground: dark.text, background: dark.tabBar, min: AA },
  { name: 'dark muted on background', foreground: dark.textMuted, background: dark.background, min: AA },
  { name: 'dark muted on surface', foreground: dark.textMuted, background: dark.surface, min: AA },
  { name: 'dark onPrimary on primary', foreground: dark.onPrimary, background: dark.primary, min: AA },
  { name: 'dark primary on background', foreground: dark.primary, background: dark.background, min: AA },
  { name: 'dark onMustard on mustard', foreground: dark.onMustard, background: dark.accentMustard, min: AA },
  { name: 'dark terracotta on background', foreground: dark.accentTerracotta, background: dark.background, min: AA },
  { name: 'dark hero text on hero', foreground: dark.heroCardText, background: dark.heroCard, min: AA },
  { name: 'dark success text on background', foreground: dark.successText, background: dark.background, min: AA },
  { name: 'dark danger on background', foreground: dark.danger, background: dark.background, min: AA },
  { name: 'dark danger on surface', foreground: dark.danger, background: dark.surface, min: AA },
  { name: 'dark onDanger on dangerFill', foreground: dark.onDanger, background: dark.dangerFill, min: AA },
  { name: 'dark danger on dangerSoft', foreground: dark.danger, background: dark.dangerSoft, min: AA },

  { name: 'light kind win text on win bg', foreground: light.kindWinText, background: light.kindWinBg, min: AA },
  {
    name: 'light kind discuss text on discuss bg',
    foreground: light.kindDiscussText,
    background: light.kindDiscussBg,
    min: AA,
  },
  {
    name: 'light kind decide text on decide bg',
    foreground: light.kindDecideText,
    background: light.kindDecideBg,
    min: AA,
  },
  { name: 'light kind plan text on plan bg', foreground: light.kindPlanText, background: light.kindPlanBg, min: AA },
  { name: 'dark kind win text on win bg', foreground: dark.kindWinText, background: dark.kindWinBg, min: AA },
  {
    name: 'dark kind discuss text on discuss bg',
    foreground: dark.kindDiscussText,
    background: dark.kindDiscussBg,
    min: AA,
  },
  {
    name: 'dark kind decide text on decide bg',
    foreground: dark.kindDecideText,
    background: dark.kindDecideBg,
    min: AA,
  },
  { name: 'dark kind plan text on plan bg', foreground: dark.kindPlanText, background: dark.kindPlanBg, min: AA },

  ...AVATAR_TONE_KEYS.map(
    (key): ContrastPair => ({
      name: `light avatar ${key}`,
      foreground: avatarTonesLight[key].text,
      background: avatarTonesLight[key].background,
      min: AA,
    }),
  ),
  ...AVATAR_TONE_KEYS.map(
    (key): ContrastPair => ({
      name: `dark avatar ${key}`,
      foreground: avatarTonesDark[key].text,
      background: avatarTonesDark[key].background,
      min: AA,
    }),
  ),
];
