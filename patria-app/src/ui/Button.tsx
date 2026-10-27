import { ActivityIndicator, StyleSheet } from 'react-native';

import { testIdFromLabel } from '../lib/testId';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { useCardTone } from './CardTone';
import { Pressable } from './Pressable';
import { AppText } from './Text';

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'danger' | 'secondary';

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  /** Outline buttons on a hero card use the hero text color so they stay readable. */
  onHero?: boolean;
  /** Shorter padding for side-by-side hero actions (Home Sync card). */
  compact?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

export function Button({
  label,
  onPress,
  variant,
  disabled = false,
  busy = false,
  onHero,
  compact = false,
  accessibilityHint,
  testID,
}: Props) {
  const { colors, fontFamily } = useTheme();
  const card = useCardTone();
  const resolvedVariant = variant ?? card?.buttonVariant ?? 'primary';
  const resolvedOnHero = onHero ?? card?.onHero ?? false;
  const inactive = disabled || busy;
  const outline = resolvedVariant === 'ghost' || resolvedVariant === 'secondary';
  const fill =
    resolvedVariant === 'accent'
      ? colors.accentMustard
      : resolvedVariant === 'danger'
        ? colors.dangerFill
        : outline
          ? 'transparent'
          : colors.primary;
  const labelColor =
    resolvedVariant === 'accent'
      ? colors.onMustard
      : resolvedVariant === 'danger'
        ? colors.onDanger
        : outline
          ? resolvedOnHero
            ? colors.heroCardText
            : colors.primary
          : colors.onPrimary;
  const outlineColor = resolvedOnHero ? colors.heroCardText : colors.primary;

  return (
    <Pressable
      testID={testID ?? testIdFromLabel(label)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.compact : null,
        {
          backgroundColor: fill,
          borderColor: outline ? outlineColor : fill,
          borderWidth: outline ? 1 : 0,
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <AppText role="body" color={labelColor} style={[styles.label, { fontFamily: fontFamily('bodyMedium') }]}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.button,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  label: {
    textAlign: 'center',
  },
});
