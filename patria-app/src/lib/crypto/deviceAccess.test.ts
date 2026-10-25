import * as SecureStore from 'expo-secure-store';
import { bytesToHex } from '@noble/hashes/utils.js';
import { secretsEqual, wipe } from './bytes';
import {
  approveFirstDevice,
  approveOwnExtraDevice,
  assertOwnExtraDevice,
  declineFirstDevice,
  extraDeviceWrapAad,
  firstDeviceWrapAad,
  rejectOwnExtraDevice,
  removeOwnPhone,
  requestFirstDeviceAccess,
  type DeviceAccessGateway,
  type FirstDeviceNotice,
  type OwnPhone,
} from './deviceAccess';
import { ensureDeviceIdentity } from './deviceIdentity';
import { createFoundingMaterial } from './familyCeremony';
import {
  cacheFamilySecrets,
  familyKeyStoreKey,
  loadCachedFamilyKey,
  resetFamilyKeyMemory,
} from './keyStore';
import { getSecretBytes } from './secureKeys';
import { unwrapKeyFromDevice, wrapKeyToDevice } from './wrap';

jest.mock('./personalKey', () => ({
  wrapPersonalKeyForApprovedDeviceIfPresent: jest.fn(async () => undefined),
}));

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ELENA = '11111111-1111-1111-1111-111111111111';
const MARCO = '22222222-2222-2222-2222-222222222222';
const COUSIN = '55555555-5555-5555-5555-555555555555';

function installMemoryStore(store: Map<string, string>): void {
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    return store.get(key) ?? null;
  });
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    store.delete(key);
  });
}

type ServerState = {
  deviceKeys: Map<
    string,
    { userId: string; deviceId: string; publicKey: Uint8Array; rejectedAt: string | null }
  >;
  wraps: {
    userId: string;
    deviceId: string;
    wrappedKey: Uint8Array;
    keyEpoch: number;
    approvedBy: string;
  }[];
  notices: FirstDeviceNotice[];
};

function emptyServer(): ServerState {
  return { deviceKeys: new Map(), wraps: [], notices: [] };
}

function serverGateway(state: ServerState): DeviceAccessGateway {
  return {
    upsertDevicePublicKey: async (userId, deviceId, publicKey) => {
      state.deviceKeys.set(`${userId}:${deviceId}`, {
        userId,
        deviceId,
        publicKey,
        rejectedAt: null,
      });
    },
    countOwnWraps: async (_spaceId, userId) =>
      state.wraps.filter((row) => row.userId === userId).length,
    insertNotice: async (spaceId, userId, deviceId) => {
      if (state.notices.some((row) => row.userId === userId && row.deviceId === deviceId)) {
        return;
      }
      const key = state.deviceKeys.get(`${userId}:${deviceId}`);
      if (!key) {
        throw new Error('missing device key');
      }
      const extra = state.wraps.some((row) => row.userId === userId);
      state.notices.push({
        id: `notice-${state.notices.length + 1}`,
        spaceId,
        userId,
        deviceId,
        publicKey: key.publicKey,
        deviceCreatedAt: '2026-10-12T12:00:00.000Z',
        kind: extra ? 'extra_device' : 'first_device',
      });
    },
    listNotices: async () => [...state.notices],
    fetchOwnWrap: async (_spaceId, userId, deviceId) => {
      const row = state.wraps.find((item) => item.userId === userId && item.deviceId === deviceId);
      if (!row) {
        return null;
      }
      return { wrappedKey: row.wrappedKey, keyEpoch: row.keyEpoch };
    },
    insertFamilyWrap: async (input) => {
      const key = state.deviceKeys.get(`${input.userId}:${input.deviceId}`);
      if (key?.rejectedAt) {
        throw new Error('rejected device');
      }
      state.wraps.push({
        userId: input.userId,
        deviceId: input.deviceId,
        wrappedKey: input.wrappedKey,
        keyEpoch: input.keyEpoch,
        approvedBy: input.approvedBy,
      });
    },
    insertRecoveryWrap: async () => undefined,
    deleteNotice: async (noticeId) => {
      state.notices = state.notices.filter((row) => row.id !== noticeId);
    },
    rejectPendingDevice: async (_spaceId, deviceId) => {
      const key = [...state.deviceKeys.values()].find((row) => row.deviceId === deviceId);
      if (key) {
        key.rejectedAt = '2026-10-12T13:00:00.000Z';
      }
      state.notices = state.notices.map((row) =>
        row.deviceId === deviceId ? { ...row, kind: 'rejected_device' } : row,
      );
    },
    removeOwnDevice: async (_spaceId, deviceId) => {
      state.wraps = state.wraps.filter((row) => row.deviceId !== deviceId);
      state.notices = state.notices.filter((row) => row.deviceId !== deviceId);
      for (const [pair, row] of [...state.deviceKeys.entries()]) {
        if (row.deviceId === deviceId) {
          state.deviceKeys.delete(pair);
        }
      }
    },
    listOwnPhones: async (_spaceId, userId) => {
      const phones: OwnPhone[] = [];
      for (const row of state.deviceKeys.values()) {
        if (row.userId !== userId) {
          continue;
        }
        phones.push({
          deviceId: row.deviceId,
          createdAt: '2026-10-12T12:00:00.000Z',
          rejectedAt: row.rejectedAt,
          hasWrap: state.wraps.some((wrap) => wrap.deviceId === row.deviceId),
        });
      }
      return phones;
    },
  };
}

