import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';

import { testIdFromLabel } from '../lib/testId';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { SheetModal } from './SheetModal';
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
        <Body style={styles.triggerLabel}>{selected?.label ?? ''}</Body>
        <Icon icon={ChevronDown} name="chevronDown" size={20} color={colors.textMuted} />
      </Pressable>
      {selected?.description ? <Caption tone="muted">{selected.description}</Caption> : null}

      <SheetModal
        visible={open}
        onClose={() => setOpen(false)}
        testID={sheetTestID}
        accessibilityLabel={label}
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
      </SheetModal>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  triggerLabel: {
    flex: 1,
  },
  option: {
    borderRadius: radius.tile,
    borderWidth: 1,
    padding: space.md,
    gap: space.xs,
    minHeight: 52,
  },
});
