import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { Body } from './Text';

export type BannerTone = 'info' | 'warning' | 'danger';

type Props = {
  message: string;
  tone?: BannerTone;
  action?: ReactNode;
};

export function Banner({ message, tone = 'info', action }: Props) {
  const { colors } = useTheme();
  const backgroundColor =
    tone === 'danger' ? colors.dangerSoft : tone === 'warning' ? colors.softSurface : colors.softSurface;
  const textTone = tone === 'danger' ? 'danger' : tone === 'warning' ? 'terracotta' : 'default';

  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor, borderColor: colors.hairline }]}
    >
      <Body tone={textTone} style={styles.copy}>
        {message}
      </Body>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: space.card,
    gap: space.sm,
  },
  copy: {
    flexShrink: 1,
  },
});
