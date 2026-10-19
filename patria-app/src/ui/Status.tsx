import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { space } from '../theme/tokens';
import { useTheme } from '../theme';
import { Body } from './Text';

const styles = StyleSheet.create({
  status: {
    gap: space.sm,
    alignItems: 'center',
    paddingVertical: space.lg,
  },
});

export function LoadingState({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.status} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator color={colors.primary} />
      <Body tone="muted">{message}</Body>
    </View>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Body tone="danger" accessibilityRole="alert">
      {message}
    </Body>
  );
}
