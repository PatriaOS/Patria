import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX } from '../../features/letters/letterReleaseConfig';
import {
  letterReleaseAwsEnvFromGetEnv,
  letterReleaseKmsClientConfig,
} from '../../../supabase/functions/letter-release/kmsEnv';
import {
  decideReleaseKey,
  decodePgBytea,
  FAKE_LETTER_RELEASE_PUBLIC_KEY_FINGERPRINT,
  isFakeReleasePrivateKey,
  isHosted,
  openSharePLocal,
  releasePublicKeyFingerprint,
} from '../../../supabase/functions/letter-release/release';
import { secretsEqual } from './bytes';
import {
  generateP256KeyPair,
  p256PublicKeyFromSecret,
  sealSharePToReleasePublicKey,
} from './letterReleaseKey';
import { randomKey32 } from './random';

// The fake pair from .env.example. Public only here; the private half is a local test fixture.
const FAKE_PRIVATE_HEX = '78c5bcc55c54ed015e7452df3b55a395401c17c2088049bcd1a9c678dca33a85';
const LETTER_ID = '11111111-1111-1111-1111-111111111111';

describe('letter-release Edge helpers', () => {
  it('opens exactly what the app seals to the release public key', () => {
    const shareP = randomKey32();
    const sealed = sealSharePToReleasePublicKey(
      shareP,
      hexToBytes(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX),
      { letterId: LETTER_ID, version: 2 },
    );
    const opened = openSharePLocal({
      privateKey: hexToBytes(FAKE_PRIVATE_HEX),
      ephemeralPublic: sealed.ephemeralPublicKey,
      sealedShare: sealed.sealedShare,
      letterId: LETTER_ID,
      version: 2,
    });
    expect(secretsEqual(opened, shareP)).toBe(true);
  });

  it('refuses a different letter id or version', () => {
    const sealed = sealSharePToReleasePublicKey(
      randomKey32(),
      hexToBytes(FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX),
      { letterId: LETTER_ID, version: 1 },
    );
    const base = {
      privateKey: hexToBytes(FAKE_PRIVATE_HEX),
      ephemeralPublic: sealed.ephemeralPublicKey,
      sealedShare: sealed.sealedShare,
    };
    expect(() => openSharePLocal({ ...base, letterId: LETTER_ID, version: 2 })).toThrow(
      'unwrap failed',
    );
    expect(() =>
      openSharePLocal({ ...base, letterId: '22222222-2222-2222-2222-222222222222', version: 1 }),
    ).toThrow('unwrap failed');
  });

  it('decodes PostgREST bytea', () => {
    expect(Array.from(decodePgBytea('\\x00ff10'))).toEqual([0, 255, 16]);
    expect(() => decodePgBytea('\\xzz')).toThrow('invalid bytea');
    expect(() => decodePgBytea(12)).toThrow('invalid bytea');
  });

  it('treats only a known local stack as not hosted', () => {
    expect(isHosted({ supabaseUrl: 'http://127.0.0.1:54321', deploymentId: undefined })).toBe(false);
    expect(isHosted({ supabaseUrl: 'http://kong:8000', deploymentId: undefined })).toBe(false);
    expect(
      isHosted({ supabaseUrl: 'http://supabase_kong_patria:8000', deploymentId: undefined }),
    ).toBe(false);
    expect(isHosted({ supabaseUrl: 'https://abc.supabase.co', deploymentId: undefined })).toBe(true);
    expect(isHosted({ supabaseUrl: undefined, deploymentId: undefined })).toBe(true);
    expect(isHosted({ supabaseUrl: 'not a url', deploymentId: undefined })).toBe(true);
    expect(isHosted({ supabaseUrl: 'http://127.0.0.1:54321', deploymentId: 'dep_1' })).toBe(true);
  });

  it('refuses the fake private key on a hosted project by public-key fingerprint', () => {
    expect(isFakeReleasePrivateKey(FAKE_PRIVATE_HEX)).toBe(true);
    expect(
      releasePublicKeyFingerprint(p256PublicKeyFromSecret(hexToBytes(FAKE_PRIVATE_HEX))),
    ).toBe(FAKE_LETTER_RELEASE_PUBLIC_KEY_FINGERPRINT);
    expect(
      decideReleaseKey({
        supabaseUrl: 'https://abc.supabase.co',
        deploymentId: undefined,
        privateKeyHex: FAKE_PRIVATE_HEX,
      }),
    ).toEqual({ kind: 'refuse_fake_key_on_hosted' });
    const other = generateP256KeyPair();
    expect(isFakeReleasePrivateKey(bytesToHex(other.secretKey))).toBe(false);
    // A non-fake env private must not be used on hosted; KMS is the only path.
    expect(
      decideReleaseKey({
        supabaseUrl: 'https://abc.supabase.co',
        deploymentId: undefined,
        privateKeyHex: bytesToHex(other.secretKey),
        kmsKeyId: 'arn:aws:kms:test',
      }),
    ).toEqual({ kind: 'kms', keyId: 'arn:aws:kms:test' });
    expect(
      decideReleaseKey({
        supabaseUrl: 'https://abc.supabase.co',
        deploymentId: undefined,
        privateKeyHex: undefined,
      }),
    ).toEqual({ kind: 'kms_not_configured' });
  });

  it('uses the local key only on a local stack', () => {
    const local = decideReleaseKey({
      supabaseUrl: 'http://127.0.0.1:54321',
      deploymentId: undefined,
      privateKeyHex: FAKE_PRIVATE_HEX,
    });
    expect(local.kind).toBe('local');
    expect(
      decideReleaseKey({
        supabaseUrl: 'http://127.0.0.1:54321',
        deploymentId: undefined,
        privateKeyHex: undefined,
      }),
    ).toEqual({ kind: 'local_key_missing' });
    expect(
      decideReleaseKey({
        supabaseUrl: 'http://127.0.0.1:54321',
        deploymentId: undefined,
        privateKeyHex: 'abcd',
      }),
    ).toEqual({ kind: 'local_key_missing' });
  });

  it('builds KMS client config from LETTER_RELEASE_AWS_* only', () => {
    const config = letterReleaseKmsClientConfig({
      accessKeyId: ' AKIAEXAMPLE ',
      secretAccessKey: ' secret ',
      region: ' us-east-1 ',
    });
    expect(config).toEqual({
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' },
    });
    expect(letterReleaseKmsClientConfig({
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
      region: undefined,
    }).region).toBe('us-east-1');
    expect(() =>
      letterReleaseKmsClientConfig({
        accessKeyId: undefined,
        secretAccessKey: 'secret',
        region: 'us-east-1',
      }),
    ).toThrow('letter release AWS credentials missing');
    expect(() =>
      letterReleaseKmsClientConfig({
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: '  ',
        region: 'us-east-1',
      }),
    ).toThrow('letter release AWS credentials missing');

    const names: string[] = [];
    const env = letterReleaseAwsEnvFromGetEnv((name) => {
      names.push(name);
      if (name === 'LETTER_RELEASE_AWS_ACCESS_KEY_ID') {
        return 'AKIA_LETTER';
      }
      if (name === 'LETTER_RELEASE_AWS_SECRET_ACCESS_KEY') {
        return 'letter-secret';
      }
      if (name === 'LETTER_RELEASE_AWS_REGION') {
        return 'us-east-1';
      }
      return 'should-not-read';
    });
    expect(names).toEqual([
      'LETTER_RELEASE_AWS_ACCESS_KEY_ID',
      'LETTER_RELEASE_AWS_SECRET_ACCESS_KEY',
      'LETTER_RELEASE_AWS_REGION',
    ]);
    expect(names.some((n) => n === 'AWS_ACCESS_KEY_ID' || n === 'AWS_SECRET_ACCESS_KEY')).toBe(
      false,
    );
    expect(letterReleaseKmsClientConfig(env)).toEqual({
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIA_LETTER', secretAccessKey: 'letter-secret' },
    });
  });
});
