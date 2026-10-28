# Patria build decisions

This file answers open questions raised while planning. Where it is more specific than `PRD.md` or `FEATURES.md`, this file wins. Add new decisions at the bottom with a date.

---

## D1. Slice 1 scope (October 2026)

Slice 1 builds: email sign up and sign in, create a family space, invite members with a role and default circle, accept an invite, revoke an invite, see the member list, and the default circles.

Not in slice 1 (add TODO markers where they plug in):
* Family encryption keys and recovery contacts (CIR05 step 2)
* Photo library connection and first Story (CIR05 steps 3 and 4)
* SMS invites and elder participation by phone (CIR03)
* Merging two family spaces created by two parents
* Linked households and shared children across homes (CIR04)
* Teen private space (GROW02)

These CIR05 acceptance criteria are **not yet** for slice 1 and must be listed as such: first Story within 10 minutes, welcome SMS within 1 minute, family keys created on device.

## D2. Design

Use the exported screens in `docs/design/` when present. Where a screen is missing, build a clean placeholder screen using the theme tokens, and list which screens were placeholders. Never invent a final visual design.

## D3. Source of truth for onboarding

`FEATURES.md` is the source of truth for CIR05. The PRD table in section 9.8 lists CIR01 to CIR04 only; CIR05 was added in the Feature Requirements Document.

## D4. Sign in methods

Slice 1: email and password, with email verification, through Supabase Auth.
Before App Store submission: add Sign in with Apple and Google sign in. (Apple requires Sign in with Apple when an app offers other third party sign in options.)

## D5. One person, many family spaces

The schema must allow one user to belong to many family spaces from day one (many to many membership with a role per space). The app shows a family space switcher only if a user belongs to more than one.

## D6. Children under 13

In version 1, children under 13 are **managed profiles** created by a Family admin. They have no login and no device access. They can be tagged in items and appear in the member list. Child logins come later with Age Bands (GROW01).

## D7. Family admin and Co admin

* **Family admin and Co admin have exactly the same permissions.** Both can do everything in the table in D8. The two names exist only so a family can label who set up the space versus who helps run it.
* A family space can have more than one Family admin or Co admin (for example both parents and a grandparent).
* A family space must always have **at least one Family admin or Co admin**. The last remaining admin (of either kind) cannot be removed, cannot leave and cannot change their own role until another admin exists.
* Wherever `PRD.md` or `FEATURES.md` says "only Family admins" can do something, read it as "Family admins and Co admins".
* In code and database policies, treat both as one permission level (for example a helper such as `is_space_admin()` that returns true for either role), so the two can never drift apart.

## D8. Permission matrix for slice 1 actions

Server side Row Level Security must enforce this table. Write a test for every Yes and every No.

| Action | Family admin and Co admin | Teen (13 to 17) | Elder | Extended relative | Caregiver | Successor | Child (no login) |
|---|---|---|---|---|---|---|---|
| View family space name | Yes | Yes | Yes | Yes | Yes (while active) | No | n/a |
| View member list | Yes, all | Yes, all | Yes, all | Only members in circles they share | No | No | n/a |
| Rename family space | Yes | No | No | No | No | No | n/a |
| Invite a member | Yes, any role | No | No | No | No | No | n/a |
| Revoke a pending invite | Yes, any | No | No | No | No | No | n/a |
| Add a child profile | Yes | No | No | No | No | No | n/a |
| Change a member's role | Yes | No | No | No | No | No | n/a |
| Remove a member | Yes, anyone except the last admin | No | No | No | No | No | n/a |
| Leave the family space | Yes, unless the last admin | Yes | Yes | Yes | Yes | Yes | n/a |
| Create or edit custom circles | Yes | No | No | No | No | No | n/a |
| Change default circles per item type | Yes | No | No | No | No | No | n/a |
| Name successors (custody) | Yes | No | No | No | No | No | n/a |
| Delete the family space | Yes | No | No | No | No | No | n/a |

"Last admin" means the last remaining Family admin or Co admin.

Rules that go with the table:
* Caregiver access always has an end date (default 24 hours, maximum 30 days) and ends automatically.
* Successors have no access at all until a custody handover completes (GROW04, later phase).
* A role change is shown to the affected person the next time they open the app, and in a notification.
* A teen cannot be moved to a role with less privacy without being notified.

