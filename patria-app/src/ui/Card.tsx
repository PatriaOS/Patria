import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { lightCardShadow, radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { Pressable } from './Pressable';

export type CardVariant = 'default' | 'hero' | 'soft';

type Props = {
  children: ReactNode;
  variant?: CardVariant;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

export function Card({ children, variant = 'default', onPress, accessibilityLabel, testID }: Props) {
  const { colors, scheme } = useTheme();
  const backgroundColor =
    variant === 'hero' ? colors.heroCard : variant === 'soft' ? colors.softSurface : colors.surface;
  const borderColor = variant === 'hero' ? colors.heroCardBorder : colors.hairline;
  const frame = (
    <View
      testID={onPress ? undefined : testID}
      style={[
        styles.card,
        { backgroundColor, borderColor },
        variant === 'default' && scheme === 'light' ? lightCardShadow : null,
      ]}
    >
      {children}
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
