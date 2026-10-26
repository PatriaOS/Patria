import { randomUuid } from '../../lib/crypto/random';
import { supabase } from '../../lib/supabase';
import type { SyncAgendaKind, SyncStep } from './syncSchedule';

export type SyncScheduleRow = {
  familySpaceId: string;
  weekday: number;
  localTime: string;
  timezone: string;
  circleId: string;
};

export type SyncMeetingStatus = 'upcoming' | 'in_progress' | 'finished' | 'skipped';

export type SyncMeetingRow = {
  id: string;
  familySpaceId: string;
  circleId: string;
  scheduledFor: string;
  status: SyncMeetingStatus;
  startedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  priorityText: string;
  summary: Record<string, unknown>;
};

export type SyncAgendaItemRow = {
  id: string;
  familySpaceId: string;
  meetingId: string;
  kind: SyncAgendaKind;
  title: string;
  details: string;
  authorUserId: string;
  attributedChildId: string | null;
  discussedAt: string | null;
  decisionText: string;
};

export type SyncNoteRow = {
  id: string;
  meetingId: string;
  step: SyncStep;
  body: string;
};

export type SyncTaskRow = {
  id: string;
  familySpaceId: string;
  meetingId: string;
  title: string;
  ownerUserId: string | null;
  ownerChildId: string | null;
  backupUserId: string | null;
  backupChildId: string | null;
  dueOn: string | null;
  doneAt: string | null;
  doneBy: string | null;
};

function asTimeString(value: string): string {
  // Postgres time may arrive as HH:MM:SS
  return value.length >= 5 ? value.slice(0, 8) : value;
}

export async function fetchSyncSchedule(spaceId: string): Promise<SyncScheduleRow | null> {
  const { data, error } = await supabase
    .from('sync_schedules')
    .select('family_space_id, weekday, local_time, timezone, circle_id')
    .eq('family_space_id', spaceId)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return {
    familySpaceId: data.family_space_id as string,
    weekday: data.weekday as number,
    localTime: asTimeString(data.local_time as string),
    timezone: data.timezone as string,
    circleId: data.circle_id as string,
  };
}

export async function fetchSyncMeetings(spaceId: string): Promise<SyncMeetingRow[]> {
  const { data, error } = await supabase
    .from('sync_meetings')
    .select(
      'id, family_space_id, circle_id, scheduled_for, status, started_by, started_at, finished_at, priority_text, summary',
    )
    .eq('family_space_id', spaceId)
    .order('scheduled_for', { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    familySpaceId: row.family_space_id as string,
    circleId: row.circle_id as string,
    scheduledFor: row.scheduled_for as string,
    status: row.status as SyncMeetingStatus,
    startedBy: (row.started_by as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    priorityText: (row.priority_text as string) ?? '',
    summary: (row.summary as Record<string, unknown>) ?? {},
  }));
}

export function pickActiveMeeting(meetings: SyncMeetingRow[]): SyncMeetingRow | null {
  const inProgress = meetings.find((m) => m.status === 'in_progress');
  if (inProgress) {
    return inProgress;
  }
  const upcoming = [...meetings]
    .filter((m) => m.status === 'upcoming')
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  return upcoming[0] ?? null;
}

export async function fetchAgendaItems(meetingId: string): Promise<SyncAgendaItemRow[]> {
  const { data, error } = await supabase
    .from('sync_agenda_items')
    .select(
      'id, family_space_id, meeting_id, kind, title, details, author_user_id, attributed_child_id, discussed_at, decision_text',
    )
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true });
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    familySpaceId: row.family_space_id as string,
    meetingId: row.meeting_id as string,
    kind: row.kind as SyncAgendaKind,
    title: row.title as string,
    details: (row.details as string) ?? '',
    authorUserId: row.author_user_id as string,
    attributedChildId: (row.attributed_child_id as string | null) ?? null,
    discussedAt: (row.discussed_at as string | null) ?? null,
    decisionText: (row.decision_text as string) ?? '',
  }));
}

export async function fetchSyncNotes(meetingId: string): Promise<SyncNoteRow[]> {
  const { data, error } = await supabase
    .from('sync_notes')
    .select('id, meeting_id, step, body')
    .eq('meeting_id', meetingId);
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    meetingId: row.meeting_id as string,
    step: row.step as SyncStep,
    body: (row.body as string) ?? '',
  }));
}

export async function fetchSyncTasks(spaceId: string): Promise<SyncTaskRow[]> {
  const { data, error } = await supabase
    .from('sync_tasks')
    .select(
      'id, family_space_id, meeting_id, title, owner_user_id, owner_child_id, backup_user_id, backup_child_id, due_on, done_at, done_by',
    )
    .eq('family_space_id', spaceId)
    .order('due_on', { ascending: true, nullsFirst: false });
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    familySpaceId: row.family_space_id as string,
    meetingId: row.meeting_id as string,
    title: row.title as string,
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    ownerChildId: (row.owner_child_id as string | null) ?? null,
    backupUserId: (row.backup_user_id as string | null) ?? null,
    backupChildId: (row.backup_child_id as string | null) ?? null,
    dueOn: (row.due_on as string | null) ?? null,
    doneAt: (row.done_at as string | null) ?? null,
    doneBy: (row.done_by as string | null) ?? null,
  }));
}

export async function upsertSyncSchedule(input: {
  spaceId: string;
  weekday: number;
  localTime: string;
  timezone: string;
  circleId: string;
  nextScheduledFor: Date;
}): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_sync_schedule', {
    p_space_id: input.spaceId,
    p_weekday: input.weekday,
    p_local_time: input.localTime,
    p_timezone: input.timezone,
    p_circle_id: input.circleId,
    p_next_scheduled_for: input.nextScheduledFor.toISOString(),
  });
  if (error) {
    throw error;
  }
  return data as string;
}

