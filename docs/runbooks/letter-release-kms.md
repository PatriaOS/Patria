# Letter release key (AWS KMS) — for Femi

Nothing in this runbook is applied to hosted Patria until Femi runs the steps.
Local and CI use a **fake** P-256 key pair. Hosted `letter-release` must refuse
that fake private key and must use **AWS KMS** with prefixed secrets only.

Account: **731776047389** (Patria-Team Management Account). Region: **us-east-1**.
Sign in as IAM user **Femi-Admin**. Do **all** AWS work in **CloudShell** in the
console (us-east-1). No AWS CLI and no AWS access keys on Femi’s Mac.

---

## How release works (context)

On the author’s phone: ephemeral P-256 key → ECDH with the KMS public key →
HKDF (`patria/letter-patria-share/v1` + letter id + version) → AEAD-seal Patria’s
CEK share. Store ephemeral public key + ciphertext.

At release (after `trigger_at`): Edge calls **`kms:DeriveSharedSecret`**, opens
`shareP` in memory, and returns **only** that share to the authenticated
recipient. Logs may include letter ids, never names or content.

Honest limits: before the trigger, Patria alone cannot open a letter; the
recipient alone cannot. Policy (not cryptography) blocks DeriveSharedSecret use
before `trigger_at`.

---

## 1. Create the KMS key and alias (CloudShell)

### 1a. IAM user for Edge (console, still as Femi-Admin)

1. IAM → Users → Create user → name **`patria-letter-release`**.
2. **Do not** enable console access. Create user (no permissions yet).
3. Later (after the key exists): attach the identity policy in §2 and create the
   access key named **`supabase-letter-release`** (rotate every 90 days).

### 1b. Key policy file in CloudShell

Open **CloudShell** (us-east-1). Write the policy:

```bash
cat > /tmp/patria-letter-release-key-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Id": "patria-letter-release-key-policy",
  "Statement": [
    {
      "Sid": "RootAccountFullKeyAdminViaIAM",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::731776047389:root"
      },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "KeyAdministratorsNoCryptographicUse",
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::731776047389:root",
          "arn:aws:iam::731776047389:user/Femi-Admin"
        ]
      },
      "Action": [
        "kms:Create*",
        "kms:Describe*",
        "kms:Enable*",
        "kms:List*",
        "kms:Put*",
        "kms:Update*",
        "kms:Revoke*",
        "kms:Disable*",
        "kms:Get*",
        "kms:Delete*",
        "kms:TagResource",
        "kms:UntagResource",
        "kms:ScheduleKeyDeletion",
        "kms:CancelKeyDeletion"
      ],
      "Resource": "*"
    },
    {
      "Sid": "LetterReleaseDeriveSharedSecretOnly",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::731776047389:user/patria-letter-release"
      },
      "Action": "kms:DeriveSharedSecret",
      "Resource": "*"
    },
    {
      "Sid": "DenyDeriveExceptLetterRelease",
      "Effect": "Deny",
      "Principal": {
        "AWS": "*"
      },
      "Action": "kms:DeriveSharedSecret",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:PrincipalArn": "arn:aws:iam::731776047389:user/patria-letter-release"
        }
      }
    }
  ]
}
EOF
```

**Why the Deny is safe for admins:** An explicit **Deny** wins over any **Allow**,
including statement 1’s `kms:*` for root. So **root** and **Femi-Admin** cannot
call `kms:DeriveSharedSecret` on this key. They keep admin actions (`GetPublicKey`,
`PutKeyPolicy`, describe, schedule deletion, etc.) via statements 1–2, so they can
still manage the key and edit the policy. Only
`arn:aws:iam::731776047389:user/patria-letter-release` is outside the Deny
condition and is Allowed DeriveSharedSecret. There is **no** `kms:Decrypt` (or
Encrypt / Sign) for anyone on this key.

### 1c. Create key + alias (CloudShell)

