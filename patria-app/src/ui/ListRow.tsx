import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { testIdFromLabel } from '../lib/testId';
import { space } from '../theme/tokens';
import { useTheme } from '../theme';
import { Pressable } from './Pressable';
import { Body, Caption } from './Text';

type Props = {
  title: string;
  body?: string;
  onPress?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  testID?: string;
};

export function ListRow({ title, body, onPress, leading, trailing, testID }: Props) {
  const { colors } = useTheme();
  // VoiceOver / Maestro only see this label when the row is one accessible control;
  // include the subtitle so open dates and similar body text are reachable.
  const accessibilityLabel = body ? `${title}. ${body}` : title;
  const content = (
    <View style={[styles.row, { borderBottomColor: colors.hairline }]}>
      {leading}
      <View style={styles.copy}>
        <Body>{title}</Body>
        {body ? <Caption tone="muted">{body}</Caption> : null}
      </View>
      {trailing}
    </View>
  );

  if (!onPress) {
    return (
      <View
        testID={testID ?? testIdFromLabel(title)}
        accessibilityLabel={accessibilityLabel}
        accessible
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID ?? testIdFromLabel(title)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
});
