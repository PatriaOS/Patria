import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';
import { decorativeA11y } from './a11y';

export function Divider() {
  const { colors } = useTheme();
  return <View {...decorativeA11y} style={[styles.line, { backgroundColor: colors.hairline }]} />;
}

const styles = StyleSheet.create({
  line: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
});
