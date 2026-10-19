import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { Body, Button, ErrorState, LoadingState, Screen } from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { writeCurrentFamilyId } from '../../lib/currentFamily';
import type { InvitePreview } from '../../lib/family';
import { routes } from '../../lib/navigation';
import { clearPendingInviteToken, savePendingInviteToken } from '../../lib/pendingInvite';
import { supabase } from '../../lib/supabase';
import { InvitePreviewView } from './InvitePreviewView';

type InvitePreviewScreenProps = {
  token: string;
};

export function InvitePreviewScreen({ token }: InvitePreviewScreenProps) {
  const router = useRouter();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const previewQuery = useQuery({
    queryKey: ['invite-preview', token],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_invite_preview', {
        p_token: token,
      });
      if (error) {
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      return (row as InvitePreview | undefined) ?? null;
    },
  });

  const inviteIsGone =
    previewQuery.isError || (previewQuery.isSuccess && previewQuery.data == null);

  useEffect(() => {
    if (inviteIsGone) {
      void clearPendingInviteToken();
    }
  }, [inviteIsGone]);

  const goAuth = async (path: '/(signed-out)/sign-in' | '/(signed-out)/sign-up') => {
    await savePendingInviteToken(token);
    router.replace(path);
  };

  const onAccept = async () => {
    setBusy(true);
    setActionError(null);
    const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
    setBusy(false);
    if (error) {
      const code = 'code' in error ? String(error.code) : '';
      setActionError(code === '42501' ? copy.invitePreview.emailMismatch : copy.common.error);
      return;
    }
    await clearPendingInviteToken();
    if (data) {
      await writeCurrentFamilyId(String(data));
    }
    router.replace(routes.home);
  };

  const onDecline = async () => {
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.rpc('decline_invite', { p_token: token });
    setBusy(false);
    if (error) {
      setActionError(copy.invitePreview.invalid);
      return;
    }
    await clearPendingInviteToken();
    await previewQuery.refetch();
  };

  const onLeaveInvalid = async () => {
    await clearPendingInviteToken();
    router.replace(routes.gate);
  };

  if (previewQuery.isLoading) {
    return (
      <Screen withHeader>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (inviteIsGone) {
    return (
      <Screen accessibilityLabel={copy.invitePreview.invalid} withHeader>
        {previewQuery.isError ? <ErrorState message={copy.common.error} /> : null}
        <Body testID="invite-no-longer-valid">{copy.invitePreview.invalid}</Body>
        <Button testID="continue" label={copy.common.continue} onPress={() => void onLeaveInvalid()} />
      </Screen>
    );
  }

  if (!previewQuery.data) {
    return (
      <Screen accessibilityLabel={copy.invitePreview.invalid} withHeader>
        <Body testID="invite-no-longer-valid">{copy.invitePreview.invalid}</Body>
        <Button testID="continue" label={copy.common.continue} onPress={() => void onLeaveInvalid()} />
      </Screen>
    );
  }

  return (
    <Screen accessibilityLabel={copy.invitePreview.title} withHeader>
      <InvitePreviewView
        preview={previewQuery.data}
        signedIn={Boolean(session)}
        busy={busy}
        error={actionError}
        onAccept={() => void onAccept()}
        onDecline={() => void onDecline()}
        onSignIn={() => void goAuth('/(signed-out)/sign-in')}
        onSignUp={() => void goAuth('/(signed-out)/sign-up')}
      />
    </Screen>
  );
}
