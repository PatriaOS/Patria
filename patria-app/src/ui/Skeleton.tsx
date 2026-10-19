import { StyleSheet, View } from 'react-native';

import { radius } from '../theme/tokens';
import { useTheme } from '../theme';
import { decorativeA11y } from './a11y';

type Props = {
  width?: number | `${number}%`;
  height?: number;
  circle?: boolean;
};

export function Skeleton({ width = '100%', height = 16, circle = false }: Props) {
  const { colors } = useTheme();
  return (
    <View
      {...decorativeA11y}
      style={[
        styles.block,
        {
          width,
          height,
          borderRadius: circle ? radius.avatar : radius.tile,
          backgroundColor: colors.softSurface,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden',
  },
});
