import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { copy } from '../lib/copy';
import { ThemeProvider } from './ThemeProvider';
import { useHeirloomFonts } from './fonts';
import { light } from './tokens';

export function FontGateSplash() {
  return (
    <View
      style={styles.splash}
      accessibilityRole="progressbar"
      accessibilityLabel={copy.common.loading}
      testID="font-gate-splash"
    >
      <Text style={styles.wordmark}>{copy.appName}</Text>
    </View>
  );
}

export function FontGate({ children }: { children: ReactNode }) {
  const { ready, loaded } = useHeirloomFonts();
  return <ThemeProvider fontsReady={loaded}>{ready ? children : <FontGateSplash />}</ThemeProvider>;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: light.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    color: light.primary,
    fontSize: 36,
  },
});
