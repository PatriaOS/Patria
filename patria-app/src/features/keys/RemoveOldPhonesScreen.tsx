import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Title,
} from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { listOwnPhones, removeOwnPhone } from '../../lib/crypto/deviceAccess';
import { ensureDeviceIdentity } from '../../lib/crypto/deviceIdentity';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { describeCaughtError, logFailedAction, logKeyStep } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { formatDeviceWhen } from './ApproveMyDeviceScreen';

export function RemoveOldPhonesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  useEffect(() => {
    if (!userId) {
      return;
    }
    void ensureDeviceIdentity(userId).then((device) => setThisDeviceId(device.deviceId));
  }, [userId]);

  const phonesQuery = useQuery({
    queryKey: ['ownPhones', spaceId, userId],
    enabled: Boolean(spaceId && userId),
    queryFn: () => listOwnPhones(spaceId as string, userId as string),
  });

  const oldPhones = (phonesQuery.data ?? []).filter(
    (phone) => phone.deviceId !== thisDeviceId && phone.hasWrap && !phone.rejectedAt,
  );

  const onRemoveListed = async () => {
    if (!spaceId || !userId || !thisDeviceId) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      for (const phone of oldPhones) {
        await removeOwnPhone({
          spaceId,
          userId,
          deviceId: phone.deviceId,
          thisDeviceId,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['ownPhones', spaceId, userId] });
      router.replace(routes.home);
    } catch (caught) {
      const info = describeCaughtError(caught);
      logFailedAction(caught);
      logKeyStep('remove_old_phones_failed', `${info.code} ${info.message}`);
      setError(copy.recovery.removeOldFailed);
    } finally {
      setBusy(false);
    }
  };

  if (!spaceId || !thisDeviceId || phonesQuery.isLoading) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (phonesQuery.error) {
    return (
      <Screen withHeader>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  return (
    <Screen withHeader accessibilityLabel={copy.recovery.removeOldTitle}>
      <Title>{copy.recovery.removeOldTitle}</Title>
      <Body>{copy.recovery.removeOldBody}</Body>
      {error ? <ErrorState message={error} /> : null}
      {oldPhones.length === 0 ? <EmptyState title={copy.recovery.removeOldEmpty} /> : null}
      {oldPhones.map((phone) => (
        <Card key={phone.deviceId}>
          <Body>{copy.phones.setUp.replace('{when}', formatDeviceWhen(phone.createdAt))}</Body>
        </Card>
      ))}
      {oldPhones.length > 0 ? (
        <Button
          label={copy.recovery.removeOldAction}
          testID="remove-listed-phones"
          busy={busy}
          onPress={() => void onRemoveListed()}
        />
      ) : (
        <Button label={copy.common.continue} onPress={() => router.replace(routes.home)} />
      )}
    </Screen>
  );
}
