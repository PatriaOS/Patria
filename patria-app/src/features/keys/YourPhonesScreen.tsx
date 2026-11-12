import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  Body,
  Button,
  ButtonStack,
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
import {
  listOwnPhones,
  removeOwnPhone,
  sortOwnPhonesForDisplay,
  type OwnPhone,
} from '../../lib/crypto/deviceAccess';
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
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
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

  const runRemove = async (phone: OwnPhone) => {
    if (!spaceId || !userId || !thisDeviceId) {
      return;
    }
    setError(null);
    setBusyId(phone.deviceId);
    try {
      await removeOwnPhone({
        spaceId,
        userId,
        deviceId: phone.deviceId,
        thisDeviceId,
      });
      setConfirmingId(null);
      await queryClient.invalidateQueries({ queryKey: ['ownPhones', spaceId, userId] });
    } catch (caught) {
      const info = describeCaughtError(caught);
      logFailedAction(caught);
      logKeyStep('remove_phone_failed', `${info.code} ${info.message}`);
      setError(copy.phones.removeFailed);
    } finally {
      setBusyId(null);
    }
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

  const phones = sortOwnPhonesForDisplay(phonesQuery.data ?? [], thisDeviceId);

  return (
    <Screen withHeader accessibilityLabel={copy.phones.title} testID="screen-your-phones">
      <Title>{copy.phones.title}</Title>
      {error ? <ErrorState message={error} /> : null}
      {phones.length === 0 ? <EmptyState title={copy.phones.empty} /> : null}
      {phones.map((phone) => {
        const isThis = phone.deviceId === thisDeviceId;
        const whenLabel = formatDeviceWhen(phone.createdAt);
        const setUp = copy.phones.setUp.replace('{when}', whenLabel);
        const isOlderSignIn = !isThis && phone.olderSignInOnThisPhone;
        const title = isThis
          ? copy.phones.thisPhone
          : isOlderSignIn
            ? copy.phones.olderSignIn
            : setUp;
        const detail = isThis
          ? setUp
          : isOlderSignIn
            ? copy.phones.olderSignInWhen.replace('{when}', whenLabel)
            : null;
        const status = phone.rejectedAt
          ? copy.phones.rejected
          : phone.hasWrap
            ? null
            : copy.phones.waiting;
        const confirming = confirmingId === phone.deviceId;
        return (
          <Card
            key={phone.deviceId}
            testID={
              isThis ? 'this-phone' : isOlderSignIn ? 'older-sign-in-phone' : 'other-phone'
            }
          >
            <Body>{title}</Body>
            {detail ? <Muted>{detail}</Muted> : null}
            {status ? <Muted>{status}</Muted> : null}
            {!isThis && confirming ? (
              <ButtonStack>
                <Muted testID="remove-phone-confirm">{copy.phones.removeConfirm}</Muted>
                <Button
                  label={copy.common.cancel}
                  variant="secondary"
                  testID="remove-phone-cancel"
                  disabled={busyId !== null}
                  onPress={() => setConfirmingId(null)}
                />
                <Button
                  label={copy.phones.remove}
                  variant="danger"
                  testID="remove-phone-confirm-yes"
                  busy={busyId === phone.deviceId}
                  disabled={busyId !== null && busyId !== phone.deviceId}
                  onPress={() => {
                    void runRemove(phone);
                  }}
                  accessibilityHint={`${copy.phones.remove} ${title}`}
                />
              </ButtonStack>
            ) : null}
            {!isThis && !confirming ? (
              <Button
                label={copy.phones.remove}
                variant="secondary"
                testID="remove-phone"
                disabled={busyId !== null}
                onPress={() => setConfirmingId(phone.deviceId)}
                accessibilityHint={`${copy.phones.remove} ${title}`}
              />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
