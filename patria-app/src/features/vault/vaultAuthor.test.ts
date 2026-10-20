import { copy } from '../../lib/copy';
import { vaultAuthorLabel } from './vaultAuthor';

describe('vault author label', () => {
  it('names a current member and uses the former-member line otherwise', () => {
    expect(
      vaultAuthorLabel('u1', [{ userId: 'u1', displayName: 'Elena' }]),
    ).toBe('Elena');
    expect(vaultAuthorLabel('u2', [{ userId: 'u1', displayName: 'Elena' }])).toBe(
      copy.vault.formerMember,
    );
  });
});
