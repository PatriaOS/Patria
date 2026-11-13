import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { Body, Button, ButtonStack, Card, LoadingState, Muted, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { loadRecoverySnapshot } from '../../lib/crypto/recoverySetup';
import { routes } from '../../lib/navigation';
import { RecoveryNeedsAttentionCard } from '../keys/RecoveryNeedsAttentionCard';
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
  const hasAb = Boolean(recoveryQuery.data?.hasAb);
  const needsFinishSetup =
    recoveryQuery.data?.status === 'needs_attention' && accepted >= 2 && !hasAb;

  return (
    <Screen
      withHeader
      testID="screen-privacy-security"
      accessibilityLabel={copy.home.privacySecurityTitle}
    >
      <Title>{copy.home.privacySecurityTitle}</Title>
      <Body>{copy.home.privacySecurityBody}</Body>
      {keyHolder && needsFinishSetup ? (
        <RecoveryNeedsAttentionCard onFinishSetup={() => router.push(routes.recoverySetup)} />
      ) : null}
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
            {accepted >= 2 && hasAb ? (
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
      <ButtonStack>
        <Button
          label={copy.home.privacySecurityHowPatria}
          testID="privacy-how-patria-protects"
          variant="secondary"
          onPress={() => router.push(routes.howPatriaProtects)}
        />
        <Button
          label={copy.home.privacySecurityStatement}
          testID="privacy-statement"
          variant="secondary"
          onPress={() => router.push(routes.privacyStatement)}
        />
      </ButtonStack>
    </Screen>
  );
}
