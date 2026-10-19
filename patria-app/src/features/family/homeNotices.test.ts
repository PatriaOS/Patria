import { countHomeNotices } from './homeNotices';

const notice = {
  id: 'n1',
  spaceId: 's1',
  userId: 'u2',
  deviceId: 'd1',
  publicKey: new Uint8Array(32),
  deviceCreatedAt: '2026-10-18T00:00:00.000Z',
  kind: 'first_device' as const,
};

describe('countHomeNotices', () => {
  it('counts let-in, new phone, recovery and This wasn’t me from Home’s existing data', () => {
    expect(
      countHomeNotices({
        deviceNotices: [notice],
        recoveryStatus: 'needs_attention',
        recoveryPendingInvites: 1,
        recoveryRequests: [
          {
            id: 'r1',
            spaceId: 's1',
            userId: 'u1',
            newDeviceId: 'd2',
            newDeviceCreatedAt: null,
            startedAt: '2026-10-18T00:00:00.000Z',
            notBefore: '2026-10-20T00:00:00.000Z',
            expiresAt: '2026-10-25T00:00:00.000Z',
            cancelledAt: null,
            cancelledBy: null,
            completedAt: null,
          },
        ],
        removedNoticeCount: 1,
        userId: 'u1',
      }),
    ).toBe(5);
  });

  it('ignores finished recovery and a quiet recovery setup', () => {
    expect(
      countHomeNotices({
        deviceNotices: [],
        recoveryStatus: 'setup',
        recoveryPendingInvites: 0,
        recoveryRequests: [
          {
            id: 'r1',
            spaceId: 's1',
            userId: 'u1',
            newDeviceId: 'd2',
            newDeviceCreatedAt: null,
            startedAt: '2026-10-18T00:00:00.000Z',
            notBefore: '2026-10-20T00:00:00.000Z',
            expiresAt: '2026-10-25T00:00:00.000Z',
            cancelledAt: '2026-10-18T01:00:00.000Z',
            cancelledBy: 'u1',
            completedAt: null,
          },
        ],
        removedNoticeCount: 0,
        userId: 'u1',
      }),
    ).toBe(0);
  });
});
