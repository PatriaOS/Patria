import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { space } from '../theme/tokens';
import { useTheme } from '../theme';
import { decorativeA11y } from './a11y';
import { Body, Title } from './Text';

type Props = {
  title: string;
  message?: string;
  action?: ReactNode;
  compact?: boolean;
};

function EmptyArt() {
  const { colors } = useTheme();
  return (
    <View testID="empty-state-art" {...decorativeA11y} style={styles.art} pointerEvents="none">
      <Svg width={120} height={72} viewBox="0 0 120 72" {...decorativeA11y}>
        <Circle cx="88" cy="20" r="12" fill={colors.accentMustard} />
        <Path
          d="M0 50C28 30 52 62 120 38V72H0Z"
          fill={colors.primary}
          opacity={0.28}
        />
        <Path d="M0 58C40 42 78 72 120 52V72H0Z" fill={colors.primary} />
      </Svg>
    </View>
  );
}

export function EmptyState({ title, message, action, compact = false }: Props) {
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      {compact ? null : <EmptyArt />}
      {compact ? <Body tone="muted">{title}</Body> : <Title>{title}</Title>}
      {message ? <Body tone="muted">{message}</Body> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
  compact: {
    paddingVertical: space.xs,
  },
  art: {
    marginBottom: space.xs,
  },
});
