# Letter release key (AWS KMS) — for Femi

Nothing in this runbook is applied to hosted Patria yet. Local and CI use a **fake** P-256 key pair. Hosted `letter-release` must refuse that fake private key.

## What to create

1. In AWS KMS (account that will run Edge `letter-release`), create an **asymmetric** key:
   - Key type: **Asymmetric**
   - Key usage: **KEY_AGREEMENT** (not Encrypt/Decrypt)
   - Key spec: **ECC_NIST_P256**
2. Key policy: allow **`kms:DeriveSharedSecret`** (and describe/get-public-key as needed) **only** for the IAM role used by the hosted `letter-release` Edge Function. Do **not** allow Encrypt, Decrypt, or Sign for this key. Do not grant DeriveSharedSecret to humans or other services.
3. Export the **public** key. Convert to the compressed SEC1 form Patria expects (33 bytes, hex). Put that hex in the app as `EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX` (safe to expose).
4. Hosted Edge secrets: AWS credentials / role for that KMS key only. **Never** put a KMS private key or the local fake private key in hosted env.
5. Local / CI only: `LETTER_RELEASE_PRIVATE_KEY_HEX` (32-byte fake scalar, hex) matching the public hex above. Hosted must error if this secret is present.

## How release works

On the author’s phone: ephemeral P-256 key → ECDH with the KMS public key → HKDF (`patria/letter-patria-share/v1` + letter id + version) → AEAD-seal Patria’s CEK share. Store ephemeral public key + ciphertext.

At release (after `trigger_at`): Edge calls **`kms:DeriveSharedSecret`** with the stored ephemeral public key, derives the same wrap key in memory, opens the share, and returns **only** that share to the authenticated recipient. Logs may include letter ids, never names or content.

## Honest limits

- Before the trigger, Patria alone cannot open a letter (no recipient share).
- The recipient alone cannot open it (no Patria share).
- Policy (not cryptography) blocks DeriveSharedSecret use before `trigger_at`. If that policy and the recipient’s unlocked phone were both compromised, those two together could open early.
