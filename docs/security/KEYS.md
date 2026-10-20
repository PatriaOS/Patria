# Family encryption keys and recovery contacts

**CIR05 step 2.** Protocol approved (with per-member recovery key pairs, D27, and backup-excluded SecureStore). Implementation waits on `docs/security/KEYS_IMPLEMENTATION.md` Step 1.

This slice creates and stores keys so the Legacy Vault can encrypt on the device. **LEG01 slice 1 (D33) encrypts text decisions** with a per-entry CEK wrapped to the family key. Voice, letters and documents follow. Successors getting keys at handover is **GROW04**, not now.

Every future file that generates, wraps, stores or uses keys must start with:

```
// SECURITY REVIEW REQUIRED
```

That is a project rule. Do not skip it.

---

## How to read this

1. **Plain language** — what a parent should be able to understand.
2. **Technical detail** — the protocol we will implement.
3. **Decisions** — choices already made (end of this file).

---

# 1. Threat model

## Plain language

Patria should keep a family’s vault (letters, decisions, documents, health, teen private space, codes) private even if someone else can see our servers.

| We protect against | What that means |
|---|---|
| **Other families** | The Riveras cannot read the Okonks’ vault. Already true for ordinary family data via Row Level Security. Keys must not punch a hole in that. |
| **Patria staff and servers** | A well-meaning engineer, a support person, or a compromised admin account must not be able to decrypt vault content or copy a family key. The server never sees a plaintext family key. |
| **A stolen database** | If someone copies Postgres or Storage, they get ciphertext and wrapped keys, not keys they can use. |
| **A lost or stolen phone** | The thief should not get the family key from the app’s ordinary files. The key lives in the phone’s secure store. If the owner reports the phone gone, we rotate so that phone’s copy no longer unlocks **new** wraps. |
| **A malicious server inventing a fake phone** | The server could insert a public key and claim it is “Marco’s new device.” We never wrap the family key to a device until a human approves it (see §4b and §4c). |

| Out of scope for CIR05 (and for this design) | Why |
|---|---|
| Someone looking over your shoulder, or you unlocking the phone for them | We cannot fix physical coercion in this slice. |
| A rooted/jailbroken phone with malware already inside the OS | Secure store can be bypassed on a fully compromised device. |
| Patria being forced by a government to add a backdoor | We will not build a backdoor. Legal process is a company policy question, not a key-design feature. |
| Sealed letters, document encryption | LEG02+ and CARE07, after this key design. Decision Ledger text is LEG01 slice 1 (D33). |
| Generational Custody Handover (lawyer / third share, death certificates) | GROW04, Phase 3. CIR05 recovery is for a **living** family that lost a phone, not inheritance. |
| Merging two family spaces | D1. Each space has its own family key. |
| Teen private space keys | GROW02. |
| SMS / phone-only members holding keys | CIR03. No app, no key. |
| Perfect erasure of content a removed member already read or screenshotted | Honest limit. Rotation stops **future** access, not memory. |

We do **not** encrypt the slice 1 family home (space name, member list, invites) with the family key. That data is already private between families via RLS. The family key is for the **vault tier** listed in the project rules.

**Note for the Legacy Vault design:** With a single family key, **circles are not protected by encryption**. Anyone who holds the family key can decrypt any vault blob if they can fetch it. RLS still hides rows from the wrong people on the honest server, but a stolen database dump, a bug in Storage policies, or a future leak of ciphertext would let every key-holder read every circle’s vault items. **Vault items should use per-item or per-circle keys** (wrapped to the family key or to the members of that circle), so Household vs Extended Family vs Only Me is enforced by cryptography, not only by RLS. That work belongs with LEG01+, not CIR05.

---

## Technical detail

**Assets**

* Family data encryption key (symmetric), one per family space (D5: many spaces ⇒ many family keys). Rotates when a member is removed.
* **Recovery key** (symmetric, 256-bit), one per family space, **long-lived**. Rotates only when a recovery contact is removed or the printed code is reported lost.
* Per-device X25519 key pair for each signed-in member.
* Recovery boxes (pairwise) protect **that member’s recovery private key**, not the family key.
* Per epoch and member: family key wrapped to that member’s recovery public key (on the server as ciphertext only).
* Later: ciphertext of vault objects (not this slice), preferably with per-item or per-circle keys.