```bash
KEY_JSON=$(aws kms create-key \
  --region us-east-1 \
  --key-spec ECC_NIST_P256 \
  --key-usage KEY_AGREEMENT \
  --description "Patria letter-release ECDH" \
  --policy file:///tmp/patria-letter-release-key-policy.json)

echo "$KEY_JSON" | tee /tmp/patria-letter-release-create.json
KEY_ID=$(echo "$KEY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["KeyMetadata"]["KeyId"])')
KEY_ARN=$(echo "$KEY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["KeyMetadata"]["Arn"])')
echo "KEY_ID=$KEY_ID"
echo "KEY_ARN=$KEY_ARN"

aws kms create-alias \
  --region us-east-1 \
  --alias-name alias/patria-letter-release \
  --target-key-id "$KEY_ID"
```

Keep `KEY_ID` / `KEY_ARN` for the IAM identity policy. Prefer
`alias/patria-letter-release` as `LETTER_RELEASE_KMS_KEY_ID` in Supabase secrets.

---

## 2. IAM identity policy + access key

Still as Femi-Admin in the console (or CloudShell).

**Identity policy** on user `patria-letter-release` (only DeriveSharedSecret on
this key):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DeriveSharedSecretOnLetterReleaseKeyOnly",
      "Effect": "Allow",
      "Action": "kms:DeriveSharedSecret",
      "Resource": "arn:aws:kms:us-east-1:731776047389:key/<KEY_ID>"
    }
  ]
}
```

Replace `<KEY_ID>` with the id from §1c (or use the full key ARN as Resource).

**Access key**

1. IAM → Users → `patria-letter-release` → Security credentials → Create access key.
2. Use case: **Application running outside AWS**.
3. Description / name: **`supabase-letter-release`**.
4. Keep the secret only for the Supabase secrets step (§4). Never put it on Femi’s
   Mac AWS config, never commit it, never paste it into chat.
5. **Rotate every 90 days** (create new key → update secrets → delete old key).

---

## 3. Public key → app (CloudShell)

The public key is **not secret**. Convert KMS GetPublicKey (SPKI DER) to the
**66-character compressed SEC1 hex** Patria expects, confirm it is not the local
fake, then copy into `patria-app/.env` on the Mac.

In **CloudShell** (us-east-1):

```bash
aws kms get-public-key \
  --region us-east-1 \
  --key-id alias/patria-letter-release \
  --output text \
  --query PublicKey | base64 --decode > /tmp/patria-letter-release.spki.der

# Fake public hex from the app repo (.env.example). Public / not secret.
FAKE_HEX=03ca1057fffbed5969b9619fc60d57877b24f95dbeb0844593b417d3cdeeeedc56

python3 <<PY
from pathlib import Path
der = Path('/tmp/patria-letter-release.spki.der').read_bytes()
assert der[-65] == 0x04, 'expected uncompressed P-256 point at end of SPKI'
x, y = der[-64:-32], der[-32:]
compressed = bytes([0x02 if y[-1] % 2 == 0 else 0x03]) + x
assert len(compressed) == 33
hex_out = compressed.hex()
fake = "${FAKE_HEX}".lower()
assert len(hex_out) == 66 and hex_out[:2] in ('02', '03')
assert hex_out != fake, 'refusing known local fake public key'
print(hex_out)
print('not_fake', True)
PY
```

**App config**

1. Copy the printed 66-character hex.
2. On the Mac, in **`patria-app/.env`** (gitignored), set:

   `EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX=<paste hex>`

3. Restart Metro (`npx expo start` from `patria-app`). Expo Go against hosted
   should leave **Coming soon** and allow Write once the hex is real and non-fake.

**How the app confirms it is not the fake**

- `isFakeLetterReleasePublicKeyHex` compares case-insensitively to the fixed local
  fake in `letter-release/release.ts` / `.env.example`.
- On a hosted Supabase URL, missing or fake → `letterReleaseReadyForSealing` is
  false (Coming soon / no Write). A valid non-fake 33-byte compressed hex → seal
  allowed.
- Hosted Edge refuses the known fake **private** key by fingerprint and requires
  `LETTER_RELEASE_KMS_KEY_ID` (never uses `LETTER_RELEASE_PRIVATE_KEY_HEX` on
  hosted).

---

## 4. Supabase secrets + deploy `letter-release`

Secrets are **prefixed** so Brain can later use generic `AWS_*` without collision.
`letter-release` reads **only** these names (see `kms.ts`).

From **`patria-app`** on the Mac (values entered with `read -rs` so they do not
land in shell history). Linked project: `olcfghdmsgdnfvglxddh`.

```bash
cd patria-app

