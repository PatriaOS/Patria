export type Palette = {
  background: string;
  surface: string;
  softSurface: string;
  tabBar: string;
  text: string;
  textMuted: string;
  hairline: string;
  primary: string;
  onPrimary: string;
  heroCard: string;
  heroCardText: string;
  heroCardBorder: string;
  accentTerracotta: string;
  accentMustard: string;
  onMustard: string;
  success: string;
  successText: string;
  danger: string;
  onDanger: string;
  dangerFill: string;
  dangerSoft: string;
  /** Agenda kind chips / row washes (GOV02). */
  kindWinBg: string;
  kindWinText: string;
  kindDiscussBg: string;
  kindDiscussText: string;
  kindDecideBg: string;
  kindDecideText: string;
  kindPlanBg: string;
  kindPlanText: string;
  /** Soft sage wash for kind hint cards. */
  sageSoft: string;
};

export const light: Palette = {
  background: '#F5F0E7',
  surface: '#FFFDF8',
  softSurface: '#F2E6D6',
  tabBar: '#FFFDF8',
  text: '#22302A',
  textMuted: '#5F645B',
  hairline: '#E3D9C8',
  primary: '#2F4A3A',
  onPrimary: '#F5F0E7',
  heroCard: '#2F4A3A',
  heroCardText: '#F5F0E7',
  heroCardBorder: '#2F4A3A',
  // #B5532F is 4.36:1 on linen; deepen so overlines stay AA on bg and soft cards.
  accentTerracotta: '#A84C2A',
  accentMustard: '#D9A441',
  onMustard: '#22302A',
  success: '#3F8A5F',
  successText: '#246644',
  danger: '#8C2F24',
  onDanger: '#F5F0E7',
  dangerFill: '#8C2F24',
  dangerSoft: '#F3DDD4',
  kindWinBg: '#DCE6DD',
  kindWinText: '#1F5538',
  kindDiscussBg: '#F3E4C0',
  kindDiscussText: '#5C470F',
  kindDecideBg: '#F2DCCB',
  kindDecideText: '#7A361C',
  kindPlanBg: '#EFE8DC',
  kindPlanText: '#4A5048',
  sageSoft: '#DCE6DD',
};

export const dark: Palette = {
  background: '#111A16',
  surface: '#18231E',
  softSurface: '#1D2A24',
  tabBar: '#0E1612',
  text: '#F1EADB',
  textMuted: '#A9B3A9',
  hairline: '#2A3832',
  primary: '#9CC7AA',
  onPrimary: '#0F1713',
  heroCard: '#1F3A2B',
  heroCardText: '#F1EADB',
  heroCardBorder: '#2C4C3A',
  accentTerracotta: '#E8896A',
  accentMustard: '#E3B65A',
  onMustard: '#1A1406',
  success: '#3F8A5F',
  successText: '#9CC7AA',
  danger: '#F0A090',
  onDanger: '#1A100C',
  dangerFill: '#E07A6A',
  dangerSoft: '#3A221C',
  kindWinBg: '#1E2E24',
  kindWinText: '#9CC7AA',
  kindDiscussBg: '#3A3218',
  kindDiscussText: '#E3B65A',
  kindDecideBg: '#3A2A22',
  kindDecideText: '#E8896A',
  kindPlanBg: '#1D2A24',
  kindPlanText: '#A9B3A9',
  sageSoft: '#24352C',
};

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  xxl: 48,
  screen: 24,
  card: 18,
  cardGap: 18,
} as const;

export const radius = {
  card: 22,
  tile: 14,
  pill: 14,
  button: 999,
  avatar: 999,
} as const;

export const stroke = {
  hairline: 1,
  progress: 2,
  icon: 1.5,
} as const;

export const fontFamilies = {
  display: 'CormorantGaramond_600SemiBold',
  displayItalic: 'CormorantGaramond_500Medium_Italic',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodyBold: 'Manrope_700Bold',
} as const;

export const typeScale = {
  display: { size: 36, line: 0.95, font: 'display' as const },
  displayItalic: { size: 36, line: 0.95, font: 'displayItalic' as const },
  title: { size: 23, line: 1.2, font: 'display' as const },
  section: { size: 21, line: 1.25, font: 'displayItalic' as const },
  body: { size: 15, line: 1.5, font: 'body' as const },
  small: { size: 13, line: 1.45, font: 'body' as const },
  caption: { size: 12, line: 1.4, font: 'body' as const },
  overline: { size: 10.5, line: 1.3, font: 'bodyBold' as const, letterSpacing: 1.68 },
} as const;

export type TypeRole = keyof typeof typeScale;

export const textScale = {
  allowFontScaling: true,
  maxFontSizeMultiplier: 1.3,
} as const;

export const FONT_LOAD_TIMEOUT_MS = 4000;

export const lightCardShadow = {
  shadowColor: '#22302A',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.05,
  shadowRadius: 24,
  elevation: 2,
} as const;

/** Legacy aliases so existing screens keep compiling until they move to `useTheme`. */
export const colors = {
  background: light.background,
  surface: light.surface,
  primary: light.primary,
  accent: light.accentTerracotta,
  text: light.text,
  textMuted: light.textMuted,
  onThisDay: light.softSurface,
  danger: light.danger,
  chip: light.softSurface,
  onPrimary: light.onPrimary,
} as const;

export const spacing = {
  xs: space.xxs,
  sm: space.xs,
  md: space.lg - 8,
  lg: space.lg,
  xl: space.xl,
  xxl: space.xxl,
} as const;

export const type = {
  heading: {
    fontFamily: fontFamilies.display,
    fontSize: typeScale.title.size,
  },
  body: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.body.size,
  },
  caption: {
    fontFamily: fontFamilies.body,
    fontSize: typeScale.caption.size,
  },
} as const;