**Adversaries we design for**

1. Authenticated user in family B querying family A’s rows (RLS + no useful key material).
2. Holder of the Supabase service role or a database backup.
3. Network observer (TLS already; keys still never sent in the clear).
4. Thief with the unlocked-file dump of an app sandbox, **without** SecureStore / hardware-backed keystore.
5. Malicious or compromised server inserting a `device_keys` row with an attacker-controlled public key.

**Adversaries we do not fully stop**

* Thief with an unlocked phone and the owner’s PIN, until the owner signs out or we rotate.
* Member who was legitimate, downloaded vault items, then was removed (they may still have old plaintext on disk). Rotation + delete local cache is best effort.
* Admin who taps “Let this device in” without checking (social engineering). Safety codes (§4b) are an option for review.

**Trust boundaries**

* **Phone (trusted for key use):** generate keys, wrap/unwrap, SecureStore, human approval UI.
* **Supabase (untrusted for secrets):** store public keys, opaque wrapped blobs, algorithm version, timestamps, recovery *requests*. Postgres must never have a column that is documented as “family key plaintext.” The server must not be trusted to decide which devices are real.

---

# 2. Key structure

## Plain language

Think of four things:

1. **The family key** — one secret for “The Rivera Family” space. It will later lock and unlock vault items. It is created on a phone, never typed into our website, never stored as-is on our servers. When someone leaves the family, this key changes.
2. **That member’s recovery key pair** — contacts and the printed code unlock **this member’s** recovery private key, not the family key. If Marco is removed and the family key changes, Elena does **not** need a new printed code. She only redos recovery setup if one of **her** contacts left or she reported the paper lost. Until she redos, remaining contact plus paper still work; the removed contact cannot approve.
3. **Each person’s device keys** — every phone that signs in makes its own lock (public) and key (private). The private half never leaves that phone’s secure store, and it is **never copied into iCloud or Google backup**.
4. **A wrapped copy of the family key for each approved device** — like putting the family key in a box that only that phone’s lock can open. We store the boxes. We never store the family key sitting on the table.

When Elena invites Marco, Marco’s phone uploads its lock. **Elena (an admin) must tap “Let Marco in”** after seeing his name and when that phone was created. Only then does her phone make a box for that lock. No app auto-wraps in the background.

The server can see: “Marco has a box, version 1, created Tuesday.” It cannot open the box.

## Technical detail

### Family key

* 256-bit secret, from a CSPRNG (`expo-crypto` / `crypto.getRandomValues`).
* One per `family_spaces.id`.
* Used later as the root for vault encryption. **Not used in CIR05** except generate, wrap, unwrap, store, rotate.
* Rotates (`key_epoch++`) when a **member who had a wrap is removed**.
* Algorithm id stored with wraps, e.g. `fk-v1`, so we can migrate.

### Recovery key pair (D27)

* Each key-holding member has an **X25519** recovery key pair. Not a family-wide secret.
* **Public half** is stored on the server (`recovery_public_keys`).
* **Private half** exists only inside that member’s 2-of-3 pair boxes (A with B, A with paper, B with paper). No device keeps it after setup or recovery; wipe it from memory after use. There is no `recovery_key_wraps` table and no path that wraps a recovery private key to a phone.
* Pair boxes use the existing wrap / pairwise AEAD module (X25519, HKDF-SHA256, XChaCha20-Poly1305 with AAD). No new primitive.
* For each `key_epoch` and member who has recovery set up, the server stores **`family_key` sealed to that member’s recovery public key** (`family_key_under_recovery`): same wrap module, AAD = `family_space_id || key_epoch || user_id`.
* After member-removal rotation: new family key is wrapped to remaining let-in devices **and** sealed to each remaining member’s recovery public key. The rotating admin cannot open those private keys.
* Members without recovery set up get no sealed box. When they set recovery up, their phone seals the current epoch to the new public key.
* If a recovery contact is removed: that member’s existing pair boxes stay usable with the remaining contact plus printed code until they redo setup. The removed person is dropped as a contact so they cannot approve. On redo, delete the old recovery public key and all its sealed boxes, then mint a new pair.

**Primitives (must exist in both noble and libsodium, so stored blobs stay compatible if we switch libraries):**

