import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { Body, Button, ErrorState, LoadingState, Muted, Screen, Title } from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { fetchChildren, fetchMembers } from '../../lib/family';
import { isSpaceAdmin } from '../../lib/roles';
import { supabase } from '../../lib/supabase';

type ChildProfileScreenProps = {
  childId: string;
};

export function ChildProfileScreen({ childId }: ChildProfileScreenProps) {
  const router = useRouter();
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  const childrenQuery = useQuery({
    queryKey: ['children', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchChildren(spaceId as string),
  });
  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchMembers(spaceId as string),
  });

  const child = childrenQuery.data?.find((row) => row.id === childId);
  const myRole = membersQuery.data?.find((row) => row.userId === session?.user.id)?.role;
  const admin = isSpaceAdmin(myRole);

  if (childrenQuery.isLoading || !child) {
    return (
      <Screen withHeader>
        {childrenQuery.isLoading ? (
          <LoadingState message={copy.common.loading} />
        ) : (
          <ErrorState message={copy.common.empty} />
        )}
      </Screen>
    );
  }

  const remove = () => {
    Alert.alert(copy.member.childRemove, copy.member.removeConfirm, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.member.remove,
        style: 'destructive',
        onPress: () => {
          void supabase
            .from('child_profiles')
            .delete()
            .eq('id', childId)
            .then(({ error: deleteError }) => {
              if (deleteError) {
                setError(copy.member.removeFailed);
                return;
              }
              router.replace('/(signed-in)/home');
            });
        },
      },
    ]);
  };

  return (
    <Screen accessibilityLabel={child.displayName} withHeader>
      <Title>{child.displayName}</Title>
      <Body>{copy.roles.child}</Body>
      <Muted>{copy.child.noEmail}</Muted>
      {error ? <ErrorState message={error} /> : null}
      {admin ? (
        <Button label={copy.member.childRemove} variant="danger" onPress={remove} />
      ) : null}
    </Screen>
  );
}