## D9. "Only Me" versus teen private space

They are different mechanisms.
* **Only Me** is a visibility circle any member can choose for an item. Slice 1 includes it as a default circle.
* **Teen private space** (GROW02, later phase) is a separate encrypted area protected by the teen's own key, with an agreement between teen and parents. Not in slice 1.

## D10. How fast access changes take effect

* Access is enforced on the server by Row Level Security, so removing someone from a circle or the family space blocks them **immediately** on the server.
* In slice 1 the app refreshes data when it opens, when it returns to the foreground, and when the user pulls to refresh. Realtime updates (under 60 seconds across devices) come in a later slice.

## D11. Languages

Slice 1 is English only. Keep all user facing text in one place so translation can be added later. Supporting other languages (including Spanish, Yoruba, Igbo and Hausa) is product intent for later phases.

## D12. Invites

* Invites are sent by shareable link (and QR code later). Email delivery of invite links can use Supabase's email or a later email provider; SMS comes with CIR03.
* Invites expire after 14 days, can be revoked, and can only be accepted once.
* Before accepting, the invitee sees a plain language summary of their role and what others in the family can see about them.

## D13. Admin roles merged in permissions (October 2026)

Family admin and Co admin now have identical permissions (see D7 and D8). This replaces the earlier version where Co admins could not change roles, remove admins, delete the space or manage successors.

## D14. Slice 1 database shape (October 2026)

Approved schema for CIR05 / CIR01 / CIR02 (no UI, no cryptography).

* **profiles** are 1:1 with Supabase Auth users (`id` = `auth.users.id`). Display name is stored here because the create-family mockup collects "Your name" separately from role.
* **space_members** is many-to-many (D5). Role is per space. `relationship_label` (Mom, Dad, Grandparent, Guardian) is display-only and never used in RLS.
* **Children under 13** live in **child_profiles**, not `space_members` and not Auth (D6). They can be members of circles (so an extended relative only sees a child if they share a circle).
* **Default circles** Household, Extended Family and Close Friends are created with the family space and cannot be deleted. **Only Me** is one circle **per member per space** (not one shared family circle), because one person can belong to many spaces (D5) and Only Me must not leak across spaces. Only Me is not teen private space (D9).
* **circle_item_type_defaults** exists so D8 "change default circles per item type" can be enforced and tested before photos and tasks exist. New spaces default every item type to Household.
* **Invites** are email + shareable token, 14-day expiry, revocable, accepted once (D12). Phone/SMS is a TODO column for CIR03. Creating a membership always goes through `create_family_space` (founder) or `accept_invite` (everyone else), not a direct insert into `space_members`.
* **Caregiver** rows must have `caregiver_access_ends_at` (default 24 hours, hard maximum 30 days). After that time they are treated as inactive for space access.
* **Successors** may have a membership row so they can be named, but RLS gives them no family data. They may leave (delete their own membership).
* **Last admin** means the last Family admin or Co admin (D7). A trigger blocks remove, leave, and self-demotion that would leave zero admins. Deleting the whole family space is allowed for an admin and cascades.
* Family encryption keys and recovery contacts are **not** stored. `family_spaces` has a TODO comment for key metadata later. The server must never receive an unencrypted family key.

## D15. How we record build choices (October 2026)

Append a dated entry to `docs/BUILD_LOG.md` whenever we implement a slice or make a technical choice, with what we did and why. `DECISIONS.md` stays the short, numbered source of truth. `BUILD_LOG.md` is the narrative.

## D16. Invite delivery and decline (October 2026)

* An invite always stores an email (so accept can match the signed-in account) **and** a shareable `patria://invite/{token}` link. The inviting person can send the link with the phone share sheet **or** open an email draft to that address. Same token either way.
* **Decline** invalidates the token on the server (`declined` status). Accept and preview then fail.
* Pending invites still expire after 14 days even if nobody declines (`expires_at`).

## D17. Member email visibility (October 2026)

Member email addresses are visible only to Family admins and Co admins. Other members see names and roles.

## D18. Where people paste an invite (October 2026)

The invite paste box shows on Welcome and Create family. Members already in a family join another through a small Join another family link, not a box on Home. (Phone feedback asked to number this D15; D15 already records how we log builds.)

