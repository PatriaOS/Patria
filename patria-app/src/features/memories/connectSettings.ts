import { copy } from '../../lib/copy';
import type { PillTone } from '../../ui';
import type { LibraryMode } from './libraryApi';

export function canTurnOnSharing(input: {
  mode: LibraryMode;
  circleId: string | null;
  albumIds: readonly string[];
}): boolean {
  if (!input.circleId) {
    return false;
  }
  if (input.mode === 'selected_albums' && input.albumIds.length === 0) {
    return false;
  }
  return true;
}

export function libraryStatusTone(status: string): PillTone {
  if (status === copy.memories.statusChooseCircle) {
    return 'danger';
  }
  if (status === copy.memories.statusUpToDate) {
    return 'success';
  }
  return 'wait';
}
