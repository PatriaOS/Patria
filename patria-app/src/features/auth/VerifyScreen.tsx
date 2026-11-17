import { useNavigation, useRouter } from 'expo-router';

import { Body, Button, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';

export function VerifyScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const withHeader = navigation.canGoBack();

  return (
    <Screen accessibilityLabel={copy.auth.verifyTitle} withHeader={withHeader}>
      <Title>{copy.auth.verifyTitle}</Title>
      <Body>{copy.auth.verifyBody}</Body>
      <Button
        label={copy.auth.verifyDone}
        onPress={() => router.replace('/(signed-out)/sign-in')}
      />
    </Screen>
  );
}
