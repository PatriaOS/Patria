import { StyleSheet, View } from 'react-native';

import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { decorativeA11y } from './a11y';
import { Caption } from './Text';

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

type AvatarProps = {
  name: string;
  size?: number;
  decorative?: boolean;
};

export function Avatar({ name, size = 36, decorative = false }: AvatarProps) {
  const { colors } = useTheme();
  const initials = initialsFrom(name);
  return (
    <View
      {...(decorative ? decorativeA11y : {})}
      accessibilityLabel={decorative ? undefined : name}
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: radius.avatar,
          backgroundColor: colors.primary,
        },
      ]}
    >
      <Caption color={colors.onPrimary}>{initials}</Caption>
    </View>
  );
}

type StackProps = {
  names: string[];
  max?: number;
};

export function AvatarStack({ names, max = 4 }: StackProps) {
  const shown = names.slice(0, max);
  return (
    <View style={styles.stack} {...decorativeA11y}>
      {shown.map((name, index) => (
        <View key={`${name}-${index}`} style={[styles.stackItem, { marginLeft: index === 0 ? 0 : -space.xs }]}>
          <Avatar name={name} size={28} decorative />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackItem: {
    borderRadius: radius.avatar,
  },
});
