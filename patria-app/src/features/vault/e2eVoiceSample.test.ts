import { loadE2eVoiceBytes } from './e2eVoiceSample';

describe('e2e voice sample gating', () => {
  const previous = process.env.EXPO_PUBLIC_E2E;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.EXPO_PUBLIC_E2E;
    } else {
      process.env.EXPO_PUBLIC_E2E = previous;
    }
    jest.dontMock('./e2eVoiceSample.bundle');
    jest.resetModules();
  });

  it('throws when bundled samples are loaded without EXPO_PUBLIC_E2E=1', () => {
    delete process.env.EXPO_PUBLIC_E2E;
    expect(() => loadE2eVoiceBytes()).toThrow(/not available in this build/);
  });

  it('fails startup when the sample loads in a non-e2e build', () => {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_E2E = '';
      jest.doMock('./e2eVoiceSample.bundle', () => ({
        loadE2eVoiceBytes: () => new Uint8Array([1, 2, 3]),
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gated = require('./e2eVoiceSample') as typeof import('./e2eVoiceSample');
      expect(() => gated.assertE2eVoiceSampleGated()).toThrow(/reachable in a non-e2e build/);
    });
  });

  it('passes startup when the e2e flag is off and samples cannot load', () => {
    jest.isolateModules(() => {
      delete process.env.EXPO_PUBLIC_E2E;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gated = require('./e2eVoiceSample') as typeof import('./e2eVoiceSample');
      expect(() => gated.assertE2eVoiceSampleGated()).not.toThrow();
    });
  });
});
