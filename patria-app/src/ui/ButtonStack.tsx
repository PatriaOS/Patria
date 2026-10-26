import { type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { space } from '../theme/tokens';

type Props = {
  children: ReactNode;
  /** Defaults to space.sm — D32 vertical gap between stacked buttons. */
  gap?: typeof space.sm | typeof space.md | typeof space.xs;
  style?: ViewStyle;
  testID?: string;
};

/** Vertical stack for full-width buttons. Prefer this over ad-hoc margins. */
export function ButtonStack({ children, gap = space.sm, style, testID }: Props) {
  return (
    <View testID={testID} style={[styles.stack, { gap }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    width: '100%',
  },
});
