/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/supabase/'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setupAfterEnv.ts'],
  modulePathIgnorePatterns: ['<rootDir>/supabase/'],
  moduleNameMapper: {
    '^react-native/setup-env$': '<rootDir>/jest.rn-setup-env.js',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage/async-storage)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@noble/.*|@scure/.*)',
  ],
};
