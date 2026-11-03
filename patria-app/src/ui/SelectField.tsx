import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { testIdFromLabel } from '../lib/testId';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { Pressable } from './Pressable';
import { Body, Caption, Small } from './Text';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  description: string;
  testID?: string;
};

type Props<T extends string> = {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  testID?: string;
  sheetTestID?: string;
};

/** Labelled select that opens a bottom sheet of labelled options. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  testID,
  sheetTestID,
}: Props<T>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <View style={styles.field}>
      <Small tone="muted">{label}</Small>
      <Pressable
        testID={testID ?? testIdFromLabel(label)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? ''}`}
        accessibilityHint={selected?.description}
        onPress={() => setOpen(true)}
        style={[
          styles.trigger,
          { backgroundColor: colors.surface, borderColor: colors.hairline },
        ]}
      >
        <Body>{selected?.label ?? ''}</Body>
      </Pressable>
      {selected?.description ? <Caption tone="muted">{selected.description}</Caption> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.root} testID={sheetTestID}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.hairline,
                paddingBottom: insets.bottom + space.md,
              },
            ]}
          >
            <Small tone="muted">{label}</Small>
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  testID={option.testID ?? testIdFromLabel(option.label)}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityHint={option.description}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={[
                    styles.option,
                    {
                      borderColor: isSelected ? colors.primary : colors.hairline,
                      backgroundColor: isSelected ? colors.softSurface : colors.surface,
                    },
                  ]}
                >
                  <Body>{option.label}</Body>
                  <Caption tone="muted">{option.description}</Caption>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: space.xs,
  },
  trigger: {
    borderRadius: radius.tile,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 52,
    justifyContent: 'center',
  },
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
  },
  sheet: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderTopWidth: 1,
    padding: space.card,
    gap: space.sm,
  },
  option: {
    borderRadius: radius.tile,
    borderWidth: 1,
    padding: space.md,
    gap: space.xs,
    minHeight: 52,
  },
});
