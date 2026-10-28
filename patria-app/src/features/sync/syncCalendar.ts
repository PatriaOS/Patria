import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  EntityTypes,
  ExpoCalendarEvent,
  getCalendars,
  getDefaultCalendarSync,
  requestCalendarPermissions,
  type ExpoCalendar,
} from 'expo-calendar';
import { Platform } from 'react-native';

import { copy } from '../../lib/copy';

export const SYNC_CALENDAR_EVENT_TITLE = 'Family Sync';
export const SYNC_CALENDAR_LINK = 'patria://sync';
export const SYNC_CALENDAR_DURATION_MS = 30 * 60 * 1000;

export type SyncCalendarEventDraft = {
  title: string;
  startDate: Date;
  endDate: Date;
  notes: string;
  url: string;
};

export function buildSyncCalendarEvent(scheduledFor: Date): SyncCalendarEventDraft {
  return {
    title: SYNC_CALENDAR_EVENT_TITLE,
    startDate: scheduledFor,
    endDate: new Date(scheduledFor.getTime() + SYNC_CALENDAR_DURATION_MS),
    notes: SYNC_CALENDAR_LINK,
    url: SYNC_CALENDAR_LINK,
  };
}

function storageKey(userId: string, spaceId: string, meetingId: string): string {
  return `patria.syncCalendar.${userId}.${spaceId}.${meetingId}`;
}

export async function loadStoredCalendarEventId(
  userId: string,
  spaceId: string,
  meetingId: string,
): Promise<string | null> {
  return AsyncStorage.getItem(storageKey(userId, spaceId, meetingId));
}

export async function storeCalendarEventId(
  userId: string,
  spaceId: string,
  meetingId: string,
  eventId: string,
): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId, spaceId, meetingId), eventId);
}

export type AddToCalendarResult =
  | { ok: true; eventId: string; updated: boolean }
  | { ok: false; reason: 'denied' | 'unavailable' | 'failed' };

async function ensureWritableCalendar(): Promise<ExpoCalendar | null> {
  const calendars = await getCalendars(EntityTypes.EVENT);
  const writable = calendars.find((cal) => cal.allowsModifications) ?? calendars[0];
  if (writable) {
    return writable;
  }
  if (Platform.OS === 'ios') {
    try {
      return getDefaultCalendarSync();
    } catch {
      return null;
    }
  }
  return null;
}

/** Request permission only when the person taps Add to my calendar (D37). */
export async function addOrUpdateSyncCalendarEvent(input: {
  userId: string;
  spaceId: string;
  meetingId: string;
  scheduledFor: Date;
}): Promise<AddToCalendarResult> {
  try {
    const existing = await loadStoredCalendarEventId(
      input.userId,
      input.spaceId,
      input.meetingId,
    );
    // writeOnly: create Family Sync without reading other calendar events (iOS 17+).
    const permission = await requestCalendarPermissions(true);
    if (!permission.granted) {
      return { ok: false, reason: 'denied' };
    }

    const draft = buildSyncCalendarEvent(input.scheduledFor);

    if (existing) {
      try {
        const event = await ExpoCalendarEvent.get(existing);
        await event.update({
          title: draft.title,
          startDate: draft.startDate,
          endDate: draft.endDate,
          notes: draft.notes,
          location: draft.url,
        });
        return { ok: true, eventId: existing, updated: true };
      } catch {
        // Fall through and create a fresh event if the stored id is gone.
      }
    }

    const calendar = await ensureWritableCalendar();
    if (!calendar) {
      return { ok: false, reason: 'unavailable' };
    }

    const created = await calendar.createEvent({
      title: draft.title,
      startDate: draft.startDate,
      endDate: draft.endDate,
      notes: draft.notes,
      location: draft.url,
    });
    const eventId = created.id;
    if (!eventId) {
      return { ok: false, reason: 'failed' };
    }
    await storeCalendarEventId(input.userId, input.spaceId, input.meetingId, eventId);
    return { ok: true, eventId, updated: false };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export function calendarPermissionMessage(): string {
  return copy.sync.calendarPermissionBody;
}
