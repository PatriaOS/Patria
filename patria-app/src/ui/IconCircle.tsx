import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { decorativeA11y } from './a11y';
import { Icon } from './Icon';

type Props = {
  icon: LucideIcon;
  size?: number;
};

export function IconCircle({ icon, size = 44 }: Props) {
  const { colors } = useTheme();
  return (
    <View
      {...decorativeA11y}
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: radius.avatar,
          backgroundColor: colors.softSurface,
        },
      ]}
    >
      <Icon icon={icon} color={colors.primary} size={Math.round(size * 0.45)} decorative />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxs,
  },
});