* **X25519** for device key agreement
* **XChaCha20-Poly1305** for wrapping (AEAD)
* **HKDF-SHA256** for deriving wrap keys and pairwise recovery keys

Associated data for every member wrap (decision Q9):

`family_space_id || key_epoch || user_id || device_id`

### Device key pair

* **X25519:** `device_private` + `device_public`.
* **One pair per signed-in user per device**, not per family. Elena in two families (D5) has one device pair and two wrapped family keys (once each space has approved that device).
* `device_private` only in **expo-secure-store**, never AsyncStorage, never logged, never in Postgres. Same for any cached unwrapped family key. Recovery private keys are not cached on devices (D27).
* **Not in cloud backups.** Every `setItemAsync` for keys uses iOS `keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY` (item is not included in encrypted iCloud/device-to-device keychain backups). On Android, values already use Keystore-backed encryption; we **exclude** the `SecureStore` SharedPreferences from Auto Backup and device transfer (`configureAndroidBackup` / `<exclude domain="sharedpref" path="SecureStore"/>` per [Expo SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/)). Restoring a phone from the cloud must **not** restore usable family keys; the user goes through extra-device approval or recovery.
* `device_public` uploaded so an **approving human’s phone** can wrap to this device. Uploading a public key does **not** grant the family key.

If Elena gets a second phone, that is a new pair. It gets a wrap only after §4c.

### Wrapping (how the family key is shared)

**Never automatic.** A wrap is created only after an explicit tap on a phone that already holds the family key.

On that approving phone:

1. Show who and which device (name, role, device created-at).
2. Load that device’s `device_public`.
3. AEAD-seal the family key to a key derived from X25519 (approver ephemeral or static × device public), AAD as above.
4. Upload `{ family_space_id, user_id, device_id, wrapped_family_key, alg, key_epoch }`.

To read later, the approved device:

