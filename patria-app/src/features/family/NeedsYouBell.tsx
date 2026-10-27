import { Bell } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Caption, Icon, Pressable } from '../../ui';
import { useTheme } from '../../theme';
import { radius, space } from '../../theme/tokens';
import { needsYouBadgeCount, needsYouBellLabel } from './needsYou';

type Props = {
  count: number;
  onPress: () => void;
};

export function NeedsYouBell({ count, onPress }: Props) {
  const { colors } = useTheme();
  const badge = needsYouBadgeCount(count);
  return (
    <Pressable
      testID="home-needs-you-bell"
      accessibilityRole="button"
      accessibilityLabel={needsYouBellLabel(count)}
      onPress={onPress}
      style={[styles.hit, { backgroundColor: colors.softSurface }]}
    >
      <Icon icon={Bell} color={colors.text} decorative />
      {badge ? (
        <View
          testID="home-needs-you-badge"
          style={[styles.badge, { backgroundColor: colors.accentTerracotta }]}
        >
          <Caption color={colors.onPrimary}>{badge}</Caption>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: space.xxs,
    right: space.xxs,
    minWidth: 18,
    height: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
});