export async function ensureNextMeeting(spaceId: string, scheduledFor: Date): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_next_meeting', {
    p_space_id: spaceId,
    p_scheduled_for: scheduledFor.toISOString(),
  });
  if (error) {
    throw error;
  }
  return data as string;
}

export async function startSyncMeeting(meetingId: string): Promise<SyncMeetingRow> {
  const { data, error } = await supabase.rpc('start_sync_meeting', {
    p_meeting_id: meetingId,
  });
  if (error) {
    throw error;
  }
  const row = data as {
    id: string;
    family_space_id: string;
    circle_id: string;
    scheduled_for: string;
    status: SyncMeetingStatus;
    started_by: string | null;
    started_at: string | null;
    finished_at: string | null;
    priority_text: string;
    summary: Record<string, unknown>;
  };
  return {
    id: row.id,
    familySpaceId: row.family_space_id,
    circleId: row.circle_id,
    scheduledFor: row.scheduled_for,
    status: row.status,
    startedBy: row.started_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    priorityText: row.priority_text ?? '',
    summary: row.summary ?? {},
  };
}

export async function finishSyncMeeting(input: {
  meetingId: string;
  priorityText: string;
  summary: Record<string, unknown>;
  nextScheduledFor: Date;
}): Promise<string> {
  const { data, error } = await supabase.rpc('finish_sync_meeting', {
    p_meeting_id: input.meetingId,
    p_priority_text: input.priorityText,
    p_summary: input.summary,
    p_next_scheduled_for: input.nextScheduledFor.toISOString(),
  });
  if (error) {
    throw error;
  }
  return data as string;
}

export async function insertAgendaItem(input: {
  spaceId: string;
  meetingId: string;
  kind: SyncAgendaKind;
  title: string;
  details: string;
  authorUserId: string;
  attributedChildId?: string | null;
}): Promise<string> {
  const id = randomUuid();
  const { error } = await supabase.from('sync_agenda_items').insert({
    id,
    family_space_id: input.spaceId,
    meeting_id: input.meetingId,
    kind: input.kind,
    title: input.title.trim(),
    details: input.details.trim(),
    author_user_id: input.authorUserId,
    attributed_child_id: input.attributedChildId ?? null,
  });
  if (error) {
    throw error;
  }
  return id;
}

export async function updateAgendaItem(input: {
  id: string;
  kind: SyncAgendaKind;
  title: string;
  details: string;
  attributedChildId?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('sync_agenda_items')
    .update({
      kind: input.kind,
      title: input.title.trim(),
      details: input.details.trim(),
      attributed_child_id: input.attributedChildId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id);
  if (error) {
    throw error;
  }
}

export async function deleteAgendaItem(id: string): Promise<void> {
  const { error } = await supabase.from('sync_agenda_items').delete().eq('id', id);
  if (error) {
    throw error;
  }
}

export async function markAgendaDiscussed(input: {
  id: string;
  decisionText?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('sync_agenda_items')
    .update({
      discussed_at: new Date().toISOString(),
      decision_text: input.decisionText?.trim() ?? '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id);
  if (error) {
    throw error;
  }
}

export async function upsertSyncNote(input: {
  spaceId: string;
  meetingId: string;
  step: SyncStep;
  body: string;
  updatedBy: string;
}): Promise<void> {
  const { error } = await supabase.from('sync_notes').upsert(
    {
      family_space_id: input.spaceId,
      meeting_id: input.meetingId,
      step: input.step,
      body: input.body,
      updated_by: input.updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'meeting_id,step' },
  );
  if (error) {
    throw error;
  }
}

export async function insertSyncTask(input: {
  spaceId: string;
  meetingId: string;
  title: string;
  ownerUserId?: string | null;
  ownerChildId?: string | null;
  backupUserId?: string | null;
  backupChildId?: string | null;
  dueOn?: string | null;
}): Promise<string> {
  const id = randomUuid();
  const { error } = await supabase.from('sync_tasks').insert({
    id,
    family_space_id: input.spaceId,
    meeting_id: input.meetingId,
    title: input.title.trim(),
    owner_user_id: input.ownerUserId ?? null,
    owner_child_id: input.ownerChildId ?? null,
    backup_user_id: input.backupUserId ?? null,
    backup_child_id: input.backupChildId ?? null,
    due_on: input.dueOn ?? null,
  });
  if (error) {
    throw error;
  }
  return id;
}

export async function setTaskDone(input: {
  id: string;
  done: boolean;
  doneBy: string;
}): Promise<void> {
  const { error } = await supabase
    .from('sync_tasks')
    .update({
      done_at: input.done ? new Date().toISOString() : null,
      done_by: input.done ? input.doneBy : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id);
  if (error) {
    throw error;
  }
}

export function agendaBodyLine(items: SyncAgendaItemRow[]): string {
  const total = items.length;
  const decisions = items.filter((item) => item.kind === 'decide').length;
  if (total === 0) {
    return 'No items on the agenda yet.';
  }
  if (decisions === 0) {
    return total === 1 ? '1 item on the agenda.' : `${total} items on the agenda.`;
  }
  const itemPart = total === 1 ? '1 item on the agenda' : `${total} items on the agenda`;
  const decidePart =
    decisions === 1 ? 'plus 1 decision waiting' : `plus ${decisions} decisions waiting`;
  return `${itemPart}, ${decidePart}.`;
}
