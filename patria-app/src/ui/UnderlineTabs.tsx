import { Pressable, StyleSheet, View } from 'react-native';

import { testIdFromLabel } from '../lib/testId';
import { space, stroke } from '../theme/tokens';
import { useTheme } from '../theme';
import { Small } from './Text';

export type UnderlineTab = {
  key: string;
  label: string;
};

type Props = {
  items: UnderlineTab[];
  selected: string;
  onSelect: (key: string) => void;
};

export function UnderlineTabs({ items, selected, onSelect }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {items.map((item) => {
        const isSelected = item.key === selected;
        return (
          <Pressable
            key={item.key}
            testID={testIdFromLabel(item.label)}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(item.key)}
            style={[
              styles.tab,
              { borderBottomColor: isSelected ? colors.accentTerracotta : 'transparent' },
            ]}
          >
            <Small tone={isSelected ? 'default' : 'muted'}>{item.label}</Small>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  tab: {
    minHeight: 44,
    justifyContent: 'center',
    paddingBottom: space.xxs,
    borderBottomWidth: stroke.progress,
  },
});
