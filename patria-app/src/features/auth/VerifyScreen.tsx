import { useRouter } from 'expo-router';

import { Body, Button, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';

export function VerifyScreen() {
  const router = useRouter();

  return (
    <Screen accessibilityLabel={copy.auth.verifyTitle} withHeader>
      <Title>{copy.auth.verifyTitle}</Title>
      <Body>{copy.auth.verifyBody}</Body>
      <Button
        label={copy.auth.verifyDone}
        onPress={() => router.replace('/(signed-out)/sign-in')}
      />
    </Screen>
  );
}
