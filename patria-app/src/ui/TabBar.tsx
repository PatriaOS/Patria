import { CalendarHeart, Home, Images, Lock, Users } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { copy } from '../lib/copy';
import { testIdFromLabel } from '../lib/testId';
import { space, stroke } from '../theme/tokens';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { Caption } from './Text';

export const TAB_KEYS = ['home', 'memories', 'sync', 'vault', 'family'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

const ICONS = {
  home: Home,
  memories: Images,
  sync: CalendarHeart,
  vault: Lock,
  family: Users,
} as const;

const ICON_NAMES = {
  home: 'house',
  memories: 'images',
  sync: 'calendarHeart',
  vault: 'lock',
  family: 'users',
} as const;

export function homeTabAccessibilityLabel(noticeCount: number, selected: boolean): string {
  if (!selected && noticeCount > 0) {
    const template = noticeCount === 1 ? copy.tabs.homeNotice : copy.tabs.homeNotices;
    return template.replace('{count}', String(noticeCount));
  }
  return copy.tabs.home;
}

type Props = {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
  homeNoticeCount?: number;
};

export function TabBar({ active, onSelect, homeNoticeCount = 0 }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const showHomeNotice = homeNoticeCount > 0 && active !== 'home';

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.hairline,
          paddingBottom: Math.max(insets.bottom, space.xs),
        },
      ]}
    >
      {TAB_KEYS.map((key) => {
        const selected = key === active;
        const label = key === 'home' ? copy.tabs.home : copy.tabs[key];
        const accessibilityLabel =
          key === 'home' ? homeTabAccessibilityLabel(homeNoticeCount, selected) : label;
        const color = selected ? colors.primary : colors.textMuted;
        return (
          <Pressable
            key={key}
            testID={testIdFromLabel(label)}
            accessibilityRole="tab"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ selected }}
            onPress={() => onSelect(key)}
            style={styles.tab}
          >
            <View style={styles.iconWrap}>
              <Icon
                icon={ICONS[key]}
                name={ICON_NAMES[key]}
                color={color}
                decorative
              />
              {key === 'home' && showHomeNotice ? (
                <View
                  testID="home-tab-notice"
                  accessible={false}
                  style={[styles.dot, { backgroundColor: colors.accentTerracotta }]}
                />
              ) : null}
            </View>
            <Caption color={color}>{label}</Caption>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: stroke.hairline,
    paddingTop: space.xs,
    paddingHorizontal: space.xs,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  iconWrap: {
    width: 28,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
