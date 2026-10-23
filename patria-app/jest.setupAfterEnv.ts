import { createElement } from 'react';
import { focusManager, onlineManager } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { AppState, View } from 'react-native';

import { resetFamilyKeyMemory } from './src/lib/crypto/keyStore';
import { clearTestQueryClients, renderScreen } from './src/test/renderScreen';

focusManager.setEventListener(() => () => undefined);
onlineManager.setEventListener(() => () => undefined);
focusManager.setFocused(true);
onlineManager.setOnline(true);

jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({
  remove: jest.fn(),
}));

const jestGlobal = globalThis as typeof globalThis & { __patriaRtlWarmed?: boolean };

beforeAll(async () => {
  if (!jestGlobal.__patriaRtlWarmed) {
    await renderScreen(createElement(View));
    await clearTestQueryClients();
    jestGlobal.__patriaRtlWarmed = true;
  }
});

beforeEach(() => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
});

afterEach(async () => {
  resetFamilyKeyMemory();
  await clearTestQueryClients();
  jest.useRealTimers();
});
