import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { FAKE_LETTER_RELEASE_PUBLIC_KEY_HEX } from '../../features/letters/letterReleaseConfig';
import {
  letterReleaseAwsEnvFromGetEnv,
  letterReleaseKmsClientConfig,
  parseLetterReleaseKmsKeyId,
  resolveLetterReleaseKmsKeyId,
} from '../../../supabase/functions/letter-release/kmsEnv';
import {
  classifyLetterReleaseClaimError,
  classifyLetterReleaseOpenError,
  clientLetterReleaseClaimError,
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

const SAMPLE_KMS_KEY_UUID = '12345678-1234-1234-1234-1234567890ab';
const SAMPLE_KMS_KEY_ARN =
  'arn:aws:kms:us-east-1:731776047389:key/12345678-1234-1234-1234-1234567890ab';
const SAMPLE_PUBLIC_HEX =
  '03ca1057fffbed5969b9619fc60d57877b24f95dbeb0844593b417d3cdeeeedc56';

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
        kmsKeyId: SAMPLE_KMS_KEY_ARN,
      }),
    ).toEqual({ kind: 'kms', keyId: SAMPLE_KMS_KEY_ARN });
    expect(
      decideReleaseKey({
        supabaseUrl: 'https://abc.supabase.co',
        deploymentId: undefined,
        privateKeyHex: undefined,
      }),
    ).toEqual({ kind: 'kms_not_configured' });
    expect(
      decideReleaseKey({
        supabaseUrl: 'https://abc.supabase.co',
        deploymentId: undefined,
        privateKeyHex: undefined,
        kmsKeyInvalid: true,
      }),
    ).toEqual({ kind: 'env_invalid' });
  });

  it('accepts only KMS key UUID, ARN, or alias/<name> for LETTER_RELEASE_KMS_KEY_ID', () => {
    expect(parseLetterReleaseKmsKeyId(`  ${SAMPLE_KMS_KEY_UUID}  `)).toBe(SAMPLE_KMS_KEY_UUID);
    expect(parseLetterReleaseKmsKeyId(SAMPLE_KMS_KEY_ARN)).toBe(SAMPLE_KMS_KEY_ARN);
    expect(parseLetterReleaseKmsKeyId('alias/patria-letter-release')).toBe(
      'alias/patria-letter-release',
    );
    expect(
      parseLetterReleaseKmsKeyId(
        'arn:aws:kms:us-east-1:731776047389:alias/patria-letter-release',
      ),
    ).toBe('arn:aws:kms:us-east-1:731776047389:alias/patria-letter-release');
    expect(parseLetterReleaseKmsKeyId(`"${SAMPLE_KMS_KEY_UUID}"`)).toBe(SAMPLE_KMS_KEY_UUID);
    expect(parseLetterReleaseKmsKeyId(SAMPLE_PUBLIC_HEX)).toBeNull();
    expect(parseLetterReleaseKmsKeyId(`KEY_ID=${SAMPLE_KMS_KEY_UUID}`)).toBeNull();
    expect(parseLetterReleaseKmsKeyId(` ${SAMPLE_KMS_KEY_UUID} `)).toBe(SAMPLE_KMS_KEY_UUID);
    expect(parseLetterReleaseKmsKeyId(`${SAMPLE_KMS_KEY_UUID} trailing`)).toBeNull();
    expect(parseLetterReleaseKmsKeyId('')).toBeNull();
    expect(parseLetterReleaseKmsKeyId(undefined)).toBeNull();

    expect(resolveLetterReleaseKmsKeyId(SAMPLE_PUBLIC_HEX)).toEqual({ status: 'invalid' });
    expect(resolveLetterReleaseKmsKeyId(undefined)).toEqual({ status: 'missing' });
    expect(resolveLetterReleaseKmsKeyId(SAMPLE_KMS_KEY_UUID)).toEqual({
      status: 'ok',
      keyId: SAMPLE_KMS_KEY_UUID,
    });
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

  it('maps open/KMS failures to safe reason codes (never raw AWS bodies)', () => {
    expect(classifyLetterReleaseOpenError(new Error('letter release AWS credentials missing'))).toBe(
      'env_missing',
    );
    const denied = new Error('User is not authorized to perform: kms:DeriveSharedSecret');
    denied.name = 'AccessDeniedException';
    expect(classifyLetterReleaseOpenError(denied)).toBe('kms_denied');
    const missing = new Error('Invalid keyId abc');
    missing.name = 'NotFoundException';
    expect(classifyLetterReleaseOpenError(missing)).toBe('kms_not_found');
    expect(classifyLetterReleaseOpenError(new Error('unwrap failed'))).toBe('unwrap_failed');
    expect(classifyLetterReleaseOpenError(new Error('invalid public key'))).toBe('bad_share');
    expect(classifyLetterReleaseOpenError(new Error('KMS returned no shared secret'))).toBe(
      'kms_error',
    );
    expect(classifyLetterReleaseOpenError(new Error('something else'))).toBe('open_failed');
    expect(classifyLetterReleaseOpenError('not-an-error')).toBe('open_failed');
  });

  it('maps claim_letter_patria_share failures to safe reason codes', () => {
    expect(classifyLetterReleaseClaimError('P0002', 'Not found')).toBe('not_found');
    expect(classifyLetterReleaseClaimError('42501', 'not_recipient')).toBe('not_recipient');
    expect(classifyLetterReleaseClaimError('42501', 'not_due')).toBe('not_due');
    expect(classifyLetterReleaseClaimError('42501', 'recipient_left')).toBe('recipient_left');
    expect(classifyLetterReleaseClaimError('42501', 'bad_status')).toBe('bad_status');
    expect(classifyLetterReleaseClaimError('42501', 'Not allowed')).toBe('claim_refused');
    expect(classifyLetterReleaseClaimError(undefined, 'Not found')).toBe('not_found');
  });

  it('returns not_allowed to the client for existence/ownership probes; keeps not_due', () => {
    expect(clientLetterReleaseClaimError('not_found')).toBe('not_allowed');
    expect(clientLetterReleaseClaimError('not_recipient')).toBe('not_allowed');
    expect(clientLetterReleaseClaimError('recipient_left')).toBe('not_allowed');
    expect(clientLetterReleaseClaimError('bad_status')).toBe('not_allowed');
    expect(clientLetterReleaseClaimError('claim_refused')).toBe('not_allowed');
    expect(clientLetterReleaseClaimError('not_due')).toBe('not_due');
  });
});
