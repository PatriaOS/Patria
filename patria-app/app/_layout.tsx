import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';

import { assertE2ePhotoSamplesGated } from '../src/features/memories/e2ePhotoSamples';
import { AuthProvider } from '../src/lib/auth-context';
import { hiddenRootHeader, pushedScreenHeader, screenTitles } from '../src/lib/navigation';
import { queryClient } from '../src/lib/queryClient';
import { colors, FontGate, useTheme, useThemedStackOptions } from '../src/theme';

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

function ThemedRootStack() {
  const { colors: palette } = useTheme();
  const chrome = useThemedStackOptions();
  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <ThemedStatusBar />
      <Stack
        screenOptions={{
          ...hiddenRootHeader,
          ...chrome,
        }}
      >
        <Stack.Screen name="index" options={{ title: screenTitles.home }} />
        <Stack.Screen
          name="(signed-out)"
          options={{ ...hiddenRootHeader, title: screenTitles.home }}
        />
        <Stack.Screen
          name="(signed-in)"
          options={{ ...hiddenRootHeader, title: screenTitles.home }}
        />
        <Stack.Screen
          name="invite/[token]"
          options={{
            ...pushedScreenHeader,
            ...chrome,
            title: screenTitles.inviteAccept,
            gestureEnabled: true,
          }}
        />
        <Stack.Screen
          name="design-gallery"
          options={{
            ...pushedScreenHeader,
            ...chrome,
            title: screenTitles.designGallery,
          }}
        />
      </Stack>
    </View>
  );
}

assertE2ePhotoSamplesGated();

if (process.env.EXPO_PUBLIC_E2E === '1') {
  LogBox.ignoreAllLogs(true);
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <FontGate>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <ThemedRootStack />
            </AuthProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </FontGate>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
