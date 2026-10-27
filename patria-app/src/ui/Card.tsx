import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { lightCardShadow, radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { CardToneProvider, cardToneColors, type CardTone } from './CardTone';
import { Pressable } from './Pressable';

/** @deprecated Prefer `tone`. Kept so existing screens keep compiling. */
export type CardVariant = 'default' | 'hero' | 'soft';

type Props = {
  children: ReactNode;
  /** Home Today rhythm: hero (green), surface (white), warm (sand). */
  tone?: CardTone;
  /** @deprecated Prefer `tone`. soft→warm, default→surface, hero→hero. */
  variant?: CardVariant;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

function toneFromVariant(variant: CardVariant): CardTone {
  if (variant === 'hero') {
    return 'hero';
  }
  if (variant === 'soft') {
    return 'warm';
  }
  return 'surface';
}

export function Card({
  children,
  tone,
  variant = 'default',
  onPress,
  accessibilityLabel,
  testID,
}: Props) {
  const { colors, scheme } = useTheme();
  const resolved = tone ?? toneFromVariant(variant);
  const toneColors = cardToneColors(resolved, colors);
  const frame = (
    <View
      testID={onPress ? undefined : testID}
      style={[
        styles.card,
        { backgroundColor: toneColors.background, borderColor: toneColors.border },
        resolved === 'surface' && scheme === 'light' ? lightCardShadow : null,
      ]}
    >
      <CardToneProvider value={toneColors}>{children}</CardToneProvider>
    </View>
  );

  if (!onPress) {
    return frame;
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
    >
      {frame}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    padding: space.card,
    gap: space.sm,
    borderWidth: 1,
  },
});
