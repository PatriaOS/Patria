import { copy } from './copy';

describe('copy', () => {
  it('keeps user facing strings in one file', () => {
    expect(copy.appName).toBe('Patria');
    expect(copy.welcome.title.length).toBeGreaterThan(0);
    expect(copy.invitePreview.summaryTitle.length).toBeGreaterThan(0);
    expect(copy.home.todoMemories.length).toBeGreaterThan(0);
    expect(copy.home.memories).toBe('Memories');
    expect(copy.memories.householdDefault.length).toBeGreaterThan(0);
    expect(copy.memories.connectBody.length).toBeGreaterThan(0);
    expect(copy.memories.limitedBody).toMatch(/new camera photos/i);
    expect(copy.memories.noLocation).toBe('No location is stored with this photo.');
    expect(copy.memories.noLocationVideo).toBe('No location is stored with this video.');
    expect(copy.memories.skippedVideoTooLong).toMatch(/1 video wasn’t shared/i);
    expect(copy.relationships.mum).toBe('Mom');
    expect(copy.createFamily.failed.length).toBeGreaterThan(0);
    expect(copy.home.joinFamily).toBe('Join another family');
    expect(copy.home.createAnotherFamily).toBe('Create another family');
    expect(copy.member.leave).toBe('Leave family');
    expect(copy.member.leaveConfirm).toMatch(/recovery contact/i);
    expect(copy.home.keysReady).toBe('Family keys: set up on this phone');
    expect(copy.home.keysWaiting).toBe('Waiting for a family admin to let this phone in');
    expect(copy.home.keysWaitingOwnPhone).toBe(
      'Waiting for one of your phones to let this one in',
    );
    expect(copy.home.keysNeedRelink).toBe('This phone needs to be let in again');
    expect(copy.home.letInNotice).toBe('{name} wants this phone let in');
    expect(copy.home.extraDeviceOwnNotice).toBe('Is this your new phone?');
    expect(copy.home.yesMyPhone).toBe('Yes, this is my phone');
    expect(copy.home.notMyPhone).toBe('This wasn’t me');
    expect(copy.home.yourPhones).toBe('Your phones');
    expect(copy.home.recoveryNotSetup).toBe('Recovery: not set up');
    expect(copy.home.recoveryCardTitle).toBe('Set up recovery');
    expect(copy.recovery.printedBody).toMatch(/cannot show them again/i);
    expect(copy.home.lostPhone).toBe('I lost my phone');
    expect(copy.home.stopThisRecovery).toBe('Stop this recovery');
    expect(copy.home.recoveryCancelledByYou).toBe('Cancelled by you');
    expect(copy.home.recoveryNeedsAttention).toBe('Recovery needs attention');
    expect(copy.home.letIn).toBe('Let in');
    expect(copy.home.declineDevice).toBe('Decline');
    expect(copy.member.fallbackName).toBe('Family member');
  });
});
