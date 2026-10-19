import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type RenderOptions } from '@testing-library/react-native';
import { type ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient as appQueryClient } from '../lib/queryClient';
import { ThemeProvider } from '../theme';

export const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const liveClients = new Set<QueryClient>();

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        networkMode: 'always',
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
        gcTime: Infinity,
        networkMode: 'always',
      },
    },
  });
}

export function renderScreen(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const queryClient = createTestQueryClient();
  liveClients.add(queryClient);
  const result = render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <ThemeProvider initialAppearance="light" persist={false} fontsReady>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>
        </QueryClientProvider>
      </ThemeProvider>
    ),
  });
  return Object.assign(result, { queryClient });
}

export function clearTestQueryClients(): void {
  for (const client of liveClients) {
    client.clear();
  }
  liveClients.clear();
  appQueryClient.clear();
  cleanup();
}
