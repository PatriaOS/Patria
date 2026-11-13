import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  Banner,
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
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { logFailedAction } from '../../lib/devLog';
import {
  generatePrintedCode,
  pickPrintedCodeChecks,
  printedCodeWordList,
} from '../../lib/crypto/printedCode';
import { loadRecoverySnapshot, savePrintedCode } from '../../lib/crypto/recoverySetup';
import { fetchMemberships } from '../../lib/family';
import { routes } from '../../lib/navigation';

export function PrintedCodeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ refreshed?: string }>();
  const refreshed = params.refreshed === '1';
  const { session } = useAuth();
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'show' | 'confirm'>('show');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const printed = useMemo(() => generatePrintedCode(), []);
  const checks = useMemo(() => pickPrintedCodeChecks(printed.words), [printed.words]);

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  const membershipsQuery = useQuery({
    queryKey: ['memberships', userId],
    enabled: Boolean(userId),
    queryFn: () => fetchMemberships(userId as string),
  });
  const role = membershipsQuery.data?.find((item) => item.space.id === spaceId)?.role;
  const snapshotQuery = useQuery({
    queryKey: ['recoverySnapshot', spaceId, userId],
    enabled: Boolean(spaceId && userId),
    queryFn: () => loadRecoverySnapshot(spaceId as string, userId as string, role),
  });
  const wordsAllowed = Boolean(snapshotQuery.data?.hasAb);

  if (!spaceId || snapshotQuery.isLoading || membershipsQuery.isLoading) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (snapshotQuery.error || membershipsQuery.error) {
    return (
      <Screen withHeader>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  if (!snapshotQuery.data?.hasAb) {
    return (
      <Screen withHeader accessibilityLabel={copy.recovery.printedNeedAb}>
        <Body testID="printed-need-ab-message">{copy.recovery.printedNeedAb}</Body>
        <Button
          label={copy.home.recoveryFinishSetup}
          testID="finish-recovery-setup"
          onPress={() => router.replace(routes.recoverySetup)}
        />
      </Screen>
    );
  }

  const onSave = async () => {
    if (!userId) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await savePrintedCode({
        spaceId,
        memberUserId: userId,
        printed,
        answers: checks.map((item) => ({
          index: item.index,
          word: answers[item.index] ?? '',
        })),
      });
      router.replace(routes.home);
    } catch (caught) {
      logFailedAction(caught);
      setError(copy.recovery.printedFailed);
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'show') {
    return (
      <Screen withHeader accessibilityLabel={copy.recovery.printedTitle}>
        <Title>{copy.recovery.printedTitle}</Title>
        <Banner
          tone="warning"
          message={refreshed ? copy.recovery.printedAfterRepairBody : copy.recovery.printedBody}
        />
        {wordsAllowed ? (
          <Muted testID="printed-code-words">{printed.words}</Muted>
        ) : null}
        <Button
          label={copy.recovery.printedContinue}
          testID="printed-code-continue"
          onPress={() => setPhase('confirm')}
        />
        <Button
          label={copy.recovery.printedSkip}
          variant="secondary"
          testID="printed-code-skip"
          busy={busy}
          onPress={() => {
            if (process.env.EXPO_PUBLIC_E2E === '1' && userId) {
              const list = printedCodeWordList(printed.words);
              setBusy(true);
              void savePrintedCode({
                spaceId,
                memberUserId: userId,
                printed,
                answers: checks.map((item) => ({
                  index: item.index,
                  word: list[item.index] ?? '',
                })),
              })
                .then(() => {
                  router.replace(routes.home);
                })
                .catch((caught) => {
                  logFailedAction(caught);
                  setError(copy.recovery.printedFailed);
                })
                .finally(() => setBusy(false));
              return;
            }
            setError(copy.recovery.printedSkipHint);
          }}
        />
        {error ? <ErrorState message={error} /> : null}
        {!process.env.EXPO_PUBLIC_E2E && error === copy.recovery.printedSkipHint ? (
          <Muted>{copy.recovery.printedSkipHint}</Muted>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen withHeader accessibilityLabel={copy.recovery.printedConfirmTitle}>
      <Title>{copy.recovery.printedConfirmTitle}</Title>
      <Body>{copy.recovery.printedConfirmBody}</Body>
      {error ? <ErrorState message={error} /> : null}
      {checks.map((item) => (
        <Field
          key={item.index}
          label={copy.recovery.printedWord.replace('{n}', String(item.index + 1))}
          autoCapitalize="none"
          autoCorrect={false}
          value={answers[item.index] ?? ''}
          onChangeText={(text) =>
            setAnswers((current) => ({ ...current, [item.index]: text }))
          }
        />
      ))}
      <Button label={copy.common.save} busy={busy} onPress={() => void onSave()} />
    </Screen>
  );
}
