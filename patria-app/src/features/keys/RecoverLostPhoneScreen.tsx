import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import {
  Body,
  Button,
  ErrorState,
  Field,
  LoadingState,
  Muted,
  Screen,
  Title,
} from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { ensureDeviceIdentity } from '../../lib/crypto/deviceIdentity';
import {
  cancelledCopyKind,
  finishLostPhoneRecovery,
  requestCanFinish,
  requestIsWaiting,
  startLostPhoneRecovery,
  supabaseRecoverFlowGateway,
} from '../../lib/crypto/recoverFlow';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { describeCaughtError, logFailedAction, logKeyStep } from '../../lib/devLog';
import { fetchMemberships } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { formatDeviceWhen } from './ApproveMyDeviceScreen';

export function RecoverLostPhoneScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [paperWords, setPaperWords] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  const membershipsQuery = useQuery({
    queryKey: ['memberships', userId],
    enabled: Boolean(userId),
    queryFn: () => fetchMemberships(userId as string),
  });
  const requestsQuery = useQuery({
    queryKey: ['recoveryRequests', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => supabaseRecoverFlowGateway.listRequests(spaceId as string),
  });
  const helpersQuery = useQuery({
    queryKey: ['recoveryHelpers', requestsQuery.data?.[0]?.id],
    enabled: Boolean(requestsQuery.data?.find((row) => row.userId === userId && !row.completedAt)),
    queryFn: async () => {
      const mine = (requestsQuery.data ?? []).find(
        (row) => row.userId === userId && row.completedAt == null,
      );
      if (!mine) {
        return [];
      }
      return supabaseRecoverFlowGateway.listHelpers(mine.id);
    },
  });

  const role = membershipsQuery.data?.find((item) => item.space.id === spaceId)?.role;
  const mine = (requestsQuery.data ?? []).find((row) => row.userId === userId);

  const onStart = async () => {
    if (!userId || !spaceId) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const device = await ensureDeviceIdentity(userId);
      await startLostPhoneRecovery({
        spaceId,
        deviceId: device.deviceId,
        publicKey: device.publicKey,
      });
      await queryClient.invalidateQueries({ queryKey: ['recoveryRequests', spaceId] });
    } catch (caught) {
      const info = describeCaughtError(caught);
      logFailedAction(caught);
      logKeyStep('start_recovery_failed', `${info.code} ${info.message}`);
      setError(copy.recovery.lostStartFailed);
    } finally {
      setBusy(false);
    }
  };

  const onFinish = async () => {
    if (!userId || !spaceId || !mine) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const device = await ensureDeviceIdentity(userId);
      await finishLostPhoneRecovery({
        spaceId,
        userId,
        role,
        deviceId: device.deviceId,
        privateKey: device.privateKey,
        publicKey: device.publicKey,
        request: mine,
        paperWords,
      });
      setPaperWords('');
      router.replace(routes.removeOldPhones);
    } catch (caught) {
      const info = describeCaughtError(caught);
      logFailedAction(caught);
      logKeyStep('finish_recovery_failed', `${info.code} ${info.message}`);
      if (info.message.includes('printed code failed')) {
        setPaperWords('');
        setError(copy.recovery.printedFailed);
      } else {
        setError(copy.recovery.lostFinishFailed);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!spaceId || requestsQuery.isLoading || membershipsQuery.isLoading) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (requestsQuery.error || membershipsQuery.error) {
    return (
      <Screen withHeader>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  const helperCount = helpersQuery.data?.length ?? 0;

  return (
    <Screen withHeader accessibilityLabel={copy.recovery.lostTitle}>
      <Title>{copy.recovery.lostTitle}</Title>
      <Body>{copy.recovery.lostBody}</Body>
      {error ? <ErrorState message={error} /> : null}
      {!mine || mine.completedAt ? (
        <Button label={copy.recovery.lostStart} busy={busy} onPress={() => void onStart()} />
      ) : null}
      {mine && mine.cancelledAt ? (
        <Muted>
          {cancelledCopyKind(mine.cancelledBy, userId ?? '') === 'you'
            ? copy.home.recoveryCancelledByYou
            : copy.home.recoveryCancelledByAdmin}
        </Muted>
      ) : null}
      {mine && requestIsWaiting(mine) ? (
        <Muted>
          {copy.recovery.lostWaiting.replace('{when}', formatDeviceWhen(mine.notBefore))}
        </Muted>
      ) : null}
      {mine && requestCanFinish(mine) ? (
        <>
          <Muted>{copy.recovery.lostHelpers.replace('{n}', String(helperCount))}</Muted>
          <Field
            label={copy.recovery.lostPaperLabel}
            value={paperWords}
            onChangeText={setPaperWords}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityHint={copy.recovery.lostPaperHint}
          />
          <Muted>{copy.recovery.lostPaperHint}</Muted>
          <Button label={copy.recovery.lostFinish} busy={busy} onPress={() => void onFinish()} />
        </>
      ) : null}
    </Screen>
  );
}