async function foundOnInstall(
  store: Map<string, string>,
  userId: string,
): Promise<{ deviceId: string; privateKey: Uint8Array; publicKey: Uint8Array; familyKey: Uint8Array }> {
  installMemoryStore(store);
  const device = await ensureDeviceIdentity(userId);
  const material = createFoundingMaterial({
    spaceId: SPACE,
    userId,
    deviceId: device.deviceId,
    publicKey: device.publicKey,
  });
  await cacheFamilySecrets(userId, SPACE, material.familyKey);
  return {
    deviceId: device.deviceId,
    privateKey: device.privateKey,
    publicKey: device.publicKey,
    familyKey: material.familyKey,
  };
}

describe('first-device approval', () => {
  it('approves by wrapping the family key to the member device with KEYS AAD', async () => {
    const adminPhone = new Map<string, string>();
    const memberPhone = new Map<string, string>();
    const server = emptyServer();
    const gateway = serverGateway(server);
    const admin = await foundOnInstall(adminPhone, ELENA);

    installMemoryStore(memberPhone);
    const marco = await ensureDeviceIdentity(MARCO);
    await requestFirstDeviceAccess(
      { spaceId: SPACE, userId: MARCO, role: 'co_admin', device: marco },
      gateway,
    );
    expect(server.notices).toHaveLength(1);
    expect(server.wraps).toHaveLength(0);

    installMemoryStore(adminPhone);
    await approveFirstDevice(
      {
        spaceId: SPACE,
        adminUserId: ELENA,
        adminDeviceId: admin.deviceId,
        adminPrivateKey: admin.privateKey,
        notice: server.notices[0],
        memberRole: 'co_admin',
      },
      gateway,
    );

    expect(server.notices).toHaveLength(0);
    expect(server.wraps).toHaveLength(1);
    const wrap = server.wraps[0];
    expect(bytesToHex(wrap.wrappedKey).includes(bytesToHex(admin.familyKey))).toBe(false);
    const opened = unwrapKeyFromDevice(
      wrap.wrappedKey,
      marco.privateKey,
      firstDeviceWrapAad({ spaceId: SPACE, userId: MARCO, deviceId: marco.deviceId }),
    );
    expect(secretsEqual(opened, admin.familyKey)).toBe(true);
    wipe(opened);
  });

  it('decline closes the notice and creates no wrap', async () => {
    const memberPhone = new Map<string, string>();
    const server = emptyServer();
    const gateway = serverGateway(server);
    installMemoryStore(memberPhone);
    const marco = await ensureDeviceIdentity(MARCO);
    await requestFirstDeviceAccess(
      { spaceId: SPACE, userId: MARCO, role: 'teen', device: marco },
      gateway,
    );
    await declineFirstDevice(server.notices[0].id, gateway);
    expect(server.notices).toHaveLength(0);
    expect(server.wraps).toHaveLength(0);
  });

  it('does not create a notice for ineligible roles', async () => {
    const phone = new Map<string, string>();
    const server = emptyServer();
    const gateway = serverGateway(server);
    installMemoryStore(phone);
    const cousin = await ensureDeviceIdentity(COUSIN);
    const result = await requestFirstDeviceAccess(
      { spaceId: SPACE, userId: COUSIN, role: 'extended_relative', device: cousin },
      gateway,
    );
    expect(result).toBe('skipped');
    expect(server.notices).toHaveLength(0);
    expect(server.deviceKeys.size).toBe(0);
  });

  it('keeps signed-out account keys unread by the next session on the same phone', async () => {
    const phone = new Map<string, string>();
    const admin = await foundOnInstall(phone, ELENA);
    const elenaKey = await getSecretBytes(familyKeyStoreKey(ELENA, SPACE));
    expect(elenaKey).not.toBeNull();
    const marco = await ensureDeviceIdentity(MARCO);
    expect(marco.deviceId).not.toBe(admin.deviceId);
    expect(await loadCachedFamilyKey(MARCO, SPACE)).toBeNull();
    expect(await loadCachedFamilyKey(ELENA, SPACE)).not.toBeNull();
  });

  it('produces the same notice and wrap on one install and on two installs', async () => {
    async function run(adminStore: Map<string, string>, memberStore: Map<string, string>) {
      const server = emptyServer();
      const gateway = serverGateway(server);
      const admin = await foundOnInstall(adminStore, ELENA);
      installMemoryStore(memberStore);
      const marco = await ensureDeviceIdentity(MARCO);
      await requestFirstDeviceAccess(
        { spaceId: SPACE, userId: MARCO, role: 'elder', device: marco },
        gateway,
      );
      const notice = server.notices[0];
      installMemoryStore(adminStore);
      await approveFirstDevice(
        {
          spaceId: SPACE,
          adminUserId: ELENA,
          adminDeviceId: admin.deviceId,
          adminPrivateKey: admin.privateKey,
          notice,
          memberRole: 'elder',
        },
        gateway,
      );
      const wrap = server.wraps[0];
      const aad = firstDeviceWrapAad({
        spaceId: SPACE,
        userId: MARCO,
        deviceId: marco.deviceId,
      });
      const opened = unwrapKeyFromDevice(wrap.wrappedKey, marco.privateKey, aad);
      return {
        noticeUserId: notice.userId,
        noticeDeviceId: notice.deviceId,
        wrapUserId: wrap.userId,
        wrapDeviceId: wrap.deviceId,
        approvedBy: wrap.approvedBy,
        aad,
        opened,
        familyKey: admin.familyKey,
      };
    }

    const shared = new Map<string, string>();
    const oneInstall = await run(shared, shared);

    const adminPhone = new Map<string, string>();
    const memberPhone = new Map<string, string>();
    const twoInstalls = await run(adminPhone, memberPhone);

    expect(oneInstall.noticeUserId).toBe(MARCO);
    expect(twoInstalls.noticeUserId).toBe(MARCO);
    expect(oneInstall.wrapUserId).toBe(MARCO);
    expect(twoInstalls.wrapUserId).toBe(MARCO);
    expect(oneInstall.approvedBy).toBe(ELENA);
    expect(twoInstalls.approvedBy).toBe(ELENA);
    expect(oneInstall.aad.familySpaceId).toBe(SPACE);
    expect(twoInstalls.aad.familySpaceId).toBe(SPACE);
    expect(oneInstall.aad.keyEpoch).toBe(1);
    expect(twoInstalls.aad.keyEpoch).toBe(1);
    expect(oneInstall.aad.userId).toBe(MARCO);
    expect(twoInstalls.aad.userId).toBe(MARCO);
    expect(oneInstall.noticeDeviceId).toBe(oneInstall.wrapDeviceId);
    expect(twoInstalls.noticeDeviceId).toBe(twoInstalls.wrapDeviceId);
    expect(oneInstall.aad.deviceId).toBe(oneInstall.wrapDeviceId);
    expect(twoInstalls.aad.deviceId).toBe(twoInstalls.wrapDeviceId);
    expect(secretsEqual(oneInstall.opened, oneInstall.familyKey)).toBe(true);
    expect(secretsEqual(twoInstalls.opened, twoInstalls.familyKey)).toBe(true);
    wipe(oneInstall.opened);
    wipe(twoInstalls.opened);
  });

  it('approves when the member public key was JSON-cloned between two installs', async () => {
    const adminPhone = new Map<string, string>();
    const memberPhone = new Map<string, string>();
    const server = emptyServer();
    const gateway = serverGateway(server);
    const admin = await foundOnInstall(adminPhone, ELENA);
    installMemoryStore(memberPhone);
    const marco = await ensureDeviceIdentity(MARCO);
    await requestFirstDeviceAccess(
      { spaceId: SPACE, userId: MARCO, role: 'elder', device: marco },
      gateway,
    );
    const cloned = JSON.parse(JSON.stringify(server.notices[0])) as FirstDeviceNotice;
    installMemoryStore(adminPhone);
    await approveFirstDevice(
      {
        spaceId: SPACE,
        adminUserId: ELENA,
        adminDeviceId: admin.deviceId,
        adminPrivateKey: admin.privateKey,
        notice: cloned,
        memberRole: 'elder',
      },
      gateway,
    );
    const wrap = server.wraps[0];
    const opened = unwrapKeyFromDevice(
      wrap.wrappedKey,
      marco.privateKey,
      firstDeviceWrapAad({ spaceId: SPACE, userId: MARCO, deviceId: marco.deviceId }),
    );
    expect(secretsEqual(opened, admin.familyKey)).toBe(true);
    wipe(opened);
  });

  it('lets an admin wrap after a restart that cleared the local cache', async () => {
    const adminPhone = new Map<string, string>();
    const memberPhone = new Map<string, string>();
    const server = emptyServer();
    const gateway = serverGateway(server);
    const admin = await foundOnInstall(adminPhone, ELENA);
    const adminWrap = wrapKeyToDevice(admin.familyKey, admin.publicKey, firstDeviceWrapAad({
      spaceId: SPACE,
      userId: ELENA,
      deviceId: admin.deviceId,
    }));
    server.wraps.push({
      userId: ELENA,
      deviceId: admin.deviceId,
      wrappedKey: adminWrap,
      keyEpoch: 1,
      approvedBy: ELENA,
    });
    installMemoryStore(memberPhone);
    const marco = await ensureDeviceIdentity(MARCO);
    await requestFirstDeviceAccess(
      { spaceId: SPACE, userId: MARCO, role: 'elder', device: marco },
      gateway,
    );

    installMemoryStore(adminPhone);
    adminPhone.delete(familyKeyStoreKey(ELENA, SPACE));
    resetFamilyKeyMemory();
    await approveFirstDevice(
      {
        spaceId: SPACE,
        adminUserId: ELENA,
        adminDeviceId: admin.deviceId,
        adminPrivateKey: admin.privateKey,
        notice: server.notices[0],
        memberRole: 'elder',
      },
      gateway,
    );
    const memberWrap = server.wraps.find((row) => row.userId === MARCO);
    expect(memberWrap).toBeTruthy();
    const opened = unwrapKeyFromDevice(
      memberWrap!.wrappedKey,
      marco.privateKey,
      firstDeviceWrapAad({ spaceId: SPACE, userId: MARCO, deviceId: marco.deviceId }),
    );
    expect(secretsEqual(opened, admin.familyKey)).toBe(true);
    wipe(opened);
  });

  it('never auto-wraps when a public key is uploaded', async () => {
    const phone = new Map<string, string>();
    const server = emptyServer();
    const gateway = serverGateway(server);
    installMemoryStore(phone);
    const marco = await ensureDeviceIdentity(MARCO);
    await requestFirstDeviceAccess(
      { spaceId: SPACE, userId: MARCO, role: 'teen', device: marco },
      gateway,
    );
    expect(server.wraps).toHaveLength(0);
  });
});

