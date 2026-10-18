import { Redirect, Stack } from 'expo-router';

import { LoadingState, Screen } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth-context';
import { copy } from '../../src/lib/copy';
import {
  headerWhenPushed,
  hiddenRootHeader,
  pushedScreenHeader,
  screenTitles,
} from '../../src/lib/navigation';

export const unstable_settings = {
  initialRouteName: 'home',
};

export default function SignedInLayout() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <Screen>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  return (
    <Stack initialRouteName="home" screenOptions={hiddenRootHeader}>
      <Stack.Screen name="home" options={{ ...hiddenRootHeader, title: screenTitles.home }} />
      <Stack.Screen
        name="create"
        options={({ navigation }) => ({
          ...headerWhenPushed(navigation.canGoBack()),
          title: screenTitles.createFamily,
        })}
      />
      <Stack.Screen
        name="ready"
        options={({ navigation }) => ({
          ...headerWhenPushed(navigation.canGoBack()),
          title: screenTitles.ready,
        })}
      />
      <Stack.Screen
        name="invite-someone"
        options={{ ...pushedScreenHeader, title: screenTitles.inviteSomeone }}
      />
      <Stack.Screen
        name="add-child"
        options={{ ...pushedScreenHeader, title: screenTitles.addChild }}
      />
      <Stack.Screen
        name="member/[userId]"
        options={{ ...pushedScreenHeader, title: screenTitles.member }}
      />
      <Stack.Screen
        name="child/[childId]"
        options={{ ...pushedScreenHeader, title: screenTitles.child }}
      />
      <Stack.Screen
        name="join-family"
        options={{ ...pushedScreenHeader, title: screenTitles.joinFamily }}
      />
      <Stack.Screen
        name="your-name"
        options={({ navigation }) => ({
          ...headerWhenPushed(navigation.canGoBack()),
          title: screenTitles.yourName,
        })}
      />
      <Stack.Screen
        name="your-phones"
        options={{ ...pushedScreenHeader, title: screenTitles.yourPhones }}
      />
      <Stack.Screen
        name="recovery-setup"
        options={{ ...pushedScreenHeader, title: screenTitles.recoverySetup }}
      />
      <Stack.Screen
        name="printed-code"
        options={{ ...pushedScreenHeader, title: screenTitles.printedCode }}
      />
      <Stack.Screen
        name="recover-lost-phone"
        options={{ ...pushedScreenHeader, title: screenTitles.recoverLostPhone }}
      />
      <Stack.Screen
        name="remove-old-phones"
        options={{ ...pushedScreenHeader, title: screenTitles.removeOldPhones }}
      />
      <Stack.Screen
        name="memories"
        options={{ ...pushedScreenHeader, title: screenTitles.memories }}
      />
      <Stack.Screen
        name="memories-add"
        options={{ ...pushedScreenHeader, title: screenTitles.memoriesAdd }}
      />
      <Stack.Screen
        name="memories-connect"
        options={{ ...pushedScreenHeader, title: screenTitles.memoriesConnect }}
      />
      <Stack.Screen
        name="memories-connect-settings"
        options={{ ...pushedScreenHeader, title: screenTitles.memoriesConnectSettings }}
      />
      <Stack.Screen
        name="memory/[itemId]"
        options={{ ...pushedScreenHeader, title: screenTitles.memoryItem }}
      />
    </Stack>
  );
}
