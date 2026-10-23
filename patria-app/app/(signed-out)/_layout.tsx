import { Redirect, Stack } from 'expo-router';

import { LoadingState, Screen } from '../../src/ui';
import { useAuth } from '../../src/lib/auth-context';
import { copy } from '../../src/lib/copy';
import {
  headerWhenPushed,
  hiddenRootHeader,
  pushedScreenHeader,
  screenTitles,
} from '../../src/lib/navigation';
import { useThemedStackOptions } from '../../src/theme';

export const unstable_settings = {
  initialRouteName: 'welcome',
};

export default function SignedOutLayout() {
  const { session, loading } = useAuth();
  const chrome = useThemedStackOptions();

  if (loading) {
    return (
      <Screen>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (session) {
    return <Redirect href="/" />;
  }

  return (
    <Stack screenOptions={{ ...hiddenRootHeader, ...chrome }}>
      <Stack.Screen name="welcome" options={{ ...hiddenRootHeader, title: screenTitles.welcome }} />
      <Stack.Screen
        name="sign-in"
        options={{ ...pushedScreenHeader, ...chrome, title: screenTitles.signIn }}
      />
      <Stack.Screen
        name="sign-up"
        options={{ ...pushedScreenHeader, ...chrome, title: screenTitles.signUp }}
      />
      <Stack.Screen
        name="verify"
        options={({ navigation }) => ({
          ...headerWhenPushed(navigation.canGoBack()),
          ...chrome,
          title: screenTitles.verify,
        })}
      />
    </Stack>
  );
}
