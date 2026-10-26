const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/** Hermes has no reliable Web Crypto randomUUID; use randomUuid() from src/lib/crypto/random. */
const noWebCryptoRandomUuidMessage =
  'Hermes lacks crypto.randomUUID. Import randomUuid from src/lib/crypto/random instead.';
const noWebCryptoRandomUuid = [
  'error',
  {
    // crypto.randomUUID()
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='randomUUID'][callee.object.name='crypto']",
    message: noWebCryptoRandomUuidMessage,
  },
  {
    // globalThis.crypto.randomUUID() / window.crypto.randomUUID()
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='randomUUID'][callee.object.type='MemberExpression'][callee.object.property.name='crypto']",
    message: noWebCryptoRandomUuidMessage,
  },
  {
    // const fn = crypto.randomUUID (uncalled reference)
    selector:
      "MemberExpression[property.name='randomUUID'][object.name='crypto']:not(CallExpression > MemberExpression.callee)",
    message: noWebCryptoRandomUuidMessage,
  },
  {
    selector:
      "MemberExpression[property.name='randomUUID'][object.type='MemberExpression'][object.property.name='crypto']:not(CallExpression > MemberExpression.callee)",
    message: noWebCryptoRandomUuidMessage,
  },
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/**',
      '.expo/**',
      'supabase/**',
      'node_modules/**',
      'scripts/**',
      '.maestro/**',
      'metro.config.js',
    ],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-syntax': noWebCryptoRandomUuid,
    },
  },
]);
