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
  initialRouteName: '(tabs)',
};

export default function SignedInLayout() {
  const { session, loading } = useAuth();
  const chrome = useThemedStackOptions();

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

  const pushed = { ...pushedScreenHeader, ...chrome };

  return (
    <Stack screenOptions={{ ...hiddenRootHeader, ...chrome }}>
      <Stack.Screen name="(tabs)" options={{ ...hiddenRootHeader, title: screenTitles.home }} />
      <Stack.Screen
        name="create"
        options={({ navigation }) => ({
          ...headerWhenPushed(navigation.canGoBack()),
          ...chrome,
          title: screenTitles.createFamily,
        })}
      />
      <Stack.Screen
        name="ready"
        options={({ navigation }) => ({
          ...headerWhenPushed(navigation.canGoBack()),
          ...chrome,
          title: screenTitles.ready,
        })}
      />
      <Stack.Screen
        name="invite-someone"
        options={{ ...pushed, title: screenTitles.inviteSomeone }}
      />
      <Stack.Screen name="add-child" options={{ ...pushed, title: screenTitles.addChild }} />
      <Stack.Screen name="member/[userId]" options={{ ...pushed, title: screenTitles.member }} />
      <Stack.Screen name="child/[childId]" options={{ ...pushed, title: screenTitles.child }} />
      <Stack.Screen name="join-family" options={{ ...pushed, title: screenTitles.joinFamily }} />
      <Stack.Screen
        name="your-name"
        options={({ navigation }) => ({
          ...headerWhenPushed(navigation.canGoBack()),
          ...chrome,
          title: screenTitles.yourName,
        })}
      />
      <Stack.Screen name="your-phones" options={{ ...pushed, title: screenTitles.yourPhones }} />
      <Stack.Screen
        name="recovery-setup"
        options={{ ...pushed, title: screenTitles.recoverySetup }}
      />
      <Stack.Screen name="printed-code" options={{ ...pushed, title: screenTitles.printedCode }} />
      <Stack.Screen
        name="recover-lost-phone"
        options={{ ...pushed, title: screenTitles.recoverLostPhone }}
      />
      <Stack.Screen
        name="remove-old-phones"
        options={{ ...pushed, title: screenTitles.removeOldPhones }}
      />
      <Stack.Screen name="appearance" options={{ ...pushed, title: screenTitles.appearance }} />
      <Stack.Screen name="needs-you" options={{ ...pushed, title: screenTitles.needsYou }} />
      <Stack.Screen
        name="privacy-security"
        options={{ ...pushed, title: screenTitles.privacySecurity }}
      />
      <Stack.Screen
        name="how-patria-protects"
        options={{ ...pushed, title: screenTitles.howPatriaProtects }}
      />
      <Stack.Screen
        name="privacy-statement"
        options={{ ...pushed, title: screenTitles.privacyStatement }}
      />
      <Stack.Screen name="memories-add" options={{ ...pushed, title: screenTitles.memoriesAdd }} />
      <Stack.Screen
        name="memories-connect"
        options={{ ...pushed, title: screenTitles.memoriesConnect }}
      />
      <Stack.Screen
        name="memories-connect-settings"
        options={{ ...pushed, title: screenTitles.memoriesConnectSettings }}
      />
      <Stack.Screen name="memory/[itemId]" options={{ ...pushed, title: screenTitles.memoryItem }} />
      <Stack.Screen
        name="sync-schedule"
        options={{ ...pushed, title: screenTitles.syncSchedule }}
      />
      <Stack.Screen name="sync-move" options={{ ...pushed, title: screenTitles.syncMove }} />
      <Stack.Screen name="sync-agenda" options={{ ...pushed, title: screenTitles.syncAgenda }} />
      <Stack.Screen name="sync-run" options={{ ...pushed, title: screenTitles.syncRun }} />
      <Stack.Screen name="sync-past" options={{ ...pushed, title: screenTitles.syncPast }} />
      <Stack.Screen name="sync-tasks" options={{ ...pushed, title: screenTitles.syncTasks }} />
      <Stack.Screen name="vault-new" options={{ ...pushed, title: screenTitles.vaultNew }} />
      <Stack.Screen name="vault/[entryId]" options={{ ...pushed, title: screenTitles.vaultEntry }} />
    </Stack>
  );
}
