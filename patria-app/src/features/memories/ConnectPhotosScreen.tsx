import { useRouter } from 'expo-router';

import { Button, Muted, Screen, Title } from '../../components/ui';
import { copy } from '../../lib/copy';
import { routes } from '../../lib/navigation';
import { librarySyncSupported } from './libraryApi';

export function ConnectPhotosScreen() {
  const router = useRouter();

  const onContinue = async () => {
    if (!librarySyncSupported()) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const MediaLibrary = require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
    await MediaLibrary.requestPermissionsAsync();
    router.push(routes.memoriesConnectSettings);
  };

  return (
    <Screen
      withHeader
      testID="screen-memories-connect"
      accessibilityLabel={copy.memories.connectTitle}
    >
      <Title>{copy.memories.connectTitle}</Title>
      <Muted testID="connect-explainer">{copy.memories.connectBody}</Muted>
      {librarySyncSupported() ? (
        <Button
          label={copy.memories.connectContinue}
          testID="connect-continue"
          onPress={() => void onContinue()}
        />
      ) : (
        <Muted testID="connect-android">{copy.memories.connectAndroid}</Muted>
      )}
    </Screen>
  );
}
