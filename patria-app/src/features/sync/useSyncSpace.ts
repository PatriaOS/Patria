import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { fetchChildren, fetchCircles, fetchMembers } from '../../lib/family';
import { useCurrentFamily } from '../family/useCurrentFamily';
import {
  fetchAgendaItems,
  fetchSyncMeetings,
  fetchSyncNotes,
  fetchSyncSchedule,
  fetchSyncTasks,
  pickActiveMeeting,
} from './syncApi';
import type { PersonLookup } from './syncLabels';

/** Shared reads for every Sync screen. Standard tier: plain Postgres reads, no key needed (D35). */
export function useSyncSpace(options: { pollMs?: number } = {}) {
  const family = useCurrentFamily();
  const queryClient = useQueryClient();
  const { spaceId, current } = family;
  const enabled = Boolean(spaceId && current);

  const scheduleQuery = useQuery({
    queryKey: ['syncSchedule', spaceId],
    enabled,
    queryFn: () => fetchSyncSchedule(spaceId as string),
  });
  const meetingsQuery = useQuery({
    queryKey: ['syncMeetings', spaceId],
    enabled,
    refetchInterval: options.pollMs,
    queryFn: () => fetchSyncMeetings(spaceId as string),
  });
  const circlesQuery = useQuery({
    queryKey: ['circles', spaceId],
    enabled,
    queryFn: () => fetchCircles(spaceId as string),
  });
  const membersQuery = useQuery({
    queryKey: ['members', spaceId],
    enabled,
    queryFn: () => fetchMembers(spaceId as string),
  });
  const childrenQuery = useQuery({
    queryKey: ['children', spaceId],
    enabled,
    queryFn: () => fetchChildren(spaceId as string),
  });

  const meetings = meetingsQuery.data ?? [];
  const active = pickActiveMeeting(meetings);
  const people: PersonLookup = {
    members: membersQuery.data ?? [],
    children: childrenQuery.data ?? [],
  };

  const refresh = useCallback(() => {
    if (!spaceId) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['syncSchedule', spaceId] });
    void queryClient.invalidateQueries({ queryKey: ['syncMeetings', spaceId] });
    void queryClient.invalidateQueries({ queryKey: ['syncAgenda'] });
    void queryClient.invalidateQueries({ queryKey: ['syncNotes'] });
    void queryClient.invalidateQueries({ queryKey: ['syncTasks', spaceId] });
  }, [queryClient, spaceId]);

  return {
    ...family,
    scheduleQuery,
    meetingsQuery,
    circlesQuery,
    membersQuery,
    childrenQuery,
    schedule: scheduleQuery.data ?? null,
    meetings,
    active,
    people,
    refresh,
    refreshing: scheduleQuery.isRefetching || meetingsQuery.isRefetching,
    loading:
      !family.current ||
      scheduleQuery.isLoading ||
      meetingsQuery.isLoading ||
      membersQuery.isLoading ||
      childrenQuery.isLoading ||
      circlesQuery.isLoading,
    failed:
      scheduleQuery.isError ||
      meetingsQuery.isError ||
      membersQuery.isError ||
      childrenQuery.isError ||
      circlesQuery.isError,
  };
}

export function useAgendaItems(meetingId: string | undefined, pollMs?: number) {
  return useQuery({
    queryKey: ['syncAgenda', meetingId],
    enabled: Boolean(meetingId),
    refetchInterval: pollMs,
    queryFn: () => fetchAgendaItems(meetingId as string),
  });
}

export function useSyncTasks(spaceId: string | null) {
  return useQuery({
    queryKey: ['syncTasks', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchSyncTasks(spaceId as string),
  });
}

export function useSyncNotes(meetingId: string | undefined, pollMs?: number) {
  return useQuery({
    queryKey: ['syncNotes', meetingId],
    enabled: Boolean(meetingId),
    refetchInterval: pollMs,
    queryFn: () => fetchSyncNotes(meetingId as string),
  });
}
