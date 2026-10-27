import { Bell } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Caption, Icon, Pressable } from '../../ui';
import { useTheme } from '../../theme';
import { radius } from '../../theme/tokens';
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
      style={styles.hit}
    >
      <View style={styles.iconWrap}>
        <Icon icon={Bell} name="bell" color={colors.text} decorative />
        {badge ? (
          <View
            testID="home-needs-you-badge"
            style={[styles.badge, { backgroundColor: colors.accentTerracotta }]}
          >
            <Caption color={colors.onPrimary}>{badge}</Caption>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    position: 'relative',
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
});
