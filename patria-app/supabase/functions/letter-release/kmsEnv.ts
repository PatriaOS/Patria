// SECURITY REVIEW REQUIRED
//
// Pure helpers for letter-release AWS env. No Deno, no AWS SDK — Jest can import
// this the same way it imports release.ts. Hosted Edge wires Deno.env in kms.ts.
// Never read generic AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION.

export type LetterReleaseAwsCredentialInput = {
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  region: string | undefined;
};

export type LetterReleaseKmsClientConfig = {
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
};

/**
 * Build KMS client options from letter-release-only env values.
 * Throws if access key or secret is missing. Region defaults to us-east-1.
 */
export function letterReleaseKmsClientConfig(
  env: LetterReleaseAwsCredentialInput,
): LetterReleaseKmsClientConfig {
  const accessKeyId = env.accessKeyId?.trim() ?? '';
  const secretAccessKey = env.secretAccessKey?.trim() ?? '';
  const region = env.region?.trim() || 'us-east-1';
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('letter release AWS credentials missing');
  }
  return {
    region,
    credentials: { accessKeyId, secretAccessKey },
  };
}

/** Map a getEnv function to the prefixed letter-release AWS names only. */
export function letterReleaseAwsEnvFromGetEnv(
  getEnv: (name: string) => string | undefined,
): LetterReleaseAwsCredentialInput {
  return {
    accessKeyId: getEnv('LETTER_RELEASE_AWS_ACCESS_KEY_ID'),
    secretAccessKey: getEnv('LETTER_RELEASE_AWS_SECRET_ACCESS_KEY'),
    region: getEnv('LETTER_RELEASE_AWS_REGION'),
  };
}

/** KMS key UUID (36 chars with hyphens). Not the 66-char public key hex. */
const KMS_KEY_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** alias/<name> — letters, digits, /, _, - after the alias/ prefix. */
const KMS_KEY_ALIAS = /^alias\/[A-Za-z0-9/_-]+$/;

/**
 * Full key or alias ARN.
 * arn:aws:kms:region:account:key/<uuid>
 * arn:aws:kms:region:account:alias/<name>
 */
const KMS_KEY_ARN =
  /^arn:aws:kms:[a-z0-9-]+:\d{12}:(key\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|alias\/[A-Za-z0-9/_-]+)$/i;

/**
 * Trim and accept only a KMS key UUID, key/alias ARN, or alias/<name>.
 * Rejects 66-char public hex, KEY_ID= prefixes, quotes, and any other junk
 * before AWS is called. Returns null when invalid (caller → env_invalid).
 */
export function parseLetterReleaseKmsKeyId(raw: string | undefined): string | null {
  let value = raw?.trim() ?? '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (!value) {
    return null;
  }
  // Reject "KEY_ID=…" pasted from a shell dump.
  if (/^key[_ ]?id\s*=/i.test(value)) {
    return null;
  }
  // Reject any remaining whitespace (spaces inside the id).
  if (/\s/.test(value)) {
    return null;
  }
  if (KMS_KEY_UUID.test(value) || KMS_KEY_ALIAS.test(value) || KMS_KEY_ARN.test(value)) {
    return value;
  }
  return null;
}

/**
 * Resolve hosted LETTER_RELEASE_KMS_KEY_ID before any AWS call.
 * - empty → missing
 * - valid UUID / ARN / alias → keyId
 * - anything else (including 66-char public hex) → invalid
 */
export function resolveLetterReleaseKmsKeyId(
  raw: string | undefined,
): { status: 'missing' } | { status: 'invalid' } | { status: 'ok'; keyId: string } {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return { status: 'missing' };
  }
  const keyId = parseLetterReleaseKmsKeyId(raw);
  if (!keyId) {
    return { status: 'invalid' };
  }
  return { status: 'ok', keyId };
}