read -rs "LETTER_RELEASE_AWS_ACCESS_KEY_ID?Access key ID: "; echo
read -rs "LETTER_RELEASE_AWS_SECRET_ACCESS_KEY?Secret access key: "; echo
read -rs "LETTER_RELEASE_KMS_KEY_ID?KMS key id or alias: "; echo
# Suggested: alias/patria-letter-release

npx supabase secrets set \
  "LETTER_RELEASE_AWS_ACCESS_KEY_ID=${LETTER_RELEASE_AWS_ACCESS_KEY_ID}" \
  "LETTER_RELEASE_AWS_SECRET_ACCESS_KEY=${LETTER_RELEASE_AWS_SECRET_ACCESS_KEY}" \
  LETTER_RELEASE_AWS_REGION=us-east-1 \
  "LETTER_RELEASE_KMS_KEY_ID=${LETTER_RELEASE_KMS_KEY_ID}"

unset LETTER_RELEASE_AWS_ACCESS_KEY_ID LETTER_RELEASE_AWS_SECRET_ACCESS_KEY LETTER_RELEASE_KMS_KEY_ID

npx supabase functions deploy letter-release
```

Do **not** set `LETTER_RELEASE_PRIVATE_KEY_HEX` on hosted. Do **not** set generic
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for letter-release.

---

## 5. pg_cron `mark_due_letters` on hosted

Migration schedules (when `pg_cron` is available):

- Job name: **`patria-mark-due-letters`**
- Schedule: **`*/15 * * * *`**
- Command: `SELECT public.mark_due_letters();`

Confirm in the Supabase SQL editor:

```sql
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'patria-mark-due-letters';
```

Expect one row, schedule `*/15 * * * *`, `active = true`.

Recent runs (if available):

```sql
SELECT jobid, runid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'patria-mark-due-letters')
ORDER BY start_time DESC
LIMIT 20;
```

If missing:

```sql
SELECT cron.schedule(
  'patria-mark-due-letters',
  '*/15 * * * *',
  $cron$SELECT public.mark_due_letters();$cron$
);
```

---

## 6. Test plan (real path only)

No SQL edits of `trigger_at`. No hosted test-only shortcuts.

1. After §3–§5: Expo Go (or Simulator) against hosted with the real public hex in
   `.env`; Letters is not Coming soon.
2. As **Test 1**, seal an announced letter to **Test 2**, date = **tomorrow**
   (UI minimum; trigger is midnight in the family timezone — for the hosted test
   family that is **America/Chicago** / Central Time).
3. After **midnight Central Time** that day, wait up to ~15 minutes for
   `patria-mark-due-letters` to flip the letter to `pending`.
4. As **Test 2** in the **Simulator** against hosted: open the letter. Pass if
   content opens (and fingerprint matches seal). That path hits hosted
   `letter-release` → KMS DeriveSharedSecret.

Fail signals: still Coming soon → public hex / Metro; open fails with
`kms_not_configured` or `hosted_refuse_fake_key` → secrets; still `sealed` after
midnight + 15 minutes → cron.

---

## Local / CI only

`LETTER_RELEASE_PRIVATE_KEY_HEX` (32-byte fake scalar) in
`supabase/functions/.env` for local serve. Hosted must error if that fake private
key is present (fingerprint check).
