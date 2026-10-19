import { StyleSheet, View } from 'react-native';

import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { Caption } from './Text';

export type PillTone = 'neutral' | 'success' | 'wait' | 'danger';

type Props = {
  label: string;
  tone?: PillTone;
  testID?: string;
};

export function StatusPill({ label, tone = 'neutral', testID }: Props) {
  const { colors } = useTheme();
  const backgroundColor =
    tone === 'success'
      ? colors.softSurface
      : tone === 'danger'
        ? colors.dangerSoft
        : tone === 'wait'
          ? colors.softSurface
          : colors.softSurface;
  const textTone = tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'muted';

  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <Caption testID={testID} tone={textTone}>
        {label}
      </Caption>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
});
