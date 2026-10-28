// SECURITY REVIEW REQUIRED — calendar event ids stay on-device only; never log them.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CalendarDialogResultActions,
  createEventInCalendarAsync,
  DayOfTheWeek,
  Frequency,
  type RecurrenceRule,
} from 'expo-calendar/legacy';

import { copy } from '../../lib/copy';
import type { SyncFrequency, SyncMonthlyMode } from './syncSchedule';

export const SYNC_CALENDAR_EVENT_TITLE = 'Family Sync';
export const SYNC_CALENDAR_LINK = 'patria://sync';
export const SYNC_CALENDAR_DURATION_MS = 30 * 60 * 1000;

export type SyncCalendarEventDraft = {
  title: string;
  startDate: Date;
  endDate: Date;
  notes: string;
  url: string;
  recurrenceRule?: RecurrenceRule;
};

export type SyncCalendarScheduleInput = {
  frequency: SyncFrequency;
  weekday: number;
  monthlyMode: SyncMonthlyMode | null;
  monthlyOrdinal: number | null;
  monthDay: number | null;
};

type StoredCalendarEvent = {
  eventId: string;
  scheduledFor: string;
};

/** Dev-only: error code + message. Never event ids, titles, or times. */
function logCalendarError(error: unknown): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === 'string' ? record.code : 'unknown';
  const message = typeof record.message === 'string' ? record.message : 'error';
  console.warn('[syncCalendar]', code, message);
}

function storageKey(userId: string, spaceId: string, meetingId: string): string {
  return `patria.syncCalendar.${userId}.${spaceId}.${meetingId}`;
}

/** Map Patria weekday (0 = Sunday) to EventKit DayOfTheWeek (Sunday = 1). */
function dayOfTheWeekFromSchedule(weekday: number): DayOfTheWeek {
  const mapped = weekday + 1;
  if (mapped >= DayOfTheWeek.Sunday && mapped <= DayOfTheWeek.Saturday) {
    return mapped as DayOfTheWeek;
  }
  return DayOfTheWeek.Sunday;
}

export function recurrenceForSchedule(schedule: SyncCalendarScheduleInput): RecurrenceRule {
  if (schedule.frequency === 'weekly') {
    return { frequency: Frequency.WEEKLY, interval: 1 };
  }
  if (schedule.frequency === 'every_two_weeks') {
    return { frequency: Frequency.WEEKLY, interval: 2 };
  }
  if (schedule.monthlyMode === 'same_date' && schedule.monthDay != null) {
    return {
      frequency: Frequency.MONTHLY,
      interval: 1,
      daysOfTheMonth: [schedule.monthDay],
    };
  }
  return {
    frequency: Frequency.MONTHLY,
    interval: 1,
    daysOfTheWeek: [
      {
        dayOfTheWeek: dayOfTheWeekFromSchedule(schedule.weekday),
        weekNumber: schedule.monthlyOrdinal ?? 1,
      },
    ],
  };
}

export function buildSyncCalendarEvent(
  scheduledFor: Date,
  schedule?: SyncCalendarScheduleInput | null,
): SyncCalendarEventDraft {
  return {
    title: SYNC_CALENDAR_EVENT_TITLE,
    startDate: scheduledFor,
    endDate: new Date(scheduledFor.getTime() + SYNC_CALENDAR_DURATION_MS),
    notes: SYNC_CALENDAR_LINK,
    url: SYNC_CALENDAR_LINK,
    recurrenceRule: schedule ? recurrenceForSchedule(schedule) : undefined,
  };
}

async function loadStoredCalendarEvent(
  userId: string,
  spaceId: string,
  meetingId: string,
): Promise<StoredCalendarEvent | null> {
  const raw = await AsyncStorage.getItem(storageKey(userId, spaceId, meetingId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCalendarEvent>;
    if (typeof parsed.eventId === 'string' && typeof parsed.scheduledFor === 'string') {
      return { eventId: parsed.eventId, scheduledFor: parsed.scheduledFor };
    }
    // Legacy: raw event id string only.
    if (typeof raw === 'string' && raw.length > 0 && !raw.startsWith('{')) {
      return { eventId: raw, scheduledFor: '' };
    }
  } catch {
    if (raw.length > 0) {
      return { eventId: raw, scheduledFor: '' };
    }
  }
  return null;
}

async function storeCalendarEvent(
  userId: string,
  spaceId: string,
  meetingId: string,
  stored: StoredCalendarEvent,
): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId, spaceId, meetingId), JSON.stringify(stored));
}

export async function loadStoredCalendarEventId(
  userId: string,
  spaceId: string,
  meetingId: string,
): Promise<string | null> {
  const stored = await loadStoredCalendarEvent(userId, spaceId, meetingId);
  return stored?.eventId ?? null;
}

export async function calendarNeedsNewTimeLabel(input: {
  userId: string;
  spaceId: string;
  meetingId: string;
  scheduledFor: Date;
}): Promise<boolean> {
  const stored = await loadStoredCalendarEvent(input.userId, input.spaceId, input.meetingId);
  if (!stored) {
    return false;
  }
  return stored.scheduledFor !== input.scheduledFor.toISOString();
}

export type AddToCalendarResult =
  | { ok: true; replacedPrior: boolean }
  | { ok: false; reason: 'canceled' | 'unavailable' | 'failed' };

/**
 * Opens the system Add Event sheet (no calendar permission on iOS 17+).
 * Patria never lists or reads calendars. Event id stays on the phone only.
 */
export async function addOrUpdateSyncCalendarEvent(input: {
  userId: string;
  spaceId: string;
  meetingId: string;
  scheduledFor: Date;
  schedule?: SyncCalendarScheduleInput | null;
}): Promise<AddToCalendarResult> {
  try {
    const prior = await loadStoredCalendarEvent(input.userId, input.spaceId, input.meetingId);
    const replacedPrior =
      Boolean(prior) && prior!.scheduledFor !== input.scheduledFor.toISOString();
    const draft = buildSyncCalendarEvent(input.scheduledFor, input.schedule);

    // System sheet — no getCalendars / getDefaultCalendar (write-only cannot list real calendars).
    const result = await createEventInCalendarAsync({
      title: draft.title,
      startDate: draft.startDate,
      endDate: draft.endDate,
      notes: draft.notes,
      url: draft.url,
      recurrenceRule: draft.recurrenceRule,
    });

    if (result.action === CalendarDialogResultActions.canceled) {
      return { ok: false, reason: 'canceled' };
    }
    if (result.action !== CalendarDialogResultActions.saved) {
      return { ok: false, reason: 'canceled' };
    }
    if (result.id) {
      await storeCalendarEvent(input.userId, input.spaceId, input.meetingId, {
        eventId: result.id,
        scheduledFor: input.scheduledFor.toISOString(),
      });
    }
    return { ok: true, replacedPrior };
  } catch (error) {
    logCalendarError(error);
    return { ok: false, reason: 'failed' };
  }
}

export function calendarPermissionMessage(): string {
  return copy.sync.calendarPermissionBody;
}
