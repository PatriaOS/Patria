// SECURITY REVIEW REQUIRED
import { supabase } from '../supabase';
import { ensureDeviceIdentity } from './deviceIdentity';
import { loadCachedPersonalKey } from './keyStore';
import {
  enrollPersonalWrapFromCacheIfApproved,
  loadPersonalKeyIfPresent,
} from './personalKey';
import { randomKey32 } from './random';

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
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
});