## D19. Dynamic Type deferred until an accessibility pass (October 2026)

Full Dynamic Type support is deferred to a dedicated accessibility pass before beta with grandparents. Until then, text scaling is capped so no screen breaks. (Phone feedback asked to number this D16; D16 already records invite delivery and decline.)

## D20. Family keys stay on the phone (12 October 2026)

Family keys are created on the phone; Patria never holds a usable family key. See `docs/security/KEYS.md`. (KEYS approval asked to number this D17; D17 already records member email visibility.)

## D21. Who gets the family key (12 October 2026)

Family admin, Co admin, Teen and Elder receive a wrap of the family key. Extended relatives, caregivers, successors and children do not. Recovery private keys are not kept on any device (D27). (Asked as D18; D18 already records where people paste an invite.)

## D22. No automatic wrapping (12 October 2026)

A device gets the family key only after a person taps approve. An admin lets in a member’s first phone. Members approve their own extra phones. Admins cannot approve someone else’s extra phone. (Asked as D19; D19 already records the Dynamic Type deferral.)

## D23. Recovery contacts and the printed code (12 October 2026)

Recovery needs any 2 of 3: contact A, contact B, and an optional 24-word printed code. There is a 48-hour wait with “This wasn’t me.” Nothing about the printed code is stored on the server. Removing a key holder rotates the family key; other members do not need a new printed code unless that person was their recovery contact. (Asked as D20. D27 replaces a single family-wide recovery secret.)

## D24. Crypto libraries for family keys (12 October 2026)

CIR05 uses noble with X25519, XChaCha20-Poly1305 and HKDF-SHA256 only. Switching to libsodium before beta is the security reviewer’s decision. (Asked as D21.)

## D25. When recovery contacts are required (12 October 2026)

Recovery contacts are required before the Legacy Vault, not before Home. (Asked as D22.)

## D26. Recovery contacts in v1 are adult family members with keys (12 October 2026)

Recovery contacts (first version) are adult family members with a key-eligible role (Family admin, Co admin, Elder) whose device has been let in. Not teens, children, extended relatives, caregivers or successors. Contacts outside the family come later with a recovery-contact invite. (Asked as D23; D23 already records the 2-of-3 recovery protocol.)

## D27. Per member recovery key pairs replace the single family recovery key (13 October 2026)

Each key-holding member has an X25519 recovery key pair. The public half is stored on the server. The private half exists only inside that member’s 2-of-3 pair boxes and is wiped from memory after setup and after recovery. No device keeps it. There is no family-wide recovery secret and no `recovery_key_wraps`. The family key under recovery is one sealed box per member per epoch, sealed to that member’s recovery public key with the existing wrap module. Rotation seals the new family key to remaining members’ recovery public keys; it cannot open those private keys. A removed admin, a completed recovery, or two contacts of one member must not be able to open another member’s future recovery boxes.

## D28. Development bundle identifier is provisional (13 October 2026)

The iOS bundle identifier `app.patria.dev` is for local development and Maestro phone tests only. A production App Store identifier will be chosen before submission. Normal `npx expo start` still loads `patria-app/.env` and the hosted test project. Only the e2e native build loads `patria-app/.env.e2e.local` (local Docker Supabase).

## D29. Memory Stream uses Standard-tier cloud storage (16 October 2026)

The Memory Stream follows the industry default used by Apple and Google.

* On the phone, photos rely on the phone’s own encryption.
* In the cloud and when shared in circles, photos use the **Standard** tier: private Supabase Storage, encrypted in transit and at rest, **not** with the family key. The family key stays for the vault. This matches iCloud’s default setting and Google Photos. Apple’s Shared Albums also stay outside end-to-end encryption.
* Circle rules are enforced by the database for both the `memory_items` row and the Storage file, through one helper (`can_view_memory`) used by both.
* A later opt-in layer, **Private Memories**, will add per-circle end-to-end encryption (comparable to iCloud Advanced Data Protection). It will be designed like the family keys and reviewed by the security reviewer before it is built.

Memories slice 1 role table (server RLS). Children under 13 have no login (D6).

