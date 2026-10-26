import { copy } from '../../lib/copy';
import { keyStatusLabel, recoveryPill } from './securityStatus';

describe('keyStatusLabel', () => {
  it('keeps the wording Home used', () => {
    expect(keyStatusLabel('ready')).toBe(copy.home.keysReady);
    expect(keyStatusLabel('waiting')).toBe(copy.home.keysWaiting);
    expect(keyStatusLabel('waitingOwnPhone')).toBe(copy.home.keysWaitingOwnPhone);
    expect(keyStatusLabel('needsRelink')).toBe(copy.home.keysNeedRelink);
  });
});

describe('recoveryPill', () => {
  const base = { keyHolder: true, admin: true, familyName: 'The Riveras' };

  it('maps each key-holder status to the same label and tone as before', () => {
    expect(recoveryPill({ ...base, status: 'not_setup' })).toEqual({
      label: copy.home.recoveryNotSetup,
      tone: 'wait',
    });
    expect(recoveryPill({ ...base, status: 'one_of_two' })?.label).toBe(copy.home.recoveryOneOfTwo);
    expect(recoveryPill({ ...base, status: 'setup' })).toEqual({
      label: copy.home.recoverySetup,
      tone: 'success',
    });
    expect(recoveryPill({ ...base, status: 'needs_attention' })).toEqual({
      label: copy.home.recoveryNeedsAttention,
      tone: 'danger',
    });
  });

  it('tells a non-admin contact which family they help and hides unknown states', () => {
    expect(
      recoveryPill({ keyHolder: false, admin: false, familyName: 'The Riveras', status: 'contact' })
        ?.label,
    ).toBe('You are a recovery contact for The Riveras');
    expect(recoveryPill({ ...base, status: undefined })).toBeNull();
    expect(recoveryPill({ ...base, keyHolder: false, status: 'not_setup' })).toBeNull();
  });
});
