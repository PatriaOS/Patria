import { type ReactNode } from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';

import { typeScale, type TypeRole } from '../theme/tokens';
import { useTheme } from '../theme';

export type TextTone = 'default' | 'muted' | 'primary' | 'danger' | 'success' | 'inverse' | 'terracotta';

type Props = {
  children: ReactNode;
  tone?: TextTone;
  color?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  numberOfLines?: number;
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'header' | 'text' | 'alert' | 'button';
};

function toneColor(
  tone: TextTone,
  colors: ReturnType<typeof useTheme>['colors'],
): string {
  switch (tone) {
    case 'muted':
      return colors.textMuted;
    case 'primary':
      return colors.primary;
    case 'danger':
      return colors.danger;
    case 'success':
      return colors.successText;
    case 'inverse':
      return colors.heroCardText;
    case 'terracotta':
      return colors.accentTerracotta;
    default:
      return colors.text;
  }
}

export function AppText({
  role,
  children,
  tone = 'default',
  color,
  style,
  testID,
  numberOfLines,
  accessible,
  accessibilityLabel,
  accessibilityRole,
}: Props & { role: TypeRole }) {
  const theme = useTheme();
  const spec = typeScale[role];
  return (
    <RNText
      testID={testID}
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      allowFontScaling
      maxFontSizeMultiplier={theme.maxFontSizeMultiplier}
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: theme.fontFamily(spec.font),
          fontSize: spec.size * theme.previewScale,
          letterSpacing: 'letterSpacing' in spec ? spec.letterSpacing : undefined,
          fontVariant: spec.font === 'display' || spec.font === 'displayItalic' ? ['lining-nums'] : undefined,
          color: color ?? toneColor(tone, theme.colors),
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

export function Display(props: Props) {
  return <AppText role="display" accessibilityRole="header" {...props} />;
}

export function DisplayItalic(props: Props) {
  return <AppText role="displayItalic" accessibilityRole="header" {...props} />;
}

export function Title(props: Props) {
  return <AppText role="title" accessibilityRole="header" {...props} />;
}

export function Section(props: Props) {
  return <AppText role="section" accessibilityRole="header" {...props} />;
}

export function Body(props: Props) {
  return <AppText role="body" {...props} />;
}

export function Muted(props: Props) {
  return <Body tone="muted" {...props} />;
}

export function Small(props: Props) {
  return <AppText role="small" {...props} />;
}

export function Caption(props: Props) {
  return <AppText role="caption" {...props} />;
}

export function Overline({ children, ...rest }: Props) {
  const label = typeof children === 'string' ? children.toUpperCase() : children;
  return <AppText role="overline" {...rest}>{label}</AppText>;
}