1. Load `device_private` from SecureStore.
2. Open the box.
3. Keep the family key in RAM while needed; persist the wrap on the server and the device private key in SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` / Android backup exclude). Optionally persist the unwrapped family key in SecureStore on that device for offline use, **same accessibility** — **still never on the server.**

### What the server stores (proposed tables, names can change in implementation)

All with RLS. No plaintext key columns.

| Table (proposed) | Purpose | Who can read |
|---|---|---|
| `device_keys` | `user_id`, `device_id`, `public_key`, `alg`, `created_at` | The user; admins and the user’s other devices (to show “approve this phone?”). Public keys are not vault secrets. |
| `family_key_wraps` | `family_space_id`, `user_id`, `device_id`, `wrapped_key` (bytea), `alg`, `key_epoch`, `approved_by` | Only the row’s user (to unwrap). Approvers **insert**, they do not need to SELECT other people’s wrapped blobs. |
| `family_key_meta` | `family_space_id`, `key_epoch`, `alg`, `created_at` | Members of the space. Metadata only. |
| `recovery_public_keys` | that member’s recovery **public** key | Members of the space (needed so an admin phone can seal a new family key to them). |
| `family_key_under_recovery` | per `user_id` and `key_epoch`, family key wrapped to that member’s recovery public key; AAD `family_space_id \|\| key_epoch \|\| user_id` | Readable by recovering devices after a valid recovery request (not before `not_before`). |
| `device_approval_notices` | pending/seen notices for new devices | The member’s other devices and admins of spaces that member belongs to (for key-eligible roles). |
| `recovery_contacts` | who is a recovery contact for a space | Admins manage; contacts see their own row. |
| `recovery_pair_wraps` | three boxes of **that member’s recovery private key**: under HKDF(A+B), HKDF(A+paper), HKDF(B+paper) | After recovery wait; recovering device. Contacts hold only their own secret wrap. |
| `recovery_contact_secrets` | contact A or B’s holder secret, wrapped to **that contact’s** device public key | Only that contact. |
| `recovery_requests` | who is recovering, new device, started_at, not_before (start+48h), cancelled | Admins, requester’s devices, named contacts (status only, not keys). |

**The server never stores:** family key plaintext, recovery private keys, a family-wide recovery secret, device private keys, printed recovery code, any hash or verifier of the printed code, contact holder secrets in plaintext.

**The server may store:** device public keys, recovery public keys, AEAD ciphertext of wraps and pair boxes, family-key-under-recovery per member per epoch, epoch integers, algorithm strings, recovery request timestamps.

---

# 3. Library choice

## Plain language

We will not invent cryptography. We pick a library that experts already review.

Two paths:

* **Works in Expo Go today:** JavaScript libraries (`@noble/ciphers`, `@noble/curves`, `@noble/hashes`).
* **Needs a development build:** libsodium (native).

We use only primitives **both** can speak, so ciphertext created today can still open if a review later says “switch to libsodium.”

## Comparison

| | **@noble/ciphers + @noble/curves + @noble/hashes** | **libsodium** (e.g. `react-native-libsodium`) |
|---|---|---|
| **Runs in Expo Go** | Yes. Pure JS/TypeScript. | No. Native module. Needs a development build. |
| **Primitives we will use** | X25519, XChaCha20-Poly1305, HKDF-SHA256; CSPRNG via `expo-crypto`. | The same three primitives, native C. |
| **Audit status** | noble-hashes / noble-curves / noble-ciphers are widely used and have had professional audits (confirm latest reports at implementation time; pin versions). Maintained by Paul Miller. | libsodium is among the most audited libraries in existence. RN wrappers vary; pin a maintained wrapper. |
| **Maintenance** | Excellent for JS. Risk: JS crypto is easier to misuse (timing) than native. | Excellent for C. Risk: Expo Go workflow breaks until EAS/dev client. |
| **Random numbers** | `expo-crypto.getRandomValues`. Never `Math.random`. | libsodium `randombytes`. |
| **Private key storage** | `expo-secure-store` only, either path. | Same. |

## Recommendation (decision Q5)

**Implement CIR05 with noble + `expo-crypto` + SecureStore** so Expo Go still works.

**Whether to switch to libsodium before beta is decided by the external security review**, not assumed in this design. Because we only use X25519, XChaCha20-Poly1305, and HKDF-SHA256, a later switch is a library change, not a data migration, if nonces, key sizes, and AAD stay specified and tested.

## Recovery math (decision Q3 A, Q6 A)

**Prefer an audited Shamir 2-of-3 package** that runs in Expo (implementation plan names `shamir-secret-sharing` and its audits). Threshold: any two of contact A, contact B, printed code. The secret that is split is **that member’s recovery private key**, not the family key.

**If that package is rejected at review, do not hand-write Shamir.** Use **pairwise wrapping** of **that member’s recovery private key** with the existing wrap module:

* Contact A holds `secret_A` (random 256-bit, wrapped only to A’s devices).
* Contact B holds `secret_B` the same way.
* Printed code is `secret_P` (≥128 bits of entropy; never on the server).
* Store **three** AEAD ciphertexts of **the member’s recovery private key**:
  * `box_AB = Enc(HKDF-SHA256(secret_A, secret_B), recovery_private)`
  * `box_AP = Enc(HKDF-SHA256(secret_A, secret_P), recovery_private)`
  * `box_BP = Enc(HKDF-SHA256(secret_B, secret_P), recovery_private)`
* Any two holders derive the matching HKDF key and decrypt the recovery private key. One holder cannot.
* Then open **that member’s** `family_key_under_recovery` row for the current `key_epoch` with the existing wrap module (sealed to the recovery public key). Wipe the recovery private key afterwards.

HKDF info/salt must bind `family_space_id` and the member `user_id` (and a **recovery_key_epoch** if that member redos setup) so boxes cannot be mixed across families or members.

Printed code is checked **on device** by trying reconstruction (AEAD open succeeds or fails). **No hash of the code is stored on the server** (decision Q4).

---

# 4. Flows

Each flow: plain steps, then a short technical note.

## 4a. Creating a family

**Plain steps**

1. Elena names the family and we create the space (already built).
2. Her phone creates a device key pair (once per phone) and stores the private key in the secure store.
3. Her phone creates the **family key**.
4. Her phone wraps it to **this same phone** (she is approving her own first device by creating the space) and uploads only the wrap.
5. Home works. Recovery helpers are **required before Legacy Vault**, not before Home (Q1 A). We prompt until two contacts are set when she first opens a vault feature; that ceremony mints **her** recovery key pair, stores the public half, puts the private half only in 2-of-3 boxes, seals the current family key to that public key, and wipes the private half.

**Technical**

* Generate device pair if missing. Store private key with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` / Android backup exclude.
* `family_key ← random(32)`.
* `key_epoch = 1`.
* Insert `family_key_meta`, `device_keys`, `family_key_wraps` for Elena’s device (`approved_by` = herself). No recovery wrap on the device.
* Cache the family key in SecureStore with the same accessibility.

