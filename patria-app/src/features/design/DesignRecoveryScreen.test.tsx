import { renderScreen } from '../../test/renderScreen';
import { DesignRecoveryScreen } from './DesignRecoveryScreen';

jest.mock('expo-router', () => {
  const React = require('react') as typeof import('react');
  const { Text: RNText } = require('react-native') as typeof import('react-native');
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement(RNText, { testID: 'design-redirect' }, href),
    useLocalSearchParams: () => ({ shot: 'needs_attention' }),
  };
});

describe('DesignRecoveryScreen gate', () => {
  const realE2e = process.env.EXPO_PUBLIC_E2E;
  const realUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

  afterEach(() => {
    if (realE2e === undefined) {
      delete process.env.EXPO_PUBLIC_E2E;
    } else {
      process.env.EXPO_PUBLIC_E2E = realE2e;
    }
    if (realUrl === undefined) {
      delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    } else {
      process.env.EXPO_PUBLIC_SUPABASE_URL = realUrl;
    }
  });

  it('is unreachable on a hosted config even with EXPO_PUBLIC_E2E=1', async () => {
    process.env.EXPO_PUBLIC_E2E = '1';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    const { getByTestId, queryByTestId } = await renderScreen(<DesignRecoveryScreen />);
    expect(getByTestId('design-redirect').props.children).toBe('/');
    expect(queryByTestId('design-recovery')).toBeNull();
  });

  it('shows recovery design review on a local Supabase URL', async () => {
    delete process.env.EXPO_PUBLIC_E2E;
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    const { getByTestId } = await renderScreen(<DesignRecoveryScreen />);
    expect(getByTestId('design-recovery')).toBeTruthy();
    expect(getByTestId('design-recovery-needs-attention')).toBeTruthy();
  });
});
