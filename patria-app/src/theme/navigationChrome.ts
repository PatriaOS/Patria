import { useTheme } from './ThemeProvider';
import type { Palette } from './tokens';
import type { ResolvedScheme } from './ThemeProvider';

export function navigationChrome(colors: Palette, scheme: ResolvedScheme) {
  return {
    background: colors.background,
    statusBar: scheme === 'dark' ? ('light' as const) : ('dark' as const),
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.primary,
    headerTitleStyle: { color: colors.text },
    contentStyle: { backgroundColor: colors.background },
  };
}

export function useThemedStackOptions() {
  const { colors, scheme } = useTheme();
  const chrome = navigationChrome(colors, scheme);
  return {
    headerStyle: chrome.headerStyle,
    headerTintColor: chrome.headerTintColor,
    headerTitleStyle: chrome.headerTitleStyle,
    contentStyle: chrome.contentStyle,
    headerShadowVisible: false,
    headerBackTitle: '',
    headerBackButtonDisplayMode: 'minimal' as const,
  };
}
