import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useAuth } from '../../lib/auth-context';
import { readCurrentFamilyId, writeCurrentFamilyId } from '../../lib/currentFamily';
import { fetchMemberships } from '../../lib/family';
import { isKeyEligibleRole, isSpaceAdmin } from '../../lib/roles';

export function useCurrentFamily() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [spaceId, setSpaceId] = useState<string | null>(null);

  const membershipsQuery = useQuery({
    queryKey: ['memberships', userId],
    enabled: Boolean(userId),
    refetchOnMount: 'always',
    queryFn: () => fetchMemberships(userId as string),
  });

  useEffect(() => {
    if (!membershipsQuery.data) {
      return;
    }
    if (membershipsQuery.data.length === 0) {
      void Promise.resolve().then(() => setSpaceId(null));
      return;
    }
    void readCurrentFamilyId().then((stored) => {
      const match = membershipsQuery.data?.find((item) => item.space.id === stored);
      const next = match?.space.id ?? membershipsQuery.data?.[0]?.space.id;
      if (next) {
        setSpaceId(next);
        void writeCurrentFamilyId(next);
      }
    });
  }, [membershipsQuery.data]);

  const current = membershipsQuery.data?.find((item) => item.space.id === spaceId);
  const admin = isSpaceAdmin(current?.role);
  const keyHolder = isKeyEligibleRole(current?.role);

  return {
    userId,
    spaceId,
    setSpaceId,
    membershipsQuery,
    current,
    admin,
    keyHolder,
  };
}
