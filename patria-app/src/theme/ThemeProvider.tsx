import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { parseAppearance, readAppearance, writeAppearance, type AppearanceChoice } from './appearance';
import { dark, fontFamilies, light, textScale, type Palette } from './tokens';

export type ResolvedScheme = 'light' | 'dark';

type ThemeValue = {
  scheme: ResolvedScheme;
  appearance: AppearanceChoice;
  setAppearance: (choice: AppearanceChoice) => void;
  colors: Palette;
  fontsReady: boolean;
  fontFamily: (role: keyof typeof fontFamilies) => string | undefined;
  previewScale: number;
  setPreviewScale: (scale: number) => void;
  previewScheme: ResolvedScheme | null;
  setPreviewScheme: (scheme: ResolvedScheme | null) => void;
  maxFontSizeMultiplier: number;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({
  children,
  fontsReady = true,
  initialAppearance = 'system',
  persist = true,
}: {
  children: ReactNode;
  fontsReady?: boolean;
  initialAppearance?: AppearanceChoice;
  persist?: boolean;
}) {
  const system = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [appearance, setAppearanceState] = useState<AppearanceChoice>(initialAppearance);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewScheme, setPreviewScheme] = useState<ResolvedScheme | null>(null);

  useEffect(() => {
    if (!persist) {
      return;
    }
    void readAppearance().then(setAppearanceState);
  }, [persist]);

  const setAppearance = useCallback(
    (choice: AppearanceChoice) => {
      const next = parseAppearance(choice);
      setAppearanceState(next);
      if (persist) {
        void writeAppearance(next);
      }
    },
    [persist],
  );

  const resolved: ResolvedScheme = previewScheme ?? (appearance === 'system' ? system : appearance);
  const palette = resolved === 'dark' ? dark : light;

  const value = useMemo<ThemeValue>(
    () => ({
      scheme: resolved,
      appearance,
      setAppearance,
      colors: palette,
      fontsReady,
      fontFamily: (role) => (fontsReady ? fontFamilies[role] : undefined),
      previewScale,
      setPreviewScale,
      previewScheme,
      setPreviewScheme,
      maxFontSizeMultiplier: textScale.maxFontSizeMultiplier,
    }),
    [appearance, fontsReady, palette, previewScale, previewScheme, resolved, setAppearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}
