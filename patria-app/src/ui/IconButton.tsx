import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { testIdFromLabel } from '../lib/testId';
import { useTheme } from '../theme';
import { Icon } from './Icon';

type Props = {
  icon: LucideIcon;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
};

export function IconButton({ icon, accessibilityLabel, onPress, testID, disabled = false }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID ?? testIdFromLabel(accessibilityLabel)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.hit,
        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      <Icon icon={icon} color={colors.text} decorative />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
