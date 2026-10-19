import { Pressable, StyleSheet, View } from 'react-native';

import { Body, Muted, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { useTheme, type AppearanceChoice } from '../../theme';

const CHOICES: { key: AppearanceChoice; label: string }[] = [
  { key: 'system', label: copy.appearance.matchPhone },
  { key: 'light', label: copy.appearance.light },
  { key: 'dark', label: copy.appearance.dark },
];

export function AppearanceScreen() {
  const { appearance, setAppearance, colors } = useTheme();

  return (
    <Screen withHeader testID="screen-appearance" accessibilityLabel={copy.appearance.title}>
      <Title>{copy.appearance.title}</Title>
      <Body>{copy.appearance.body}</Body>
      {CHOICES.map((choice) => {
        const selected = appearance === choice.key;
        return (
          <Pressable
            key={choice.key}
            testID={`appearance-${choice.key}`}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={choice.label}
            onPress={() => setAppearance(choice.key)}
            style={[
              styles.row,
              { borderColor: selected ? colors.primary : colors.hairline, backgroundColor: colors.surface },
            ]}
          >
            <View
              style={[
                styles.radio,
                { borderColor: colors.primary },
                selected ? { backgroundColor: colors.primary } : null,
              ]}
            />
            <Muted>{choice.label}</Muted>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
});
