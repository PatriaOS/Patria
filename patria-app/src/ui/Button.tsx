import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { testIdFromLabel } from '../lib/testId';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { AppText } from './Text';

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'danger' | 'secondary';

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  accessibilityHint,
  testID,
}: Props) {
  const { colors, fontFamily } = useTheme();
  const inactive = disabled || busy;
  const outline = variant === 'ghost' || variant === 'secondary';
  const fill =
    variant === 'accent'
      ? colors.accentMustard
      : variant === 'danger'
        ? colors.dangerFill
        : outline
          ? 'transparent'
          : colors.primary;
  const labelColor =
    variant === 'accent'
      ? colors.onMustard
      : variant === 'danger'
        ? colors.onDanger
        : outline
          ? colors.primary
          : colors.onPrimary;

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
        {
          backgroundColor: fill,
          borderColor: outline ? colors.primary : fill,
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
  label: {
    textAlign: 'center',
  },
});
