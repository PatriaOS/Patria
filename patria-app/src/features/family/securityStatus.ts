import { copy } from '../../lib/copy';
import type { FamilyKeyStatus } from '../../lib/crypto/familyCeremony';
import type { PersonalKeyDeviceStatus } from '../../lib/crypto/personalKey';
import type { RecoveryHomeStatus } from '../../lib/crypto/recoverySetup';
import type { PillTone } from '../../ui';

export function keyStatusLabel(status: FamilyKeyStatus): string {
  if (status === 'ready') {
    return copy.home.keysReady;
  }
  if (status === 'needsRelink') {
    return copy.home.keysNeedRelink;
  }
  if (status === 'waitingOwnPhone') {
    return copy.home.keysWaitingOwnPhone;
  }
  return copy.home.keysWaiting;
}

export function personalKeyStatusLabel(status: PersonalKeyDeviceStatus): string {
  if (status === 'ready') {
    return copy.home.personalKeysReady;
  }
  if (status === 'needsOtherPhone') {
    return copy.home.personalKeysNeedOtherPhone;
  }
  if (status === 'needsRecovery') {
    return copy.home.personalKeysNeedRecoveryPill;
  }
  return copy.home.personalKeysEnrollFailedPill;
}

export function personalKeyStatusTone(status: PersonalKeyDeviceStatus): PillTone {
  if (status === 'ready') {
    return 'success';
  }
  if (status === 'needsOtherPhone' || status === 'needsRecovery') {
    return 'wait';
  }
  return 'danger';
}

export type RecoveryPill = { label: string; tone: PillTone };

/** Same wording and tones Home used before D35; Family now shows them all the time. */
export function recoveryPill(input: {
  keyHolder: boolean;
  admin: boolean;
  familyName: string;
  status: RecoveryHomeStatus | undefined;
}): RecoveryPill | null {
  const { keyHolder, admin, familyName, status } = input;
  const tone: PillTone =
    status === 'needs_attention' ? 'danger' : status === 'setup' ? 'success' : 'wait';
  if (keyHolder && status === 'not_setup') {
    return { label: copy.home.recoveryNotSetup, tone };
  }
  if (keyHolder && status === 'one_of_two') {
    return { label: copy.home.recoveryOneOfTwo, tone };
  }
  if (keyHolder && status === 'needs_attention') {
    return { label: copy.home.recoveryNeedsAttention, tone };
  }
  if (keyHolder && status === 'almost_done') {
    return { label: copy.home.recoveryAlmostDone, tone };
  }
  if (keyHolder && status === 'setup') {
    return { label: copy.home.recoverySetup, tone };
  }
  if (!admin && status === 'contact') {
    return { label: copy.home.recoveryYouAreContact.replace('{family}', familyName), tone };
  }
  return null;
}