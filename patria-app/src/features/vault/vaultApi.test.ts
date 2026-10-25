import { supabase } from '../../lib/supabase';
import { uploadVaultAudio } from './vaultApi';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(),
    },
  },
}));

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ENTRY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const AUDIO = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('vault audio upload', () => {
  it('inserts once without upsert and treats a leftover object as already uploaded', async () => {
    const upload = jest.fn(async (): Promise<{
      error: { message: string; statusCode: string } | null;
    }> => ({ error: null }));
    (supabase.storage.from as jest.Mock).mockReturnValue({ upload });
    await uploadVaultAudio({
      spaceId: SPACE,
      entryId: ENTRY,
      audioId: AUDIO,
      ciphertext: new Uint8Array([1, 2, 3]),
    });
    expect(supabase.storage.from).toHaveBeenCalledWith('vault');
    expect(upload).toHaveBeenCalledWith(
      `${SPACE}/${ENTRY}/${AUDIO}`,
      expect.any(ArrayBuffer),
      { contentType: 'application/octet-stream', upsert: false },
    );

    upload.mockResolvedValueOnce({
      error: { message: 'The resource already exists', statusCode: '409' },
    });
    await expect(
      uploadVaultAudio({
        spaceId: SPACE,
        entryId: ENTRY,
        audioId: AUDIO,
        ciphertext: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toBeUndefined();

    upload.mockResolvedValueOnce({
      error: { message: 'new row violates row-level security policy', statusCode: '403' },
    });
    await expect(
      uploadVaultAudio({
        spaceId: SPACE,
        entryId: ENTRY,
        audioId: AUDIO,
        ciphertext: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toMatchObject({ statusCode: '403' });
  });
});
