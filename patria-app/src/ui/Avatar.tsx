import { StyleSheet, View } from 'react-native';

import { avatarToneForId } from '../theme/avatarTone';
import { radius, space, stroke } from '../theme/tokens';
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
  /** Member or child id — picks a stable soft tone from the avatar palette. */
  id?: string;
  /** Other ids in the same family / stack (≤6 get distinct tones). */
  peerIds?: readonly string[];
  size?: number;
  decorative?: boolean;
  /** Thin ring matching the screen background (AvatarStack overlap). */
  ringColor?: string;
};

export function Avatar({
  name,
  id,
  peerIds,
  size = 36,
  decorative = false,
  ringColor,
}: AvatarProps) {
  const { colors, scheme } = useTheme();
  const initials = initialsFrom(name);
  const tone = id
    ? avatarToneForId(id, scheme, peerIds)
    : { background: colors.primary, text: colors.onPrimary };
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
          backgroundColor: tone.background,
          borderWidth: ringColor ? stroke.hairline + 1 : 0,
          borderColor: ringColor ?? 'transparent',
        },
      ]}
    >
      <Caption color={tone.text}>{initials}</Caption>
    </View>
  );
}

export type AvatarPerson = {
  id: string;
  name: string;
};

type StackProps = {
  /** Prefer people with ids so tones stay stable and distinct. */
  people?: AvatarPerson[];
  /** @deprecated Prefer `people`. Kept for gallery fixtures. */
  names?: string[];
  max?: number;
};

export function AvatarStack({ people, names, max = 4 }: StackProps) {
  const { colors } = useTheme();
  const list: AvatarPerson[] =
    people ??
    (names ?? []).map((name, index) => ({
      id: `name:${name}:${index}`,
      name,
    }));
  const shown = list.slice(0, max);
  const peerIds = list.map((person) => person.id);
  return (
    <View style={styles.stack} {...decorativeA11y}>
      {shown.map((person, index) => (
        <View
          key={person.id}
          style={[styles.stackItem, { marginLeft: index === 0 ? 0 : -space.xs }]}
        >
          <Avatar
            id={person.id}
            name={person.name}
            peerIds={peerIds}
            size={28}
            decorative
            ringColor={colors.background}
          />
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
