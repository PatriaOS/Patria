/// <reference types="jest" />

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-image', () => {
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: Object.assign(RN.Image, {
      clearMemoryCache: jest.fn(async () => undefined),
      clearDiskCache: jest.fn(async () => undefined),
    }),
  };
});

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  VideoExportPreset: { MediumQuality: 2 },
}));

jest.mock('expo-media-library/legacy', () => ({
  MediaType: { photo: 'photo' },
  SortBy: { creationTime: 'creationTime' },
  getAssetsAsync: jest.fn(async () => ({ assets: [] })),
  getAssetInfoAsync: jest.fn(),
  getAlbumsAsync: jest.fn(async () => []),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', accessPrivileges: 'none' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', accessPrivileges: 'all' })),
  presentPermissionsPickerAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR' },
  getNetworkStateAsync: jest.fn(async () => ({ type: 'WIFI', isInternetReachable: true })),
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(async () => ({ uri: 'file://frame.jpg', width: 640, height: 360 })),
}));

jest.mock('expo-video', () => {
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), muted: false, loop: false }),
    VideoView: RN.View,
  };
});

jest.mock('expo-linking', () => ({
  openSettings: jest.fn(async () => undefined),
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async (uri: string) => ({ uri, width: 800, height: 600 })),
}));

jest.mock('tus-js-client', () => ({
  Upload: class {
    start() {
      return undefined;
    }
  },
}));

jest.mock('expo-crypto', () => ({
  getRandomValues: (typedArray: Uint8Array): Uint8Array => {
    globalThis.crypto.getRandomValues(typedArray as never);
    return typedArray;
  },
}));

jest.mock('expo-router', () => {
  const push = jest.fn();
  const replace = jest.fn();
  return {
    useRouter: () => ({ push, replace }),
    useNavigation: () => ({
      canGoBack: () => false,
      addListener: (_event: string, _handler: () => void) => {
        return () => undefined;
      },
    }),
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Stack: () => null,
  };
});
