// SECURITY REVIEW REQUIRED
import { supabase } from '../supabase';
import { ensureDeviceIdentity } from './deviceIdentity';
import { loadCachedPersonalKey } from './keyStore';
import {
  enrollPersonalWrapFromCacheIfApproved,
  ensurePersonalKeyAfterFamilyReady,
  loadPersonalKeyIfPresent,
} from './personalKey';
import { randomKey32 } from './random';

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('./deviceIdentity', () => ({
  ensureDeviceIdentity: jest.fn(),
}));

jest.mock('./keyStore', () => {
  const actual = jest.requireActual('./keyStore') as typeof import('./keyStore');
  return {
    ...actual,
    loadCachedPersonalKey: jest.fn(),
    cachePersonalKey: jest.fn(),
  };
});

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = '11111111-1111-1111-1111-111111111111';
const DEVICE = 'd1111111-1111-1111-1111-111111111111';

describe('enrollPersonalWrapFromCacheIfApproved', () => {
  const personalKey = randomKey32();
  const insertPersonal = jest.fn().mockResolvedValue({ data: null, error: null });

  beforeEach(() => {
    jest.clearAllMocks();
    insertPersonal.mockClear();
    (ensureDeviceIdentity as jest.Mock).mockResolvedValue({
      deviceId: DEVICE,
      publicKey: new Uint8Array(32).fill(1),
      privateKey: new Uint8Array(32).fill(2),
    });
    (loadCachedPersonalKey as jest.Mock).mockResolvedValue(personalKey);
  });

  function mockTables(options: { familyWrap: boolean; personalWrap: boolean }) {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'family_key_wraps') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: options.familyWrap ? { device_id: DEVICE } : null,
            error: null,
          }),
        };
      }
      if (table === 'personal_key_wraps') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: options.personalWrap
              ? { wrapped_key: `\\x${'ab'.repeat(80)}` }
              : null,
            error: null,
          }),
          insert: insertPersonal,
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
  }

  it('does not enroll when the device is not yet let in', async () => {
    mockTables({ familyWrap: false, personalWrap: false });
    const result = await enrollPersonalWrapFromCacheIfApproved({
      spaceId: SPACE,
      userId: USER,
      personalKey,
    });
    expect(result).toBe('not_approved');
    expect(insertPersonal).not.toHaveBeenCalled();
  });

  it('enrolls a personal wrap only after the device already has a family wrap', async () => {
    mockTables({ familyWrap: true, personalWrap: false });
    const result = await enrollPersonalWrapFromCacheIfApproved({
      spaceId: SPACE,
      userId: USER,
      personalKey,
    });
    expect(result).toBe('enrolled');
    expect(insertPersonal).toHaveBeenCalledTimes(1);
    expect(insertPersonal.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        family_space_id: SPACE,
        user_id: USER,
        device_id: DEVICE,
      }),
    );
  });

  it('skips enroll when a personal wrap already exists for the approved device', async () => {
    mockTables({ familyWrap: true, personalWrap: true });
    const result = await enrollPersonalWrapFromCacheIfApproved({
      spaceId: SPACE,
      userId: USER,
      personalKey,
    });
    expect(result).toBe('already');
    expect(insertPersonal).not.toHaveBeenCalled();
  });

  it('loadPersonalKeyIfPresent does not create a wrap for an unapproved device', async () => {
    mockTables({ familyWrap: false, personalWrap: false });
    const loaded = await loadPersonalKeyIfPresent({ spaceId: SPACE, userId: USER });
    expect(loaded).toBe(personalKey);
    expect(insertPersonal).not.toHaveBeenCalled();
  });

  it('loadPersonalKeyIfPresent surfaces enroll insert failures', async () => {
    mockTables({ familyWrap: true, personalWrap: false });
    insertPersonal.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'denied' },
    });
    await expect(
      loadPersonalKeyIfPresent({ spaceId: SPACE, userId: USER }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('ensurePersonalKeyAfterFamilyReady', () => {
  const personalKey = randomKey32();

  beforeEach(() => {
    jest.clearAllMocks();
    (ensureDeviceIdentity as jest.Mock).mockResolvedValue({
      deviceId: DEVICE,
      publicKey: new Uint8Array(32).fill(1),
      privateKey: new Uint8Array(32).fill(2),
    });
    (loadCachedPersonalKey as jest.Mock).mockResolvedValue(personalKey);
  });

  function mockEnsureTables(options: {
    familyWrap: boolean;
    personalWrap: boolean;
    wrapsAnywhere?: number;
    underRecovery?: boolean;
    recoveryPublic?: boolean;
    /** Mirrors has_recovery_setup (public + 2 accepted). Default true when public present. */
    recoverySetup?: boolean;
    insertError?: { code: string } | null;
  }) {
    const insert = jest.fn().mockResolvedValue({
      data: null,
      error: options.insertError ?? null,
    });
    const recoverySetup =
      options.recoverySetup ?? (options.recoveryPublic === false ? false : true);
    (supabase.rpc as jest.Mock).mockImplementation((fn: string) => {
      if (fn === 'has_recovery_setup') {
        return Promise.resolve({ data: recoverySetup, error: null });
      }
      if (fn === 'create_personal_key') {
        return Promise.resolve({ data: null, error: options.insertError ?? null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'family_key_wraps') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: options.familyWrap ? { device_id: DEVICE } : null,
            error: null,
          }),
        };
      }
      if (table === 'personal_key_wraps') {
        const api: Record<string, unknown> = {};
        api.select = jest.fn(() => api);
        api.eq = jest.fn(() => api);
        api.maybeSingle = jest.fn(async () => ({
          data: options.personalWrap ? { wrapped_key: `\\x${'ab'.repeat(80)}` } : null,
          error: null,
        }));
        api.insert = insert;
        const countResult = {
          count: options.wrapsAnywhere ?? (options.personalWrap ? 1 : 0),
          error: null,
        };
        Object.assign(api, countResult);
        api.then = (
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(countResult).then(resolve, reject);
        return api;
      }
      if (table === 'personal_key_under_recovery') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: options.underRecovery ? { user_id: USER } : null,
            error: null,
          }),
        };
      }
      if (table === 'recovery_public_keys') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: options.recoveryPublic === false ? null : { user_id: USER },
            error: null,
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    return insert;
  }

  it('enrolls from cache when family wrap exists and personal wrap is missing', async () => {
    const insert = mockEnsureTables({ familyWrap: true, personalWrap: false });
    const result = await ensurePersonalKeyAfterFamilyReady({
      spaceId: SPACE,
      userId: USER,
    });
    expect(result).toEqual({ status: 'ready' });
    expect(insert).toHaveBeenCalled();
  });

  it('returns needsOtherPhone when a personal key exists elsewhere and cache is empty', async () => {
    (loadCachedPersonalKey as jest.Mock).mockResolvedValue(null);
    mockEnsureTables({
      familyWrap: true,
      personalWrap: false,
      wrapsAnywhere: 1,
      underRecovery: true,
    });
    const result = await ensurePersonalKeyAfterFamilyReady({
      spaceId: SPACE,
      userId: USER,
    });
    expect(result).toEqual({ status: 'needsOtherPhone' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns enrollError with a safe reason code when insert fails', async () => {
    mockEnsureTables({
      familyWrap: true,
      personalWrap: false,
      insertError: { code: '42501' },
    });
    const result = await ensurePersonalKeyAfterFamilyReady({
      spaceId: SPACE,
      userId: USER,
    });
    expect(result).toEqual({ status: 'enrollError', reasonCode: '42501' });
  });

  it('never shows enrollError when a personal key already exists on another device', async () => {
    (loadCachedPersonalKey as jest.Mock).mockResolvedValue(null);
    mockEnsureTables({
      familyWrap: true,
      personalWrap: false,
      wrapsAnywhere: 2,
      underRecovery: true,
    });
    const result = await ensurePersonalKeyAfterFamilyReady({
      spaceId: SPACE,
      userId: USER,
    });
    expect(result.status).toBe('needsOtherPhone');
    expect(result.status).not.toBe('enrollError');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns needsRecovery when no personal key exists and recovery is not set up', async () => {
    (loadCachedPersonalKey as jest.Mock).mockResolvedValue(null);
    mockEnsureTables({
      familyWrap: true,
      personalWrap: false,
      wrapsAnywhere: 0,
      underRecovery: false,
      recoveryPublic: false,
    });
    const result = await ensurePersonalKeyAfterFamilyReady({
      spaceId: SPACE,
      userId: USER,
    });
    expect(result).toEqual({
      status: 'needsRecovery',
      reasonCode: 'missing_recovery_public',
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_personal_key',
      expect.anything(),
    );
  });

  it('returns needsRecovery at 1 of 2 (recovery public present, setup incomplete)', async () => {
    (loadCachedPersonalKey as jest.Mock).mockResolvedValue(null);
    mockEnsureTables({
      familyWrap: true,
      personalWrap: false,
      wrapsAnywhere: 0,
      underRecovery: false,
      recoveryPublic: true,
      recoverySetup: false,
    });
    const result = await ensurePersonalKeyAfterFamilyReady({
      spaceId: SPACE,
      userId: USER,
    });
    expect(result).toEqual({
      status: 'needsRecovery',
      reasonCode: 'incomplete_recovery_setup',
    });
    expect(result.status).not.toBe('enrollError');
    expect(supabase.rpc).toHaveBeenCalledWith('has_recovery_setup', {
      _space_id: SPACE,
      _user_id: USER,
    });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'create_personal_key',
      expect.anything(),
    );
  });
});
