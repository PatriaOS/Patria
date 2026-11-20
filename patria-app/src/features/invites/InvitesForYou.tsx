import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Muted,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { testIdFromLabel } from '../../lib/testId';
import {
  declineInviteForMe,
  inviteTokenForMe,
  listInvitesForMe,
  type InviteForMe,
} from './invitesForMeApi';

type InvitesForYouProps = {
  /** Hide the block entirely when there are no invites (Create family). */
  hideWhenEmpty?: boolean;
};

export function InvitesForYou({ hideWhenEmpty = false }: InvitesForYouProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['invites-for-me'],
    queryFn: listInvitesForMe,
  });

  const invites = query.data ?? [];

  if (query.isLoading) {
    return <LoadingState message={copy.common.loading} />;
  }

  if (query.error) {
    return (
      <>
        <ErrorState message={copy.invite.forYouFailed} />
        <Button label={copy.common.tryAgain} onPress={() => void query.refetch()} />
      </>
    );
  }

  if (invites.length === 0) {
    if (hideWhenEmpty) {
      return null;
    }
    return (
      <>
        <Title testID={testIdFromLabel(copy.invite.forYouTitle)}>{copy.invite.forYouTitle}</Title>
        <EmptyState title={copy.invite.forYouEmpty} />
      </>
    );
  }

  const onAccept = async (invite: InviteForMe) => {
    setActionError(null);
    setBusyId(invite.id);
    try {
      const token = await inviteTokenForMe(invite.id);
      if (!token) {
        setActionError(copy.invite.forYouAcceptFailed);
        return;
      }
      router.push(routes.inviteAccept(token));
    } catch (error) {
      logFailedAction(error);
      setActionError(copy.invite.forYouAcceptFailed);
    } finally {
      setBusyId(null);
    }
  };

  const onDecline = async (invite: InviteForMe) => {
    setActionError(null);
    setBusyId(invite.id);
    try {
      await declineInviteForMe(invite.id);
      await query.refetch();
    } catch (error) {
      logFailedAction(error);
      setActionError(copy.invite.forYouDeclineFailed);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Title testID={testIdFromLabel(copy.invite.forYouTitle)}>{copy.invite.forYouTitle}</Title>
      {actionError ? <ErrorState message={actionError} /> : null}
      {invites.map((invite) => (
        <Card key={invite.id} testID={`invite-for-you-${invite.id}`}>
          <Body>{invite.familySpaceName}</Body>
          <Muted>
            {copy.invite.forYouInvitedBy.replace(
              '{name}',
              invite.inviterDisplayName || copy.appName,
            )}
          </Muted>
          <Muted>
            {copy.roles[invite.role]} ·{' '}
            {copy.invite.expires.replace(
              '{date}',
              new Date(invite.expiresAt).toLocaleDateString(),
            )}
          </Muted>
          <Button
            label={copy.invitePreview.accept}
            onPress={() => void onAccept(invite)}
            disabled={busyId === invite.id}
            busy={busyId === invite.id}
          />
          <Button
            label={copy.invitePreview.decline}
            variant="secondary"
            onPress={() => void onDecline(invite)}
            disabled={busyId === invite.id}
          />
        </Card>
      ))}
    </>
  );
}