| Action | Family admin and Co admin | Teen | Elder | Extended relative | Caregiver | Successor |
|---|---|---|---|---|---|---|
| View memories in circles they belong to | Yes | Yes | Yes | Yes | No | No |
| Add photos to those circles | Yes | Yes | Yes | Yes | No | No |
| Move or delete a photo they uploaded | Yes | Yes | Yes | Yes | No | No |

Only Me is always offered. An item is visible only to members of its circle (Only Me: the uploader). Moving asks to confirm only when the new circle contains anyone who is not in the current circle. Uploads create a hidden `uploading` row first; others see the item only when it is `ready`. Delete removes Storage files through the Storage API, then the row. Signed viewing links last ten minutes. Already-issued links may work until they expire; a person who has left cannot mint a new one.

## D30. Default circle membership (16 October 2026)

Every family space still gets four default circles. Membership of those circles is set by the server when a family is created, when someone accepts an invite, and when a role changes. Admins can add or remove people afterwards.

* **Household:** Family admin, Co admin, Teen and Elder. (Admins can change this later.)
* **Extended Family:** every family member who belongs in Household, plus Extended relatives. It is the wider family, a superset of Household.
* **Close Friends:** empty until an admin adds people.
* **Only Me:** that person only.
* **Caregiver** and **Successor** are not added to Household or Extended Family.
* Children under 13 (no login) follow Household only.

A migration backfills existing families. The Memories picker only lists circles the uploader belongs to, so Close Friends stays hidden until someone is in it. The invite’s default circle is still applied on accept if it is a shared circle the person is not already in.

## D31. Library sync and short video (17 October 2026)

MEM01 slice 2. Standard tier (D29). Default circles (D30).

* Only the phone’s owner can create, change or read their library connection. No admin can turn sharing on for anyone else.
* Album names, album ids and local asset ids stay on the phone. The server stores at most: user, family, device, mode, target circle, WiFi or cellular, paused, timestamps, and an opaque source hash.
* The HMAC key is a 32-byte secret per user in `memory_source_keys`. RLS: only that user can select or insert; there is no update. `get_or_create_memory_source_key` inserts once (`ON CONFLICT DO NOTHING`) then fetches, so two devices racing share one key and never replace it. Hash input is the Photos asset id when the picker returns one, otherwise the original file bytes before re-encoding. Uniqueness is `(uploader_id, family_space_id, source_hash)`, so the same photo can still go to another family. Moving circles does not create a new row.
* Start point is From today (default) or the last 30 days. Never the whole library. If the start is last 30 days, or more than 20 items are waiting, show the count and circle and ask before sharing.
* Photo library permission, media-library reads and the sync engine start only after the member is signed in and has turned on Connect my photos. Permission is asked when they tap Continue on Connect, not at launch. Sync runs on open, on foreground, and while Patria stays open. No background tasks. WiFi only by default; cellular is a switch. Android library sync waits for a development build.
* Videos (picker only in this slice): at most 60 seconds and 50 MB after a Medium export. Add photos shows “Videos up to 1 minute and 50 MB” before the picker opens and on the share screen. `allowsEditing` stays off so multi select remains. A custom Photos picker that checks duration and size before export waits for a development build. `expo-image-picker` documents `asset.duration` in milliseconds on iOS and Android; we always divide by 1000 before the limit check, storage, and the thumbnail length. A missing or zero duration is refused, not guessed. Length and picker `fileSize` are checked as soon as the picker returns, before Share. Scan `udta`, `meta`/`keys` (`com.apple.quicktime.location.ISO6709`) and `©xyz`. If the scanner cannot parse the file, refuse it. A JPEG frame is taken on the phone about 1 second in (first frame if shorter), re-encoded so it carries no location, and stored as `thumb.jpg`. If that fails, a full-size matte placeholder is stored instead of a stretched speck. Resumable upload above 6 MB. Photos stay capped at 8 MB in the app. If one item in a mixed pick is refused, the others still upload and the skip is named on the add screen (we do not navigate away and hide it). Medium export and the location scan stay as they are.
* Deleting a library-sync item writes a tombstone (same hash, owner-only RLS) so sync does not re-share it. Adding it again by hand through Add photos is allowed and clears the tombstone.
* Leaving or being removed from a family deletes that person’s connection rows for the family. If they are no longer in the target circle, sync pauses and asks them to pick a circle.

