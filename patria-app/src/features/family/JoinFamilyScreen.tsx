import { useRouter } from 'expo-router';

import { Body, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { routes } from '../../lib/navigation';
import { PasteInviteField } from '../invites/PasteInviteField';

export function JoinFamilyScreen() {
  const router = useRouter();

  return (
    <Screen accessibilityLabel={copy.home.joinFamily} withHeader>
      <Title>{copy.home.joinFamily}</Title>
      <Body>{copy.home.joinFamilyBody}</Body>
      <PasteInviteField onOpen={(token) => router.push(routes.inviteAccept(token))} />
    </Screen>
  );
}
