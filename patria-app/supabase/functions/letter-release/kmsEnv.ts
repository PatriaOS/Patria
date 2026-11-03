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
