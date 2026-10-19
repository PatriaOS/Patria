import { Pressable, StyleSheet } from 'react-native';

import { testIdFromLabel } from '../lib/testId';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { Caption } from './Text';

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
};

export function ChoiceChip({ label, selected = false, onPress, testID, accessibilityLabel }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID ?? testIdFromLabel(label)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.softSurface,
          borderColor: selected ? colors.primary : colors.hairline,
        },
      ]}
    >
      <Caption color={selected ? colors.onPrimary : colors.text}>{label}</Caption>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.button,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
    justifyContent: 'center',
    flexShrink: 1,
  },
});