## 4b. A new member’s first device

**Plain steps**

1. Marco accepts the invite. He can see Home (RLS). He does **not** have the family key yet.
2. His phone creates a device key pair and uploads the public key. That is a **request**, not access.
3. **Admins** (and Co admins) get a notice: “Marco wants this phone let in,” with **his display name** and **when the device was created**.
4. An admin opens that notice on a phone that already has the family key and taps **“Let Marco in”** (or decline).
5. Only then does the admin’s phone wrap the **family key** to Marco’s public key. There is no recovery-key wrap to the device (D27).
6. Until then Marco sees a calm screen if he opens vault: “Waiting for a family admin to let this phone in.”

Other members’ apps **must never auto-wrap** because a public key appeared.

**Who gives the key:** a Family admin or Co admin who already holds the family key, after an explicit tap. Not Patria. Not a background job.

**Who may receive a wrap (Q2 A):** Family admin, Co admin, Teen, Elder. Not extended relative, caregiver, successor, child.

**Notices:** every new device for a key-eligible member notifies **that member’s other devices** (none yet on first device) **and all admins**.

**Against a malicious server inserting a fake device public key**

The server can insert a row `{ user: Marco, public_key: attacker }`. That row does nothing until a human wraps to it. The admin UI must show:

* Member **name** (from profile, which the admin already knows)
* **Device created at** (if “created three seconds ago at 3 a.m.” that is a signal)
* That this is a **first device** vs an extra device

The wrap is created **on the admin’s phone** with AAD bound to `user_id` and `device_id`. A fake row that never gets a tap never gets a family key.

**Safety code verification (option for the security review)**

Not required for CIR05 v1 unless the reviewer asks for it: both phones show a **short comparable code** derived from the new device’s public key (and space id), like Signal’s safety numbers. Elena reads it to Marco; they match before she taps Let in. Defends against a server that swapped the public key **and** Elena not noticing a brand-new device timestamp. List this as optional; do not block CIR05 on it.

**Technical**

* Joiner inserts `device_keys` + `device_approval_notices`.
* No client queries “unwrap for anyone missing a wrap” in the background.
* Admin wrap insert is the only path from notice → `family_key_wraps`.
* RLS: only admins insert wraps for **another** user; a user never inserts their own wrap except 4a (space creator) or after recovery reconstructs on-device.

## 4c. Additional device for an existing member

**Plain steps**

1. Elena signs in on a new phone. It creates a new device key pair and uploads the public key.
2. **No other member’s app wraps to it.** Marco must not be offered “Let Elena’s new phone in” as a substitute for Elena’s own approval (except admins are notified).
3. Notices go to **Elena’s existing devices** and to **admins**.
4. She opens Patria on an **existing** phone that already has the family key and taps **“Yes, this is my new phone.”** That phone wraps to the new public key.
5. If every existing phone is gone: recovery (§4d), not a family-member auto-wrap.

**Technical**

* Approval allowed from a device that already has a wrap for `(user_id, space_id, key_epoch)` for **the same user**.
* Admins are notified (stolen-account signal) but **do not** wrap Elena’s extra device; that would let a rogue admin clone her access onto an attacker phone without her. **Exception:** if the reviewer prefers admin-can-approve-extra-devices for support, call that out; **this design says no** — extra devices = self or recovery only.
* Lost-device revoke: delete that device’s wrap and public key; if stolen, rotate epoch (§4e).

## 4d. Lost phone with recovery contacts

**Plain language**

CIR05 asks for **two** recovery contacts. In v1 they are adult family members who hold the key (D26). Contacts outside the family come later.

**One rogue contact must not steal the family.** Contacts do not hold the family key. They help reconstruct **that member’s recovery private key**. You need **any two of:** contact A, contact B, printed code. Then the new phone opens **that member’s** current-epoch family-key-under-recovery box and wipes the recovery private key.

**Printed code (Q4 A, change 2)**

