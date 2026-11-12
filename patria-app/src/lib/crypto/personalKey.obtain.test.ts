// SECURITY REVIEW REQUIRED
import { supabase } from '../supabase';
import { ensureDeviceIdentity } from './deviceIdentity';
import { loadCachedPersonalKey, personalKeyNeedsOtherPhone } from './keyStore';
import { obtainPersonalKey } from './personalKey';

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

function chain(terminal: Record<string, unknown>) {
  const api: Record<string, unknown> = {};
  api.select = jest.fn(() => api);
  api.eq = jest.fn(() => api);
  api.maybeSingle = jest.fn(async () => terminal);
  // head-count queries await the builder itself
  Object.assign(api, terminal);
  api.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(terminal).then(resolve, reject);
  return api;
}

describe('obtainPersonalKey never mints a second key', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ensureDeviceIdentity as jest.Mock).mockResolvedValue({
      deviceId: DEVICE,
      publicKey: new Uint8Array(32).fill(1),
      privateKey: new Uint8Array(32).fill(2),
    });
    (loadCachedPersonalKey as jest.Mock).mockResolvedValue(null);
  });

  it('throws needs-other-phone when wraps already exist for another device', async () => {
    let wrapsCalls = 0;
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'personal_key_under_recovery') {
        return chain({ data: null, error: null });
      }
      if (table === 'personal_key_wraps') {
        wrapsCalls += 1;
        if (wrapsCalls === 1) {
          // personalKeyExistsAnywhere count
          return chain({ count: 1, error: null });
        }
        if (wrapsCalls === 2) {
          // fetchOwnPersonalWrap — none for this device
          return chain({ data: null, error: null });
        }
        // error suffix count
        return chain({ count: 1, error: null });
      }
      throw new Error(`unexpected table ${table}`);
    });

    await expect(obtainPersonalKey({ spaceId: SPACE, userId: USER })).rejects.toThrow(
      personalKeyNeedsOtherPhone,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('throws needs-other-phone before create when a recovery seal already exists', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'personal_key_under_recovery') {
        return chain({ data: { user_id: USER }, error: null });
      }
      if (table === 'personal_key_wraps') {
        return chain({ data: null, error: null, count: 0 });
      }
      throw new Error(`unexpected table ${table}`);
    });

    await expect(obtainPersonalKey({ spaceId: SPACE, userId: USER })).rejects.toThrow(
      personalKeyNeedsOtherPhone,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
