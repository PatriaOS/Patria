import { Image } from 'expo-image';
import { Play } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { decorativeA11y } from './a11y';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { Caption } from './Text';

type Props = {
  uri?: string;
  /** Bundled asset from `require(...)` when a remote signed URL is not available. */
  source?: number;
  accessibilityLabel: string;
  onPress?: () => void;
  durationLabel?: string;
  /** Tile edge length; On this day uses 88. */
  size?: number;
  testID?: string;
};

export function PhotoTile({
  uri,
  source,
  accessibilityLabel,
  onPress,
  durationLabel,
  size = 108,
  testID,
}: Props) {
  const { colors } = useTheme();
  const inner = (
    <View
      testID={testID}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          backgroundColor: colors.softSurface,
        },
      ]}
    >
      {source != null ? (
        <Image source={source} style={styles.image} contentFit="cover" {...decorativeA11y} />
      ) : uri ? (
        <Image source={{ uri }} style={styles.image} contentFit="cover" {...decorativeA11y} />
      ) : (
        <View style={styles.image} {...decorativeA11y} />
      )}
      {durationLabel ? (
        <View style={[styles.badge, { backgroundColor: colors.heroCard }]} {...decorativeA11y}>
          <Icon icon={Play} name="play" color={colors.heroCardText} size={12} decorative />
          <Caption color={colors.heroCardText}>{durationLabel}</Caption>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) {
    return inner;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.tile,
    overflow: 'hidden',
    flexShrink: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    left: space.xs,
    bottom: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
  },
});
