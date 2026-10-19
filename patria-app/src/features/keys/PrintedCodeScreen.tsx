import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

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
import { savePrintedCode } from '../../lib/crypto/recoverySetup';
import { routes } from '../../lib/navigation';

export function PrintedCodeScreen() {
  const router = useRouter();
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

  if (!spaceId) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
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
        <Banner tone="warning" message={copy.recovery.printedBody} />
        <Muted testID="printed-code-words">{printed.words}</Muted>
        <Button label={copy.recovery.printedContinue} onPress={() => setPhase('confirm')} />
        <Button
          label={copy.recovery.printedSkip}
          variant="secondary"
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
            router.replace(routes.home);
          }}
        />
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
      <Button
        label={copy.common.save}
        busy={busy}
        onPress={() => void onSave()}
      />
    </Screen>
  );
}