## D32. Design foundation (18 October 2026)

Hearth palettes (light linen / dark forest) and Heirloom type (Cormorant Garamond + Manrope) are the product look. Screens use `patria-app/src/ui` and `useTheme()` tokens, never the frozen light `colors` export, so cards and fields stay readable in dark. Cormorant Display, Title and Section use lining numerals. Icons are Lucide paths drawn with `react-native-svg` only.

Tabs are Home, Memories, Vault and Family. Vault uses a lock. Appearance (`system` | `light` | `dark`) lives on Family and is stored in expo-secure-store. Headers, the tab bar and the status bar follow the theme. Home greets the family by name (time of day), shows a terracotta date overline, keys/recovery as themed pills, security notices, recent memories, and a Vault coming-next card. The weekly Sync placeholder is gone. We do not add Sync or Privacy tabs.

Body text meets WCAG AA 4.5:1. Text scaling stays capped at 1.3 until the accessibility pass (D19). Security wording, warning prominence and Maestro testIDs stay as they are.

## D33. Decision Ledger slice 1 (19 October 2026)

LEG01 text-only. Voice, AI summaries, video and sealing (LEG02) wait.

* Readers: key holders (Family admin, Co admin, Teen, Elder) who have been let in. Writers: adults with the key (Family admin, Co admin, Elder). Teens read only. Only the author can edit or delete. Follow-ups are child rows (`parent_entry_id`), one level, same author.
* Each entry has its own 32-byte CEK, wrapped to the current family key (XChaCha20-Poly1305). The server stores ciphertext, 24-byte nonces and a 48-byte wrapped CEK. Content JSON is padded to the next 1 KB before encrypt so size does not reveal length, then capped at 64 KB ciphertext. INSERT and UPDATE must use the family’s current `key_epoch`.
* Recovery (two accepted contacts and a recovery public key) is required before write, not before read (D25).
* Entries stay when a member is removed. If the author is no longer a member, the app shows **A former family member**.
* Family key rotation re-wraps every vault CEK in the same `rotate_family_key` call as the new family-key wraps and recovery seals. The set of entry ids must be exactly the rows at the old epoch, once each, with exact sizes; compare-and-swap on the epoch; all or nothing. If a row is created meanwhile, the call is refused and the phone retries. There is no `familyKeyPrev` and no later re-wrap pass. Very large vaults may need batching later (see KEYS.md).
* Drafts: a random draft key in SecureStore and the ciphertext as a file in the app document directory. Both are deleted on Save or Discard.

## D34. Decision Ledger slice 2 (24 October 2026)

Voice notes and Only me entries. No AI, no transcripts.

* Voice: recorded in Patria with expo-audio (AAC mono ~64 kbps), hard stop at 5 minutes. Each recording has its own 32-byte file key. AAD `patria/vault-audio/v1` + family + entry + audio id. Pad to 256 KB, cap ~6 MB. File key, nonce, duration and audio id live in the entry JSON (CEK-protected). Ciphertext goes to a private `vault` bucket, path `family/entry/audio`. Playback decrypts to a cache file; that file is deleted when leaving the screen and on app start (honest limit: a determined person with the unlocked phone could copy it while it exists).
* Only me: `visibility` `family` | `private`. Personal key is 32 bytes per member per family, created once by `create_personal_key` (exact approved-device set + recovery seal, or refuse). If a key already exists, the phone unwraps its own device wrap; if it has none, it shows **Approve this phone from one of your other phones**. Device wrap AAD `patria/personal-key/v1` + family + user + device. Recovery seal AAD `patria/personal-key-recovery/v1` + family + user. Private CEK AAD `patria/vault-cek-private/v1` + family + entry + version + user. `key_epoch` is null for private rows.
* No direct UPDATE/DELETE on `personal_key_under_recovery`. Recovery re-seal happens only inside `replace_recovery_public_key` with the new public key. Wrap DELETE is only for a device you own.
* Follow-ups always match the parent visibility. Switching a parent re-wraps every follow-up in `commit_vault_visibility_switch`.
* Family-key rotation’s exact set is `visibility = 'family'` only. A role change to a non-key role keeps Only me entries and the personal key. Only membership delete removes them.
* Storage INSERT: writer, and the entry id in the path is missing or owned by the uploader. Orphan cleanup deletes vault objects older than one hour with no entry.
* Leave / Remove copy warns that Only me entries will be deleted, with no counts or titles.