* Optional, strongly prompted when setting up recovery.
* **Full entropy, at least 128 bits** — for example **24 words from a standard wordlist** (BIP-39 style list is fine if we use it only as a wordlist, not as an HD wallet).
* Shown once. “Write this down. We cannot show it again.”
* Confirm by typing it back on the same phone (AEAD round-trip locally).
* **Store nothing about it on the server** — no hash, no verifier, no preview. If they type it during recovery, the device tries to open `box_AP` or `box_BP` (those boxes hold **this member’s recovery private key**). Success means it was right. The code still works after later family-key rotations until this member redos recovery setup.

To recover on a new phone after sign-in:

1. Elena, signed in as herself, taps “I lost my phone.”
2. **Waiting period: 48 hours** from that moment. Recovery cannot finish earlier.
3. At the start we notify **all of Elena’s existing devices** (if any still registered) and **all admins**, with **“This wasn’t me”** to cancel.
4. Contacts are told: **confirm with Elena by phone or in person** before approving. The app shows her name, family, new device created-at — not a key.
5. After 48 hours, if not cancelled, she still needs two of {A, B, paper}. Each approving contact’s phone sends what is needed to reconstruct **her recovery private key**, wrapped to her **new** device public key.
6. Her new phone reconstructs that private key, opens **her** `family_key_under_recovery` row for the newest epoch, wraps the **family key** to that device, wipes the recovery private key, and then she can remove old phones. Complete does not auto-revoke old devices.

**How we stop one rogue contact**

* One secret cannot open any pair-wrap (or one Shamir share cannot open).
* They cannot skip the 48 hours.
* They cannot complete recovery without Elena’s login (or they would be recovering *their* account, not hers).
* Non-member contacts never get a member wrap.

**Technical**

* `recovery_requests.not_before = started_at + recoveryWait()`. Production **always 48 hours**. Development builds only may use a short wait (for example 2 minutes) so recovery can be tested on a phone; a unit test asserts production is 48 hours.
* Client and RLS must refuse pair-wrap / share delivery before `not_before`, and after cancel.
* Cancel from any of the requester’s **existing** devices that still have a wrap, or from an admin? **Cancel: requester’s existing devices and admins** (“This wasn’t me”).
* Contacts approve only after `now >= not_before` still pending; copy tells them to call first **when the request is created**, not only at hour 48.
* Reconstruction only on the recovering device.

GROW04 later: different split. Do not overload CIR05 tables for death handover.

## 4e. A member is removed

**Plain steps**

1. Admin removes Marco (already exists for membership).
2. We **rotate the family key** on remaining **already-approved** devices (not a back door for new devices).
3. Seal the **new** family key to each remaining member’s recovery **public** key (existing wrap module). The rotating admin cannot open those private keys.
4. Delete Marco’s family-key wraps, recovery public key, and sealed boxes. If Marco was a **recovery contact**, the people who named him see “Recovery needs attention” and must redo setup when they are ready; until then remaining contact plus printed code still work, and Marco cannot approve.
5. **Content he already saw:** we cannot unsay it. **LEG01 slice 1 (D33):** the rotating admin phone unwraps each vault CEK with the old family key, wraps it for the new epoch, and sends those re-wraps in the same `rotate_family_key` call as the new family-key wraps and recovery seals. The server checks that every `vault_entries` row at the old epoch is present exactly once (24-byte CEK nonce, 48-byte wrap), then compare-and-swaps the epoch and commits all or nothing. If a row is missing (for example someone saved meanwhile), it refuses and the phone retries with a fresh list. There is no previous-family-key cache and no later “finish re-wrap” pass. **Very large vaults may need batching later** (payload and statement limits); until then rotation sends the full set in one call.
6. CIR05: remaining members’ existing devices get new family-key wraps; we never wrap to an unapproved device during rotation.

**Technical**

* `key_epoch++`; new random family key.
* Re-wrap family key only to device ids that had a wrap at the old epoch and still belong to remaining key-eligible members.
* Re-seal `family_key_under_recovery` for the new epoch to each remaining member who has a recovery public key. Exact device set and exact sealed-box set; compare-and-swap on epoch.
* If a recovery contact was removed: keep the remaining member’s pair boxes until they redo; on redo delete old recovery public key and all its sealed boxes, then mint a new pair.
* RLS: removed user cannot SELECT new wraps. Their old recovery material cannot open a new epoch.
* Open later: rotating the family key after a stolen phone **without** a membership change.

## 4f. Child profiles and successors