describe('extra-device self approval', () => {
  it('throws if the caller is not the device owner', () => {
    expect(() => assertOwnExtraDevice(ELENA, MARCO)).toThrow('extra device wrap is self-only');
  });

  it('wraps from an existing phone after a restart, on two separate installs', async () => {
    async function run(oldPhone: Map<string, string>, newPhone: Map<string, string>) {
      const server = emptyServer();
      const gateway = serverGateway(server);
      const existing = await foundOnInstall(oldPhone, ELENA);
      const foundingWrap = wrapKeyToDevice(
        existing.familyKey,
        existing.publicKey,
        extraDeviceWrapAad({
          spaceId: SPACE,
          userId: ELENA,
          deviceId: existing.deviceId,
        }),
      );
      server.wraps.push({
        userId: ELENA,
        deviceId: existing.deviceId,
        wrappedKey: foundingWrap,
        keyEpoch: 1,
        approvedBy: ELENA,
      });
      server.deviceKeys.set(`${ELENA}:${existing.deviceId}`, {
        userId: ELENA,
        deviceId: existing.deviceId,
        publicKey: existing.publicKey,
        rejectedAt: null,
      });

      installMemoryStore(newPhone);
      const extra = await ensureDeviceIdentity(ELENA);
      await requestFirstDeviceAccess(
        { spaceId: SPACE, userId: ELENA, role: 'family_admin', device: extra },
        gateway,
      );
      expect(server.notices[0].kind).toBe('extra_device');

      installMemoryStore(oldPhone);
      oldPhone.delete(familyKeyStoreKey(ELENA, SPACE));
      resetFamilyKeyMemory();
      await approveOwnExtraDevice(
        {
          spaceId: SPACE,
          userId: ELENA,
          approverDeviceId: existing.deviceId,
          approverPrivateKey: existing.privateKey,
          notice: server.notices[0],
          role: 'family_admin',
        },
        gateway,
      );
      const extraWrap = server.wraps.find((row) => row.deviceId === extra.deviceId);
      expect(extraWrap).toBeTruthy();
      const opened = unwrapKeyFromDevice(
        extraWrap!.wrappedKey,
        extra.privateKey,
        extraDeviceWrapAad({
          spaceId: SPACE,
          userId: ELENA,
          deviceId: extra.deviceId,
        }),
      );
      return {
        opened,
        familyKey: existing.familyKey,
        approvedBy: extraWrap!.approvedBy,
        noticeKind: 'extra_device' as const,
        extraDeviceId: extra.deviceId,
      };
    }

    const oneOld = new Map<string, string>();
    const oneNew = new Map<string, string>();
    const twoOld = new Map<string, string>();
    const twoNew = new Map<string, string>();
    const first = await run(oneOld, oneNew);
    const second = await run(twoOld, twoNew);
    expect(first.approvedBy).toBe(ELENA);
    expect(second.approvedBy).toBe(ELENA);
    expect(secretsEqual(first.opened, first.familyKey)).toBe(true);
    expect(secretsEqual(second.opened, second.familyKey)).toBe(true);
    wipe(first.opened);
    wipe(second.opened);
  });

  it('rejects a pending extra device so it can never be wrapped', async () => {
    const oldPhone = new Map<string, string>();
    const newPhone = new Map<string, string>();
    const server = emptyServer();
    const gateway = serverGateway(server);
    const existing = await foundOnInstall(oldPhone, ELENA);
    server.wraps.push({
      userId: ELENA,
      deviceId: existing.deviceId,
      wrappedKey: wrapKeyToDevice(
        existing.familyKey,
        existing.publicKey,
        extraDeviceWrapAad({
          spaceId: SPACE,
          userId: ELENA,
          deviceId: existing.deviceId,
        }),
      ),
      keyEpoch: 1,
      approvedBy: ELENA,
    });
    installMemoryStore(newPhone);
    const extra = await ensureDeviceIdentity(ELENA);
    await requestFirstDeviceAccess(
      { spaceId: SPACE, userId: ELENA, role: 'family_admin', device: extra },
      gateway,
    );
    installMemoryStore(oldPhone);
    await rejectOwnExtraDevice(
      { spaceId: SPACE, userId: ELENA, notice: server.notices[0] },
      gateway,
    );
    expect(server.notices[0].kind).toBe('rejected_device');
    await expect(
      approveOwnExtraDevice(
        {
          spaceId: SPACE,
          userId: ELENA,
          approverDeviceId: existing.deviceId,
          approverPrivateKey: existing.privateKey,
          notice: { ...server.notices[0], kind: 'extra_device' },
          role: 'family_admin',
        },
        gateway,
      ),
    ).rejects.toThrow('rejected device');
  });

  it('removes only the other device wraps and public key', async () => {
    const oldPhone = new Map<string, string>();
    const newPhone = new Map<string, string>();
    const server = emptyServer();
    const gateway = serverGateway(server);
    const existing = await foundOnInstall(oldPhone, ELENA);
    server.deviceKeys.set(`${ELENA}:${existing.deviceId}`, {
      userId: ELENA,
      deviceId: existing.deviceId,
      publicKey: existing.publicKey,
      rejectedAt: null,
    });
    server.wraps.push({
      userId: ELENA,
      deviceId: existing.deviceId,
      wrappedKey: new Uint8Array(64),
      keyEpoch: 1,
      approvedBy: ELENA,
    });
    installMemoryStore(newPhone);
    const extra = await ensureDeviceIdentity(ELENA);
    await requestFirstDeviceAccess(
      { spaceId: SPACE, userId: ELENA, role: 'family_admin', device: extra },
      gateway,
    );
    server.wraps.push({
      userId: ELENA,
      deviceId: extra.deviceId,
      wrappedKey: new Uint8Array(64),
      keyEpoch: 1,
      approvedBy: ELENA,
    });
    installMemoryStore(oldPhone);
    await removeOwnPhone(
      {
        spaceId: SPACE,
        userId: ELENA,
        deviceId: extra.deviceId,
        thisDeviceId: existing.deviceId,
      },
      gateway,
    );
    expect(server.wraps.some((row) => row.deviceId === extra.deviceId)).toBe(false);
    expect(server.wraps.some((row) => row.deviceId === existing.deviceId)).toBe(true);
    expect(server.deviceKeys.has(`${ELENA}:${extra.deviceId}`)).toBe(false);
    expect(server.deviceKeys.has(`${ELENA}:${existing.deviceId}`)).toBe(true);
    await expect(
      removeOwnPhone(
        {
          spaceId: SPACE,
          userId: ELENA,
          deviceId: existing.deviceId,
          thisDeviceId: existing.deviceId,
        },
        gateway,
      ),
    ).rejects.toThrow('cannot remove this phone');
  });

  it('does not let an admin wrap another member extra device', async () => {
    const adminPhone = new Map<string, string>();
    const memberOld = new Map<string, string>();
    const memberNew = new Map<string, string>();
    const server = emptyServer();
    const gateway = serverGateway(server);
    const admin = await foundOnInstall(adminPhone, ELENA);
    const marcoOld = await foundOnInstall(memberOld, MARCO);
    server.wraps.push({
      userId: MARCO,
      deviceId: marcoOld.deviceId,
      wrappedKey: new Uint8Array(64),
      keyEpoch: 1,
      approvedBy: ELENA,
    });
    installMemoryStore(memberNew);
    const extra = await ensureDeviceIdentity(MARCO);
    await requestFirstDeviceAccess(
      { spaceId: SPACE, userId: MARCO, role: 'co_admin', device: extra },
      gateway,
    );
    expect(server.notices[0].kind).toBe('extra_device');
    installMemoryStore(adminPhone);
    await expect(
      approveFirstDevice(
        {
          spaceId: SPACE,
          adminUserId: ELENA,
          adminDeviceId: admin.deviceId,
          adminPrivateKey: admin.privateKey,
          notice: server.notices[0],
          memberRole: 'co_admin',
        },
        gateway,
      ),
    ).rejects.toThrow('first-device wrap only');
    expect(() => assertOwnExtraDevice(ELENA, MARCO)).toThrow('extra device wrap is self-only');
  });
});