## D35. Weekly Family Sync slice 1 and Home Today layout (25 October 2026)

GOV02 slice 1. Sync agenda and notes use the **Standard** tier (same idea as photos, D29): private Postgres, encrypted in transit and at rest, **not** wrapped to the family key. Circle rules are enforced by RLS (`can_view_sync` on the meeting’s circle), so a later slice can build the agenda from calendars and tasks on the server.

* Tabs: Home, Memories, **Sync**, Vault, Family.
* One schedule per family (weekday, local time, IANA time zone, Household or Extended Family circle). Admins write; circle members read.
* Each `sync_meetings` row stores its own `circle_id` at creation. RLS for meetings, agenda, notes and tasks uses that meeting’s circle, never the current schedule’s circle. Switching the schedule to a wider circle never exposes past meetings. Undiscussed items carry over only when the next meeting’s circle is the same or narrower; otherwise they stay on the old meeting.
* `ensure_next_meeting` is an idempotent SECURITY DEFINER call with a unique `(family_space_id, scheduled_for)` so two phones cannot create duplicates. Changing day or time moves the upcoming meeting’s `scheduled_for` (agenda stays). Starting a meeting is compare-and-swap `upcoming` → `in_progress`; at most one in progress per family; others see a read-only “running on …” state.
* Countdown (family time zone): TONIGHT if today and start ≥ 17:00; TODAY if today and earlier; TOMORROW; else IN N DAYS.
* Attributed children must belong to the same family. Former members show as **A former family member**. Admins may edit notes after Finish. On this day uses the family time zone.
* No Fair Share, no auto agenda, no push, no guilt when a meeting is missed.
* Home Today layout (same slice, after Sync): Sync hero card; On this day inside Memories; This week tasks. The Needs-you and reminder behaviour is D36.

## D36. Home v2 (27 October 2026)

Home is rebuilt to the Today design. D32 tokens stay frozen; this decision adds shared UI pieces and product behaviour only.

* **ButtonStack:** stacked full-width buttons share one vertical gap (`space.sm` by default). Prefer it over ad-hoc margins on Vault, Sync, Memories and voice actions.
* **Urgent items leave Home:** Home starts at the greeting. A Needs you bell (badge count) opens a ranked list that only navigates — recovery to Privacy and Security, device notices to Family (Let in unchanged), Sync / overdue tasks, and failed Memories uploads when they exist. Keys and recovery status pills stay on Family (and on Privacy and Security for recovery setup).
* **Recovery reminder once per sign-in:** after sign-in, if the person is a key holder and recovery still needs setup (or a printed code), a bottom sheet offers Set it up now / Remind me later. Showing it writes a non-sensitive AsyncStorage marker `patria.recoveryReminder.shown.<userId>` = `1` (no tokens, keys or names). A cold start with the same session does not show the sheet again. Sign out clears the marker so the next sign-in can offer it. The Needs you bell still lists recovery the whole time.
* **Card tone rhythm:** Home body cards use `Card` `tone` — `hero` (green + mustard CTA) for Sync and Vault, `surface` (white + green CTA) for This week and Memories, `warm` (sand + mustard CTA) for the voice card. Tone sets box, text and default button together through context.
* **Empty, locked and permission states:** every Home card has a calm empty, loading, error, locked (no Vault key yet) or ask-admin path. No dead buttons for actions the role cannot take.
* **Memory-only Home peeks:** the voice and Vault cards decrypt at most ten recent sealed rows in memory to show title, date and visibility only. Nothing from those peeks is written to AsyncStorage or SecureStore. A locked phone shows a calm locked state instead.
* **Side drawer:** Open menu slides a drawer from the right (name, family, close, group dividers, pinned version and Sign out). Sign out uses an in-drawer confirmation (Cancel / Sign out), not a system alert, so it stays reachable and testable. Shared `Pressable` swallows a fast second tap so double-tap Settings opens Appearance once.
* **Icon map:** `Icon` only draws strokes from its local Lucide path map (same idea as the tab bar). New icons (menu, bell, x, and any later ones) must be added to that map or they render as empty circles.
