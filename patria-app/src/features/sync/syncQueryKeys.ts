/** Stable React Query keys for Sync. Never put Date.now() or other ticking values here. */

export function syncScheduleKey(spaceId: string | null | undefined) {
  return ['syncSchedule', spaceId] as const;
}

export function syncMeetingsKey(spaceId: string | null | undefined) {
  return ['syncMeetings', spaceId] as const;
}

export function syncAnswersKey(meetingId: string | null | undefined) {
  return ['syncAnswers', meetingId ?? 'none'] as const;
}

export function syncAgendaKey(meetingId: string | null | undefined) {
  return ['syncAgenda', meetingId] as const;
}

export function syncTasksKey(spaceId: string | null | undefined) {
  return ['syncTasks', spaceId] as const;
}
