import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Muted,
  Screen,
  Title,
} from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { listOwnPhones, removeOwnPhone, type OwnPhone } from '../../lib/crypto/deviceAccess';
import { ensureDeviceIdentity } from '../../lib/crypto/deviceIdentity';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { describeCaughtError, logFailedAction, logKeyStep } from '../../lib/devLog';
import { formatDeviceWhen } from './ApproveMyDeviceScreen';

export function YourPhonesScreen() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const onRemove = (phone: OwnPhone) => {
    if (!spaceId || !userId || !thisDeviceId) {
      return;
    }
    Alert.alert(copy.phones.remove, copy.phones.removeConfirm, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.phones.remove,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setError(null);
            setBusyId(phone.deviceId);
            try {
              await removeOwnPhone({
                spaceId,
                userId,
                deviceId: phone.deviceId,
                thisDeviceId,
              });
              await queryClient.invalidateQueries({ queryKey: ['ownPhones', spaceId, userId] });
            } catch (caught) {
              const info = describeCaughtError(caught);
              logFailedAction(caught);
              logKeyStep('remove_phone_failed', `${info.code} ${info.message}`);
              setError(copy.phones.removeFailed);
            } finally {
              setBusyId(null);
            }
          })();
        },
      },
    ]);
  };

  if (!spaceId || phonesQuery.isLoading) {
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

  const phones = phonesQuery.data ?? [];

  return (
    <Screen withHeader accessibilityLabel={copy.phones.title} testID="screen-your-phones">
      <Title>{copy.phones.title}</Title>
      {error ? <ErrorState message={error} /> : null}
      {phones.length === 0 ? <EmptyState title={copy.phones.empty} /> : null}
      {phones.map((phone) => {
        const isThis = phone.deviceId === thisDeviceId;
        const when = copy.phones.setUp.replace('{when}', formatDeviceWhen(phone.createdAt));
        const status = phone.rejectedAt
          ? copy.phones.rejected
          : phone.hasWrap
            ? null
            : copy.phones.waiting;
        return (
          <Card key={phone.deviceId}>
            <Body>{isThis ? copy.phones.thisPhone : when}</Body>
            {isThis ? <Muted>{when}</Muted> : null}
            {status ? <Muted>{status}</Muted> : null}
            {!isThis ? (
              <Button
                label={copy.phones.remove}
                variant="secondary"
                testID="remove-phone"
                busy={busyId === phone.deviceId}
                disabled={busyId !== null && busyId !== phone.deviceId}
                onPress={() => onRemove(phone)}
                accessibilityHint={`${copy.phones.remove} ${when}`}
              />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
