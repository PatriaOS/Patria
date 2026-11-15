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
  memberRoleIsAdmin,
  requestCanFinish,
  requestIsWaiting,
  startLostPhoneRecovery,
  supabaseRecoverFlowGateway,
} from '../../lib/crypto/recoverFlow';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { describeCaughtError, logFailedAction, logKeyStep } from '../../lib/devLog';
import { fetchMembers, fetchMemberships } from '../../lib/family';
import { isDesignPreviewRuntime } from '../../lib/localOrE2eRuntime';
import { routes } from '../../lib/navigation';
import { formatDeviceWhen } from './ApproveMyDeviceScreen';

/**
 * Local Supabase URL only (same gate as design previews): allowlisted codes for Maestro.
 * Never returns keys, tokens, or raw exception text — fixed phrases only.
 */
export function e2eFinishErrorDetail(
  message: string,
  supabaseUrl: string | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
): string | null {
  if (!isDesignPreviewRuntime(supabaseUrl)) {
    return null;
  }
  const safe = message.trim();
  if (
    safe === 'unwrap failed' ||
    safe === 'recovery device mismatch' ||
    safe === 'Not allowed' ||
    safe === 'missing family key'
  ) {
    return safe;
  }
  return null;
}

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
  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchMembers(spaceId as string),
  });
  const requestsQuery = useQuery({
    queryKey: ['recoveryRequests', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => supabaseRecoverFlowGateway.listRequests(spaceId as string),
  });
  const role = membershipsQuery.data?.find((item) => item.space.id === spaceId)?.role;
  // Prefer the open request. listRequests includes older cancelled/completed rows;
  // finishing against those fails with a vague "check the words" error.
  const openMine = (requestsQuery.data ?? []).find(
    (row) =>
      row.userId === userId && row.completedAt == null && row.cancelledAt == null,
  );
  const latestMine = (requestsQuery.data ?? []).find((row) => row.userId === userId);
  // Active recovery only. A cancelled row must not block Start.
  const mine = openMine ?? null;
  const cancelledNotice =
    !openMine && latestMine?.cancelledAt
      ? latestMine
      : null;
  const cancellerIsAdmin = memberRoleIsAdmin(
    (membersQuery.data ?? []).find((row) => row.userId === cancelledNotice?.cancelledBy)?.role,
  );

  const helpersQuery = useQuery({
    queryKey: ['recoveryHelpers', openMine?.id],
    enabled: Boolean(openMine),
    queryFn: async () => {
      if (!openMine) {
        return [];
      }
      return supabaseRecoverFlowGateway.listHelpers(openMine.id);
    },
  });

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
        const detail = e2eFinishErrorDetail(info.message);
        setError(detail ?? copy.recovery.lostFinishFailed);
      }
    } finally {
      setBusy(false);
    }
  };

  if (
    !spaceId ||
    requestsQuery.isLoading ||
    membershipsQuery.isLoading ||
    membersQuery.isLoading
  ) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (requestsQuery.error || membershipsQuery.error || membersQuery.error) {
    return (
      <Screen withHeader>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  const helperCount = helpersQuery.data?.length ?? 0;
  const hasPaper = paperWords.trim().length > 0;
  const canAttemptFinish = helperCount >= 2 || hasPaper;
  const cancelledKind = cancelledNotice
    ? cancelledCopyKind(cancelledNotice.cancelledBy, userId ?? '', cancellerIsAdmin)
    : null;

  return (
    <Screen withHeader accessibilityLabel={copy.recovery.lostTitle}>
      <Title>{copy.recovery.lostTitle}</Title>
      <Body>{copy.recovery.lostBody}</Body>
      {error ? <ErrorState message={error} /> : null}
      {!openMine ? (
        <Button
          label={copy.recovery.lostStart}
          testID="start-recovery"
          busy={busy}
          onPress={() => void onStart()}
        />
      ) : null}
      {cancelledNotice && cancelledKind === 'you' ? (
        <Muted>{copy.home.recoveryCancelledByYou}</Muted>
      ) : null}
      {cancelledNotice && cancelledKind === 'admin' ? (
        <Muted>{copy.home.recoveryCancelledByAdmin}</Muted>
      ) : null}
      {cancelledNotice && cancelledKind === 'contact' ? (
        <Muted>{copy.home.recoveryCancelledByContact}</Muted>
      ) : null}
      {mine && requestIsWaiting(mine) ? (
        <Muted testID="recovery-waiting-until">
          {copy.recovery.lostWaiting.replace('{when}', formatDeviceWhen(mine.notBefore))}
        </Muted>
      ) : null}
      {mine && requestCanFinish(mine) ? (
        <>
          <Muted testID="recovery-helper-count">
            {copy.recovery.lostHelpers.replace('{n}', String(helperCount))}
          </Muted>
          <Field
            label={copy.recovery.lostPaperLabel}
            testID="printed-code-24-words"
            value={paperWords}
            onChangeText={setPaperWords}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityHint={
              helperCount >= 2 ? copy.recovery.lostPaperBothHelped : copy.recovery.lostPaperHint
            }
          />
          {helperCount >= 2 ? (
            <Muted testID="printed-code-both-helped">{copy.recovery.lostPaperBothHelped}</Muted>
          ) : (
            <Muted>{copy.recovery.lostPaperHint}</Muted>
          )}
          {!canAttemptFinish ? (
            <Muted testID="waiting-second-contact">{copy.recovery.lostWaitingSecondContact}</Muted>
          ) : null}
          <Button
            label={copy.recovery.lostFinish}
            testID="finish-recovery"
            busy={busy}
            disabled={!canAttemptFinish}
            onPress={() => void onFinish()}
          />
        </>
      ) : null}
    </Screen>
  );
}
