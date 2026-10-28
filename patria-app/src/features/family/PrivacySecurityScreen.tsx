import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { Body, Button, ButtonStack, Card, LoadingState, Muted, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { routes } from '../../lib/navigation';
import { useCurrentFamily } from './useCurrentFamily';

export function PrivacySecurityScreen() {
  const router = useRouter();
  const { userId, spaceId, current, keyHolder } = useCurrentFamily();
  const recoveryQuery = useQuery({
    queryKey: ['recoverySnapshot', spaceId, userId],
    enabled: Boolean(spaceId && userId && current),
    queryFn: () => loadRecoverySnapshot(spaceId as string, userId as string, current?.role),
  });

  if (!current || recoveryQuery.isLoading) {
    return (
      <Screen
        withHeader
        testID="screen-privacy-security"
        accessibilityLabel={copy.home.privacySecurityTitle}
      >
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  const accepted = recoveryQuery.data?.accepted ?? 0;
  const hasPaper = Boolean(recoveryQuery.data?.hasPaper);

  return (
    <Screen
      withHeader
      testID="screen-privacy-security"
      accessibilityLabel={copy.home.privacySecurityTitle}
    >
      <Title>{copy.home.privacySecurityTitle}</Title>
      <Body>{copy.home.privacySecurityBody}</Body>
      <Card testID="privacy-security-recovery">
        <Title>{copy.home.privacySecurityRecovery}</Title>
        <Muted>{copy.home.privacySecurityRecoveryBody}</Muted>
        {keyHolder ? (
          <ButtonStack>
            <Button
              label={copy.home.privacySecurityContacts}
              testID="privacy-recovery-contacts"
              onPress={() => router.push(routes.recoverySetup)}
            />
            {accepted >= 2 ? (
              <Button
                label={
                  hasPaper ? copy.home.privacySecurityPrinted : copy.home.recoveryPrintedAction
                }
                variant={hasPaper ? 'secondary' : 'primary'}
                testID="create-printed-code"
                onPress={() => router.push(routes.printedCode)}
              />
            ) : null}
          </ButtonStack>
        ) : (
          <Muted>{copy.home.recoveryYouAreContact.replace('{family}', current.space.name)}</Muted>
        )}
      </Card>
    </Screen>
  );
}