**Children under 13 (D6)**  
No Auth user, no device, **no keys**.

**Successors**  
Named only. **No family-key wrap** until GROW04.

**Caregivers (Q8 A)**  
No wrap. Out of scope for time-limited vault access.

## 4g. Families that already exist from slice 1 testing (Q7 A)

**Plain steps**

1. Next time an **admin** opens that family, if `family_key_meta` is missing, run 4a on **that** phone (lazy).
2. Other members still need **admin “Let them in”** per device (§4b), not a bulk auto-wrap when the admin opens Home.
3. Recovery contacts: prompt before vault, not before Home.

No server-side key generation. No plaintext in a migration.

---

# 5. Failure modes and lockout

## Plain language

| Situation | What happens |
|---|---|
| Lost one phone, still have another | Approve the new phone from the old one after 4c, or wait if using recovery. |
| Lost every device, email login + two contacts | Start recovery; 48 hours; both contacts approve after confirming in person or by phone. |
| Lost every device, one contact unreachable, have paper | After 48 hours: remaining contact + typed paper code. |
| Lost every device, both contacts gone, paper gone | **Permanent lockout** of vault content. Patria cannot help. |
| Contact turns rogue | One secret is not enough. 48 hours + notices. Admins can replace contacts and rotate. |
| “This wasn’t me” during the 48 hours | Request cancelled. No wrap. |

**Make lockout unlikely without a backdoor**

* Two recovery contacts before vault.
* Strongly offer the printed 24-word code (optional).
* Yearly reminder to test recovery.
* Do **not** escrow a copy to Patria.
* Do **not** store a hash of the paper code (that would not help recovery and would give the server something to brute-force if entropy were ever too low; we require ≥128 bits anyway).

---

# 6. What we will test vs human review

## Automated (when we implement)

**Jest (app)**

* Wrap to a public key; unwrap with the matching private key; fail with the wrong key.
* AEAD fails if AAD (space, epoch, user, device) is wrong.
* Pairwise (or Shamir if packaged): any 2 of 3 rebuild; 1 of 3 does not.
* Printed code: reconstruction AEAD succeeds or fails; **no** server hash helper exists.
* Recovery reconstructs **that member’s recovery private key**, then that member’s current-epoch family-key box; family-key rotation does not invalidate that member’s pairwise boxes until they redo setup.
* Recovery wait is 48 hours in production; `__DEV__` may shorten it; a test proves production is 48 hours.
* Recovery refuses to complete before `not_before`; cancel stops delivery.
* SecureStore writes for keys use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (test the options object).
* No wrap without an approval record.
* Extra device is not wrappable by a different member’s client helper.
* Removal: old user has no wrap at new epoch.
* Children / successors / caregivers / extended relatives never get wraps.
* No function logs key bytes.
* SecureStore used for private keys.

**pgTAP**

* Cannot SELECT another user’s `family_key_wraps.wrapped_key`.
* Cannot SELECT another family’s meta.
* Insert wrap for another user: admins only, for first devices of key-eligible roles; extra-device wrap insert only by the same `user_id`.
* Removed member cannot read wraps.
* Recovery pair-wraps / contact secrets RLS.
* `recovery_requests` not usable before `not_before` / after cancel.
* `family_key_under_recovery` is ciphertext; no printed-code hash column.
* No `recovery_key_wraps` table. No column stores a recovery private key or a family-wide recovery secret.
* Cross-family isolation (D5).

## Human security review (required before real families)

* This document and the first implementation PR.
* Every file marked `// SECURITY REVIEW REQUIRED`.
* Library pins and audits for noble; **whether to switch to libsodium before beta**.
* Optional safety-code UX (§4b).
* HKDF pairwise vs named Shamir package.
* Wrap-overwrite and AAD binding.
* LEG01: server cannot decrypt Ledger content; **per-item or per-circle keys**.

---

# 7. Decisions (answered)

