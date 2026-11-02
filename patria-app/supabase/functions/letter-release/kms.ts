// SECURITY REVIEW REQUIRED
// Hosted path: AWS KMS DeriveSharedSecret on an ECC_NIST_P256 KEY_AGREEMENT key.
// The private key never leaves KMS. Not exercised in Slice A (nothing is hosted yet);
// see docs/runbooks/letter-release-kms.md for the key setup and IAM policy.
import { ephemeralPublicKeyToSpki } from './release.ts';

/** Returns the raw 32 byte ECDH x-coordinate. */
export async function deriveSharedSecretWithKms(
  keyId: string,
  ephemeralPublicKey: Uint8Array,
): Promise<Uint8Array> {
  // Loaded only on the hosted path so local runs never need the AWS SDK.
  const { KMSClient, DeriveSharedSecretCommand } = await import('@aws-sdk/client-kms');
  const client = new KMSClient({});
  const output = await client.send(
    new DeriveSharedSecretCommand({
      KeyId: keyId,
      KeyAgreementAlgorithm: 'ECDH',
      PublicKey: ephemeralPublicKeyToSpki(ephemeralPublicKey),
    }),
  );
  if (!output.SharedSecret || output.SharedSecret.length !== 32) {
    throw new Error('KMS returned no shared secret');
  }
  return new Uint8Array(output.SharedSecret);
}
