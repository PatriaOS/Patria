import { useRouter } from 'expo-router';

import { Body, Button, Display, Muted, Overline, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { routes } from '../../lib/navigation';
import { savePendingInviteToken } from '../../lib/pendingInvite';
import { PasteInviteField } from '../invites/PasteInviteField';

export function WelcomeScreen() {
  const router = useRouter();

  return (
    <Screen accessibilityLabel={copy.welcome.title} testID="screen-welcome">
      <Overline tone="terracotta">{copy.appName}</Overline>
      <Display>{copy.welcome.title}</Display>
      <Title>{copy.welcome.subtitle}</Title>
      <Body>{copy.welcome.body}</Body>
      <PasteInviteField
        onOpen={(token) => {
          void savePendingInviteToken(token);
          router.push(routes.inviteAccept(token));
        }}
      />
      <Button
        label={copy.welcome.createAccount}
        onPress={() => router.push('/(signed-out)/sign-up')}
      />
      <Button
        label={copy.welcome.signIn}
        variant="secondary"
        onPress={() => router.push('/(signed-out)/sign-in')}
      />
      <Muted>{copy.welcome.privacy}</Muted>
    </Screen>
  );
}