| # | Choice |
|---|---|
| **Q1** | **A.** Recovery contacts required before Legacy Vault only. Home works without them. |
| **Q2** | **A.** Wraps only for Family admin, Co admin, Teen, Elder. Not extended relative, caregiver, successor, child. |
| **Q3** | **A.** 2-of-3 among contact A, contact B, optional printed code. |
| **Q4** | **A.** Printed code optional but strongly prompted, as the third holder. **≥128 bits (e.g. 24 words). No hash or verifier on the server. Verify by AEAD reconstruction on device.** |
| **Q5** | **A.** noble + expo-crypto + SecureStore for CIR05. Primitives: **X25519, XChaCha20-Poly1305, HKDF-SHA256** only. **Switching to libsodium before beta is the external reviewer’s call**, not a foregone conclusion. |
| **Q6** | **A.** Audited Shamir package if it fits Expo. **If not: pairwise wrapping** (three AEAD boxes under HKDF of each pair of holder secrets). No hand-written Shamir. |
| **Q7** | **A.** Lazy key creation when an admin next opens an existing family. |
| **Q8** | **A.** Caregivers: no wrap. |
| **Q9** | **A.** AEAD AAD = `family_space_id \|\| key_epoch \|\| user_id \|\| device_id`. |

Plus: **no automatic wrapping**; **48-hour recovery wait** with cancel and in-person/phone confirm; **per-member recovery key pairs (D27)**; **SecureStore not in cloud backups**. Recorded in `docs/DECISIONS.md` as D20–D27 (KEYS approval asked for D17–D22; those numbers were already taken).

---

# Open questions

* Rotating the family key after a stolen phone **without any membership change** is a later slice.

---

# 8. Residual risks for the security reviewer

This design still does **not** stop:

1. **An approved, unlocked phone** — whoever holds Elena’s unlocked device and SecureStore can unwrap.
2. **A fully compromised OS** (jailbreak / malware with keystore access).
3. **An admin who approves a fake first device** without checking name and created-at (or safety codes, if we do not ship them).
4. **A stolen account + two colluding recovery contacts** after 48 hours, if Elena does not cancel (they still need her login; if they also have her password and email, that is account takeover plus recovery).
5. **Both recovery contacts colluding** while Elena is locked out of email — they still should not get a *member wrap* without her new device completing recovery as her user; review this path carefully.
6. **Content a removed member already decrypted or screenshotted**; old epoch ciphertext until LEG re-encrypts.
7. **Circle boundaries while using one family key** — ciphertext dump + any key-holder reads all vault circles until per-item/per-circle keys exist.
8. **Timing side channels in JavaScript noble** if we have not switched to libsodium.
9. **Denial of service** — malicious server dropping wraps or notices; annoying, not a decrypt.
10. **Physical coercion** of an admin or both contacts.
11. **Paper code photographed or phished** — it is a bearer share; treat like a password on paper. It survives family-key rotation by design, so a leaked old printout still unlocks **that member’s** recovery private key until they redo setup.
12. **An approved, unlocked admin phone** — the attacker can rotate the family key and seal new epochs to remaining recovery public keys until that device is revoked. They cannot open another member’s recovery private key.
13. **Android backup misconfiguration** if a future app.json backup rule overrides Expo’s SecureStore exclude. Implementation must keep `configureAndroidBackup` / the exclude XML.

---

# 9. What CIR05 step 2 will look like in the repo

Protocol is approved. Code waits on Step 1 in `KEYS_IMPLEMENTATION.md`. Expected files (names indicative):

* `patria-app/src/lib/crypto/` — generate, wrap, unwrap, HKDF pairwise or Shamir package; every file tagged `// SECURITY REVIEW REQUIRED`
* `patria-app/src/features/keys/` — Let in, extra device, recovery contacts, printed code, waiting 48 hours, This wasn’t me
* New migration: tables above, RLS, pgTAP
* Copy in `copy.ts` only (D11)
* `docs/BUILD_LOG.md` entry; lasting protocol choices in `DECISIONS.md`

**Not in that PR:** encrypting Decision Ledger, letters, documents, photos; per-circle item keys; GROW04; merging spaces.

---

# 10. CIR05 acceptance criteria this slice can meet

| Criterion | This slice |
|---|---|
| Family keys created on the device; server never receives an unencrypted family key | **Yes, if implemented as designed** |
| Recovery contacts (two) before Legacy Vault | **Yes** (contacts + 2-of-3; vault still later) |
| First Story in 10 minutes / welcome SMS | **No** (D1, other CIR05 steps) |
| What others can see before accept | **Already elsewhere** |

---

Implementation steps: `docs/security/KEYS_IMPLEMENTATION.md`. **No code until that plan is approved, starting at Step 1.**
