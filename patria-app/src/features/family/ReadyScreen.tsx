import { useNavigation, useRouter } from 'expo-router';

import { Body, Button, Muted, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';

export function ReadyScreen() {
  const router = useRouter();
  const navigation = useNavigation();

  return (
    <Screen accessibilityLabel={copy.ready.title} withHeader={navigation.canGoBack()}>
      <Title>{copy.ready.title}</Title>
      <Body>{copy.ready.created}</Body>
      <Muted>{copy.ready.createdDetail}</Muted>
      <Body>{copy.ready.keys}</Body>
      <Muted>{copy.ready.keysDetail}</Muted>
      <Button label={copy.ready.next} onPress={() => router.replace('/(signed-in)/home')} />
    </Screen>
  );
}
