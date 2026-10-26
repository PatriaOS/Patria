import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import { testIdFromLabel } from '../../lib/testId';
import { ChoiceChip, Small } from '../../ui';
import { space } from '../../theme/tokens';
import type { PersonLookup } from './syncLabels';

/** `user:<id>` or `child:<id>`; `null` for nobody. */
export type PersonKey = string;

export function personOptions(people: PersonLookup): { key: PersonKey; label: string }[] {
  return [
    ...people.members.map((member) => ({ key: `user:${member.userId}`, label: member.displayName })),
    ...people.children.map((child) => ({ key: `child:${child.id}`, label: child.displayName })),
  ];
}

export function splitPersonKey(key: PersonKey | null): { userId: string | null; childId: string | null } {
  if (key?.startsWith('user:')) {
    return { userId: key.slice(5), childId: null };
  }
  if (key?.startsWith('child:')) {
    return { userId: null, childId: key.slice(6) };
  }
  return { userId: null, childId: null };
}

type Props = {
  label: string;
  options: { key: PersonKey; label: string }[];
  value: PersonKey | null;
  onChange: (key: PersonKey | null) => void;
};

export function PersonChips({ label, options, value, onChange }: Props) {
  return (
    <>
      <Small tone="muted">{label}</Small>
      <View style={styles.chips}>
        <ChoiceChip
          label={copy.sync.noOne}
          testID={`${label.toLowerCase()}-no-one`}
          selected={value === null}
          onPress={() => onChange(null)}
        />
        {options.map((option) => (
          <ChoiceChip
            key={option.key}
            label={option.label}
            testID={`${testIdFromLabel(label)}-${testIdFromLabel(option.label)}`}
            accessibilityLabel={`${label}: ${option.label}`}
            selected={value === option.key}
            onPress={() => onChange(option.key)}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
});
