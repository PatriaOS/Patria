import { discardLocalFamilySecrets } from './crypto/keyStore';
import { leaveFamilySpace } from './leaveFamily';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('./crypto/keyStore', () => ({
  discardLocalFamilySecrets: jest.fn(async () => undefined),
}));

describe('leaveFamilySpace', () => {
  it('deletes the membership then discards cached family keys for that space', async () => {
    const eqUser = jest.fn(async () => ({ error: null }));
    const eqSpace = jest.fn(() => ({ eq: eqUser }));
    const del = jest.fn(() => ({ eq: eqSpace }));
    (supabase.from as jest.Mock).mockReturnValue({ delete: del });

    const result = await leaveFamilySpace({ spaceId: 's1', userId: 'u2' });

    expect(result).toEqual({ ok: true });
    expect(supabase.from).toHaveBeenCalledWith('space_members');
    expect(discardLocalFamilySecrets).toHaveBeenCalledWith('u2', 's1');
  });

  it('goes through leave_family_with_letters when letters were decided', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

    const result = await leaveFamilySpace({
      spaceId: 's1',
      userId: 'u2',
      withdrawLetterIds: ['l1'],
    });

    expect(result).toEqual({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledWith('leave_family_with_letters', {
      p_space_id: 's1',
      p_withdraw_letter_ids: ['l1'],
    });
    expect(discardLocalFamilySecrets).toHaveBeenCalledWith('u2', 's1');
  });

  it('does not discard local keys when the letters leave fails', async () => {
    (discardLocalFamilySecrets as jest.Mock).mockClear();
    (supabase.rpc as jest.Mock).mockResolvedValue({ error: { code: '42501', message: 'no' } });

    const result = await leaveFamilySpace({ spaceId: 's1', userId: 'u2', withdrawLetterIds: [] });

    expect(result).toEqual({ ok: false });
    expect(discardLocalFamilySecrets).not.toHaveBeenCalled();
  });
});
