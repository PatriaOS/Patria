# Patria build log


Dated record of what we implemented and **why** we chose each option. Short rules that other docs must follow live in `DECISIONS.md`. This file is the narrative.

How to add an entry: newest at the top, date, slice or topic, what changed, options considered, why we picked one, and what we deliberately deferred.

---

## 2026-10-27 — Home card tones + waiting keys on Home

Card `tone` (hero / surface / warm) sets box, text and default CTA together via context — Sync and Vault hero+mustard, This week and Memories surface+green, voice warm+mustard. Restored calm keys-waiting status on Home (attention-only SecurityStatusCard) so Test 2 still sees “Waiting for a family admin…”. Sign-in: brief optional reminder dismiss before the form (Modal hid Home and blocked sign-out) and again after sign-in with a short timeout so waiting phones are not stuck.

---

## 2026-10-27 — Home header icons + reminder Maestro visibility

Bell and menu were empty circles: `Icon` only draws paths from its local SVG map (same as the tab bar), and Menu/Bell/X were never added, so the SVG had no strokes. Added Lucide menu/bell/x paths; transparent 44 pt hits; badge on the bell’s top-right. This week “Add to agenda” uses primary green (mustard stays on Sync only). Sign-in reminder Modal covers Home so Maestro never saw `id: home` — shared sign_in waits for the reminder, dismisses it, then asserts Home; test 45 waits for the sheet itself.

---

## 2026-10-26 — Needs you off Home (bell, reminder, Privacy and Security)

Urgent items leave Home. Home starts at the greeting; a Needs you bell (badge count, 9+) opens a ranked list that only navigates (recovery → Privacy and Security, devices → Family with Let in unchanged, Sync / overdue tasks, Memories only when failed uploads already exist — none yet). Sign-in shows a one-shot in-memory recovery reminder (Set it up now / Remind me later); shared Maestro sign_in taps later when present. Drawer: Privacy and Security is real (Recovery section), group dividers, pinned version + close. Soft-surface chips behind bell and menu so they read under the avatars. Phone tests 9/11/42–44 updated; 45 added. No RLS or hosted push.

---

## 2026-10-26 — Home v2 + ButtonStack

Home is rebuilt to the Figma Today order: Needs attention (≤2 + See all), greeting with Open menu, then Sync / This week / voice / Memories / Vault. On this day stays as a line inside Memories. Family name gets “The ” only when missing, casing preserved. Voice and Vault peeks decrypt at most ten recent sealed rows in memory only (no has_audio column, no AsyncStorage/SecureStore for titles); locked phones show a calm state. Drawer uses the shared Pressable (300 ms re-entry) so a double tap opens one screen. Shared `ButtonStack` spaces stacked Vault / Sync / Memories / voice actions with `space.sm`. Phone tests 42–44.

---

## 2026-10-26 — Sync 38 step 7 missed a11y exact match

PHASE=missed already showed the no-guilt copy and Hold it now; Maestro failed because assertVisible used a prefix of missedNoGuilt and iOS matches a11y text exactly. Flow now asserts `sync-missed`, the full copy string, and that Hold it now opens Wins. Seed SQL that pushes upcoming `scheduled_for` into the past was already correct.

---

## 2026-10-26 — Sync 38: task save race; next meeting after finish

Phone test 38 still failed at e2e step 1 (whole PHASE=run). Continue did open Wins; the miss was wrap-up: Maestro waited for "Pack kit bags" while it was still the task field text, then Finish ran with no insert (empty Tasks). Flow now clears the field before asserting the saved row; Add defaults the owner and uses an op lock so Finish cannot race. finish/ensure_next no longer treat a finished meeting’s scheduled_for as the next upcoming (client passes after the finished slot; SQL skips finished conflicts and advances a week).

---

## 2026-10-26 — Sync 37 step 4 a11y body; 38 hideKeyboard

37 see_member_win: Park picnic was on Test 1's meeting after refresh; Maestro failed on "Added by Test 2" because the row's title-only accessibilityLabel hid the body. Agenda rows now expose title (button), body, and kind as separate a11y nodes. Sync hub also refetches on focus and pull. 38 alone: Continue did open Wins and reached wrap-up; Maestro failed on hideKeyboard with the task field focused — dismiss by tapping Owner instead.

---

## 2026-10-26 — Sync 37/38: agenda a11y label, task wait, seed isolation

Third fail of 37/38: hub showed "Soccer carpool" but Maestro asserted against a11y text "Soccer carpool, Discuss" (full-string match). Agenda rows now label the title only. Test 38 finished with an empty Tasks list — flow now waits for "Pack kit bags" on wrap-up before Finish, clears the task field, and the wrap-up owner defaults to the current member. e2e-setup resets all Sync tables per test and seeds `nextMeetingAt` (Sunday 19:00 Chicago) so ensureNextMeeting does not create a second upcoming meeting when 36–42 run in any order.

---

## 2026-10-26 — Forbid crypto.randomUUID; Sync write-path pgTAP

`crypto.randomUUID` broke vault then Sync on Hermes. Cleared remaining call sites (including api tests) in favour of `randomUuid()` / `randomKey32()`, and ESLint `no-restricted-syntax` now errors on `crypto.randomUUID` / `globalThis.crypto.randomUUID`. GOV02 DB tests gained `lives_ok` inserts for member agenda, admin notes and tasks (plus note update and outsider write denials) so a shared-trigger regression cannot hide behind outsider-only checks.

---

## 2026-10-26 — Sync e2e 37/38/39/42: guard trigger, owners, seed role

Rerun of 36–42: agenda save and Sync tasks/notes failed on device. Root cause for notes and tasks was the shared `trg_sync_guard_family_links` reading `NEW.attributed_child_id` on every table — Postgres raises 42703 on `sync_notes` / `sync_tasks` even when the `TG_TABLE_NAME` check is false. Nested IFs only; RLS `can_view_sync` for circle members was already correct. Agenda/task client IDs now use `randomUuid()` (same as vault). Run Sync requires an owner before insert (DB xor + phone test 38); Maestro picks `owner-test-1`. Test 42 On this day seed used `m.role = 'admin'`; space_role is `family_admin`. Follow-along pull-to-refresh refetches notes immediately.

---

## 2026-10-25 — Sync e2e failures: app a11y, reporter, second phone

Maestro 36–42 failures on device: Tonight's flow step titles were swallowed by a parent `accessible` node (`1. Wins` only), the hub **Add to the agenda** button overrode its label-derived id with `add-to-agenda`, and Past meetings kept **Summary** in one concatenated string so `assertVisible: "Summary"` could not match. Fixed those in the app; 38 dismisses the keyboard by tapping a static label; 42 cancels Add before tapping Home. Runner now fails the step that broke and marks later PHONE_TESTS steps **not reached**. Device B covers Test 2 Sync steps; SQL seeds cover missed meetings, no-schedule Home, and On this day.

---

## 2026-10-25 — e2e runners for Sync + coverage guards

Phone tests 36–42 had Maestro YAML but no `e2e.mjs` runners, so `e2e:affected` reported PASSED after `clear_state` only. Wired runners and e2e-setup seeds (schedule / agenda / finished meeting). `e2e.mjs` now fails any selected non-manual test without a runner; `e2e:check` and a Jest test require every phone test to have both a flow and a runner (or be marked manual). Test 27 was missing from affected summaries because its Areas line was only `vault` while sibling LEG01 tests also list `keys` — when the diff hit keys/recovery/rotation without vault files, 26 and 28–35 matched and 27 did not. Added `keys` to test 27. Test 11 step 8 timed out twice: the failure screenshot showed Test 1’s accept card on screen, and the log stopped mid-swipe — spawnSync hit the 10 minute budget after many sign-ins, not a missed tap. Raised test 11 to 15 minutes and dropped redundant sign-ins in step 8. Docs: PRD/FEATURES version 1.4 notes for BRN02 email notifications + Add to agenda, and GOV02 next-slice frequency and invites.

---

## 2026-10-25 — GOV02 Home Figma polish (D35)

Home Today was brought closer to Figma: On this day uses an 88pt thumbnail (signed URL, or a clean soft placeholder); the Sync overline always uses `nextMeetingAt` with the real clock and family zone (Sunday before start → TONIGHT/TODAY, after → IN 7 DAYS); greeting is “Good evening,” plus “the Rivera family”; Sync body is a sentence with side-by-side compact buttons; This week uses first names and round checkboxes; AvatarStack is 32pt with an 8pt overlap, soft pastels in dark mode, and initials that do not clip. Tab screens drop the extra top padding band. Keys and recovery attention pills stay on Home when action is needed; full status lives on Family.

---

## 2026-10-25 — GOV02 Home Today redesign (D35)

Home now reads top to bottom: security notices (only when something needs a tap), date and greeting with the avatars opening Family, the Family Sync hero, On this day, and This week. The Sync card reuses `useSyncSpace` and `syncCountdown`; with no meeting row yet it falls back to the next date computed from the schedule so the countdown still shows. On this day is judged in the family time zone (device zone if there is no schedule) from the same circle-limited memory read the library uses, so nothing outside a person's circles can appear; it picks the oldest matching year. This week shows up to four open tasks, then fills spare room with tasks finished today or yesterday so a ticked task does not vanish. Keys and recovery status pills moved to Family under Your phones. Options: remove the pills from Home entirely, or keep only the ones that ask for something. We kept Home pills only for keys that are not ready (waiting, needs let-in) and Recovery needs attention, because Maestro tests 9, 11, 12 and 13 and the "I lost my phone" path depend on seeing them, and a calm all-good status adds nothing. The "Set up recovery" card, device-approval cards and recovery notices stay on Home unchanged. Deferred: Feb 29 memories on non-leap years, a Home pull-to-refresh test for Sync, and running Maestro test 42 on a phone.

---

## 2026-10-25 — GOV02 slice 1: Weekly Family Sync (D35), Sync first

Families needed a quiet weekly meeting without vault crypto or guilt. Slice 1 stores Sync on the Standard tier (D29-style) so later server-built agendas stay possible. Each meeting freezes its circle at creation so widening the schedule never leaks past Household meetings; carry-over only when the next circle is the same or narrower. `ensure_next_meeting` is idempotent; start is compare-and-swap with one in-progress meeting. Home Today redesign waits until Sync screens are approved. No hosted push in this stop. Fair Share, auto agenda, push and printable/TV wait.

---

## 2026-10-24 — LEG01 slice 2: voice notes and Only me (D34)

Text decisions could not yet hold a voice or stay with the author only. Slice 2 adds in-app voice notes (AAC mono, 5-minute stop, per-file key, private `vault` bucket) and Only me entries under a personal key minted once by `create_personal_key`. Follow-ups inherit parent visibility; a parent switch re-wraps children in one call. Family-key rotation ignores private rows. A role change keeps Only me; leaving deletes it. Playback uses a cache file wiped on leave and on app start.

The first voice save stayed on the form because `upload(..., { upsert: true })` needs an UPDATE policy, and the vault bucket correctly has none. The phone inserts once with `upsert: false`, and every save remints a fresh audio id so a half-finished earlier object is never treated as good (orphans go to hourly cleanup). Visibility switches always go through `commit_vault_visibility_switch` (even with no follow-ups) so `patria.vault_switch` is set. A failed save shows Try again, keeps the draft, and deletes the new upload when it can. Local phone tests 26–35, 10, 13 and smoke passed. No hosted schema push in this slice.

---

## 2026-10-24 — MEM01 slice 2 and LEG01 slice 1 done on a real iPhone

Tests 18, 19 and 26 to 30 passed on a real iPhone (Expo Go, hosted). MEM01 slice 2 is done: pick many items, share a short video, and connect the iOS photo library while Patria is open. Tests 20–23 stay as written. Camera, Limited access, Family faces only, and upload while Patria is closed stay later. LEG01 slice 1 is done: type a decision, teen read-only, follow-up, recovery first, still readable after the family key rotates. Voice, AI, video and sealing wait.

---

## 2026-10-23 — Shared Pressable so first taps land

Turn on sharing, circle chips, Pause, and Vault Save all needed a later layout change (a Switch, a permission sheet, or a navigation) before a tap fired. That was not screen-specific. React Native 0.88 Pressable writes `disabled` onto native `enabled`. After a true → false flip the host can stay enabled=false (treated as box-none) until something else invalidates layout — the same class as RN #56777.

The first shared wrapper used Gesture Handler and still passed native `disabled`. That made Ask these people and Save hittable after enable, but Gesture Handler can fire `onPress` twice (a recovery row would select then unselect) and can drop the first tab tap after Maestro `addMedia`. Tabs never set `disabled`, so the inactive guard was not why test 18 missed Memories.

`src/ui/Pressable` is React Native Pressable again. It never sets native `disabled` (the wrapper no-ops while inactive), always attaches `onPress`, and ignores a second press within 300ms. Circle chips still use Gesture Handler so a tap after the Photos permission sheet selects.

---

## 2026-10-23 — Connect photos setup is numbered steps

A real iPhone recording showed Connect my photos never starting a sync because Who will see them was easy to miss and Turn on sharing felt dead until Use cellular data was toggled. No circle is preselected (still correct). The settings screen is now four numbered sections. Family faces only is Coming later, not a third mode chip. Full access shows “Photo access: Full” and hides Open Settings; Limited and Denied keep Settings.

The cellular toggle did not gate the button in code. `disabled={!circleId}` left the Pressable un-hittable after a circle was chosen until the Switch forced a layout. Turn on sharing stays pressable; without a circle it scrolls to step 2 and says “Choose who will see these photos”. Sharing still cannot start without a circle. Circle chips use Gesture Handler so a tap after the permission sheet actually selects. After Turn on sharing, Memories shows the status pill and runs a sync. Pause updates the pill immediately and cancels an in-flight sync so “Sharing N” cannot hide Paused.

---

## 2026-10-23 — SDK 58 follow-up: tab switch after addMedia, library date stamp

Test 18 stayed on Home after Maestro `addMedia` because the custom tab bar used `router.navigate`. That tap completed and the tab bar looked fine — no Photos alert, no crash — but the tab did not switch until later. Tab switches now use Expo Router 58’s `navigateToTab(route.key)`. The flow also waits for the UI to settle after seeding the gallery.

Test 19’s Simulator photo was still dated 19 October. `expo-media-library` 58 did not change listing, `creationTime` (still ms), the change listener, or permissions. The app shares a photo when Photos `creationDate` is today. `copyFileSync` plus `utimes` keeps the old birthtime; iOS 26.5 `addmedia` uses that as `creationDate`. The stamp now writes a fresh file.

---

## 2026-10-22 — Expo SDK 58

Expo Go on the store is SDK 58 only, so Patria had to leave SDK 57. We installed `expo@^58` and aligned the rest with `expo install --fix`. Noble and scure stay at 2.4.0. Node in CI is 22.13, the SDK 58 minimum; the pinned Supabase CLI is unchanged. The database does not change.

Security paths we checked and left as they were: keys and drafts still use `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (same keychain item, so stored family keys remain readable); video pick still uses `VideoExportPreset.MediumQuality` and still fails closed on the location scan; `randomBytes` / `randomUuid` still fill from `expo-crypto` `getRandomValues`.

What we had to change so types and tests match the new SDK, without changing what a person sees: drop `initialRouteName` on `Stack` (it already lives in `unstable_settings`); tab switches use `useRouter` hrefs; text field refs use `TextInputInstance`; Jest helpers await RNTL 14’s async `render` / `fireEvent`; web output is pinned to `static` so we do not inherit the new server default. Gesture Handler 3 is installed; we only wrap the app in `GestureHandlerRootView`, so we did not migrate to the hook gesture API.

---

## 2026-10-19 — LEG01 slice 1: encrypted text decisions (D33)

Vault is a real Decision Ledger, not a coming-next tab. Each decision is a client UUID row: JSON (title, why, for) padded to 1 KB, encrypted with a 32-byte CEK, CEK wrapped to the current family key. Nonces are 24 bytes; wrapped CEK is 48. Writers are admin / co-admin / elder with a current wrap and recovery (two accepted contacts plus a recovery public key). Teens read. Only the author edits or deletes. Follow-ups are child rows. A former member’s name becomes “A former family member”. Drafts use a SecureStore key plus an encrypted file, wiped on Save or Discard.

We considered keeping the old family key on the phone until a later re-wrap. That would leave other admins unable to read after rotation. Instead `rotate_family_key` takes every current-epoch CEK re-wrap in the same call as device wraps and recovery seals, checks the exact set, and commits with compare-and-swap. A missing row (saved during the call) refuses; the phone retries. Large vaults may need batching later. Voice, AI, video and sealing wait. Migrations are not pushed to the hosted project.

---

## 2026-10-18 — Design foundation Layer 3: restyle screens, Home mockup, D32

Remaining screens now use `src/ui` and theme tokens, including auth, invite, add child, members, memories, keys, recovery and leave family. Home matches HOME-01: terracotta date, time-of-day greeting plus italic family name, themed cards and pills, recent memories, Vault coming next. Cards never use the light cream surface in dark. Cormorant uses lining numerals. Vault’s tab is a lock. D32 and the patria.mdc `src/ui` rule are in place. TestIDs and security wording are unchanged.

---

## 2026-10-18 — Design foundation Layer 2: tabs, Appearance, themed chrome

Home, Memories, Vault and Family are Expo Router tabs. Family holds invite, members, phones, sign out and Appearance. The Home tab shows a terracotta notice dot from the same let-in, new phone and recovery data Home already loads. Screen no longer doubles the top inset under a header, and headers, tabs and the status bar follow light and dark. Maestro reaches the moved buttons through the Family tab.

---

## 2026-10-18 — Design foundation Layer 1: tokens, type, components

D32 Layer 1 only: Hearth palettes, Heirloom type, `ThemeProvider`, font splash with a 4s system-font fallback, and the `src/ui` kit (including TabBar’s notice-dot API). Appearance is stored in expo-secure-store. Existing screens are unchanged so behaviour and Maestro stay put. Light terracotta is `#A84C2A` so overlines meet 4.5:1 on linen. Tabs, Appearance, and restyling screens wait for later layers.

---

## 2026-10-18 — Add photos names the video limit before the picker

A 6 minute, 1.9 GB clip spent minutes in iOS “preparing” before Patria could refuse it. We do not change Medium export or the location scan. Add photos now shows “Videos up to 1 minute and 50 MB” before the picker opens and keeps that line on the share screen. `allowsEditing` stays off so people can still pick many items. A custom Photos picker that reads duration and size first, then runs the same Medium export and scan only on keepers, waits for the development build stage.

---

## 2026-10-18 — Video tiles use a real frame; over-limit clips are refused before Share

A shared video showed a blurry stretched speck because the thumb was a 16×16 JPEG. We now grab a frame with `expo-video-thumbnails` (about 1 second in), re-encode it as JPEG, and overlay play plus length on the tile. If the frame fails, we store a full-size matte. Length and picker file size are checked as soon as the picker returns, so a huge clip is named and dropped before Share; the other picked items stay. Medium export and the location scan are unchanged. No database change.

---

## 2026-10-18 — Picker duration is always milliseconds

A 3 second clip on a real iPhone was refused as longer than a minute, and a 14 second clip in a mixed pick vanished with no message. `expo-image-picker` documents `asset.duration` in milliseconds on iOS and Android; we compared it to 60 as if it were seconds. The helper always divides by 1000 (no unit guess) for the limit, `duration_seconds`, and the tile. Missing or zero duration is refused kindly. A mixed pick stays on the add screen and names the skip. The gated e2e sample now uses the picker shape (`duration: 2000`). Library sync is photos only, so it had no duration unit bug. No database change.

---

## 2026-10-17 — MEM01 slice 2: many items, short video, connect library

Slice 1 stayed pick-and-share. Slice 2 lets someone pick up to 30 items, share a short video after a Medium export with a fail-closed location scan, and connect their iOS photo library while Patria is open (WiFi by default, From today or last 30 days, owner-only RLS). Album choices stay on the phone. A per-user HMAC key, readable only by that user, dedupes picker and sync. Deleted sync items stay gone via tombstones. Videos from the library and background upload wait. Hosted migrations wait until asked.

---

## 2026-10-17 — MEM01 slice 1 done on a real iPhone

Tests 14, 15 and 16 passed on a real iPhone (Expo Go, hosted test project) after D30 was pushed. Slice 1 of Shared Family Library is done: pick and share photos into a circle, see them in the library, move or delete your own. Test 17 step 2 (removed member’s phone after refresh) is still pending by hand. Later MEM01 work stays later: auto-upload, sharing modes, video, Private Memories.

---

## 2026-10-16 — D30 default circle membership

A Family admin on a real phone only saw Household and Only Me in the Memories picker. `create_family_space` made all four circles but only put the creator in Household and Only Me. `accept_invite` only used the invite’s default circle. The e2e seed then POSTed Test 1 into Extended Family, so automated tests never saw the gap. D30 now applies membership in the database (family create, invite accept, role change, child insert) and backfills existing families. Close Friends stays empty, so it still does not appear in the picker until an admin adds someone. e2e setup no longer writes `circle_members` itself. Hosted backfill waits until we are asked to push.

---

## 2026-10-16 — MEM01 slice 1: Shared Family Library (Standard tier)

Photos are picked on purpose (expo-image-picker; that pick is consent), resized and re-encoded as JPEG on the phone so EXIF/GPS is gone, date taken kept, then uploaded to a private `memories` bucket. Cloud storage is Standard tier (D29): TLS and at-rest encryption, not the family key. One helper, `can_view_memory`, gates both the row and the file. Rows start as `uploading` (uploader only) and become visible as `ready`. Table SELECT uses the new row’s columns so `INSERT … RETURNING` can succeed (a nested `SELECT` of that row cannot see it yet). Files are deleted through Storage first, then the row. Confirm a move only when the new circle includes someone who is not in the current one. Caregivers and successors have no Memories access. Phone tests 14–17; Maestro Add photos uses bundled samples only when `EXPO_PUBLIC_E2E=1` (Metro stubs that module otherwise, and startup fails if samples can load). The real system picker is a manual step. Private Memories, auto-upload, video and Stories stay later. Hosted migrations are not applied until asked.

---

## 2026-10-16 — Narrow public keys for recovery wrapping

An Elder finishing recovery set up had to call `approved_devices_for_member` (admin-only) to wrap holder secrets to a contact’s phones. `recovery_contact_public_keys` returns only `device_id` and the X25519 public key, and only after that person has accepted as the caller’s contact. `recovery_request_device_public_key` does the same for the new phone when a contact helps after the wait. Rotation still uses admin-only `rotation_wrap_targets`. Your phones only reads the caller’s own device rows. Test 11 now has Test 2 (Elder) choose Test 1.

---

## 2026-10-15 — Phone tests 12 and 13: remaining steps stay manual

After the eligible-contacts picker, Test 12 seed can choose Test 1. The start/cancel/approve/printed-code/remove-old steps still miss Maestro copy or lose the recover screen on relaunch. Test 13 Remove still rotates the key, but the Updating copy is often missed; Leave family depends on inviting Test 3 back, which is not stable. Those steps are marked (manual, pending automation) so `e2e:check` and `e2e:full` can pass.

---

## 2026-10-16 — Eligible recovery contacts without listing wraps

The picker used `approved_devices_for_member` for every member, so an Elder either saw nobody (RPC denied) or, after a widen, could list other people’s device keys. `eligible_recovery_contacts` now returns only user id and display name for adult key holders with a let-in device, excluding the caller. `approved_devices_for_member` is self-or-admin again. Caregivers get an empty list. The picker waits for that list instead of treating a failed load as “nobody is let in.”

---

## 2026-10-15 — Test 13 keeps Test 2 on device B; Test 12 recovers Test 2

Test 13 step 3 showed Create family on device B because seed let Test 3 in on that phone last, then recovery accept signed Test 3 in again. After Remove, B was Test 3 with no family. Seed now signs Test 2 back in on B before the steps, and a member sign-in wait no longer treats Create family as Home. Test 12 seeds Test 2’s own recovery (contacts Test 1 and Test 3) on the old phone, copies the printed words to the new simulator pasteboard without logging them, and starts recovery from **I lost my phone** rather than the old “Waiting for” string. Phone-test time starts after seed so Test 13’s steps still get ten minutes.

---

## 2026-10-15 — Removed member: server is empty; the device must refetch

After a confirmed Remove, the `space_members` row is gone and the removed person’s JWT cannot read that family, its members, or its wraps (pgTAP plus the rotate API test). The leftover local database that still listed Test 3 as a member was not a failed Remove: Maestro had been tapping the in-page **Remove from this family** button (same label as the alert title), so the confirm never ran; later runs reseeding Test 3 as an Elder made the row look like a leftover. Home now always refetches memberships on mount, on foreground, and after a failed members load, and it drops `spaceId` when memberships come back empty so a removed person sees the family disappear without signing out. Test 13 seeds recovery before Remove, invites Test 3 back onto their own member row for **Leave family**, and waits after a role change. Test 12 is allowed 20 minutes; other phone tests stay at 10.

---

## 2026-10-15 — Rotate immediately after Remove, then say so on Home

Local E2E Family after the last Test 13 run was still epoch 1, Test 3 still a member with a wrap, and `rotation_needed` false — the admin phone had not rotated. Confirming **Remove from this family** now flags Home as updating, navigates back, and the admin phone calls `rotateFamilyKeyIfNeeded` right away (retry once if the first pass is idle). Home keeps **Updating the family key** then **The family key is up to date** even if a later idle pass runs. Test 12 seeds the same let-in Elders as Test 11 plus a printed code; a new phone that is not let in uses `screen-waiting-own-phone`. If Maestro’s XCTest driver drops, the runner restarts it and retries that test once.

---

## 2026-10-14 — Your phones, printed code, Remove alert, e2e LogBox

Home already had **Your phones** (below the fold) and **Write down a printed code** (after two recovery contacts accept, near the top, also on Recovery contacts). Flows now scroll to those testIDs (`your-phones`, `create-printed-code`, `remove-phone`). Test 11 seeds Test 3 as a let-in Elder so the printed-code step is actually on screen. Removing a member taps the native alert confirm **Remove from this family**. E2E only: `EXPO_PUBLIC_E2E=1` calls `LogBox.ignoreAllLogs` so yellow banners cannot cover buttons. `clearKeychain` stays on the simulator `clear_state` subflow. After a successful remove, Home still often never shows “Updating the family key” / “The family key is up to date” (app bug; rotation may still happen in the background).

---

## 2026-10-14 — Sign in stays usable with the keyboard open

Sign in and Create account lift with `KeyboardAvoidingView` so the main button stays reachable on small phones. The password field’s keyboard key is **Go** and submits the form (`returnKeyType` + `onSubmitEditing`); iOS AutoFill stays on (`textContentType` password / newPassword). Phone tests identify Welcome / Sign in / Create account by `screen-welcome`, `screen-sign-in` and `screen-sign-up`, leave Create account if a device lands there, and submit with `pressKey: Enter`. Each test starts by `launchApp` with `clearState` and `clearKeychain` on every simulator it will use (SecureStore sessions live in the keychain, so `clearState` alone left Test 1 signed in on device B). It never clears again mid-test so family keys created during the run survive.

---

## 2026-10-14 — Phone test sizes, Open sheet, invite/child testIDs

Sign-in uses `launchApp` only (no `simctl openurl`); a shared subflow taps **Open** if the iOS “Open in patria-app?” sheet still appears. After the password field, the form taps **Sign in** without `hideKeyboard` (device B’s Passwords keyboard has no dismiss). Invalid invite copy, the child-row subtitle, and the let-in notice have testIDs so Maestro can match “no longer valid”, “Kid profile” / “no email”, and “wants this phone let in” with a contains regex. Invite from Home scrolls to the button when recovery and let-in cards push it below the fold. Phone tests list `Areas:`; `e2e:smoke` runs 1, 3 and 8, `e2e:affected` diffs against main and picks tests by area plus new tests, `e2e:full` is the whole suite.

---

## 2026-10-14 — Phone tests: every simulator, let-in seed, Invite keyboard

`e2e:build` now installs `app.patria.dev` on every simulator the run will use (A, B, and C when `E2E_DEVICES=3`). The runner checks install before starting. Tests 11 and 13 still seed membership through `invites` insert and `accept_invite`; let-in wraps cannot be invented on the server (they are sealed to the phone’s device key), so the runner then opens Home as Test 1 and lets Test 2/3 in through the same app path as test 9. Test 5 scrolls to Sign out. Test 6 asserts Lily as a kid profile with no email address, not the phrase “No email needed”. Invite create hides the keyboard and waits for the real created copy; the earlier failure showed the form still open with the keyboard covering the lower half and a garbled `…comg` email, not a database error.

---

## 2026-10-14 — Phone tests seed a family before Home

Maestro was failing on Create family after sign-in because setup only created users. Each test now reseeds through `create_family_space` (and invite/accept when a member is needed) so Test 1 starts as admin of E2E Family. Sign-in waits on a Home testID. The runner prints progress, caps each test at 10 minutes, starts Metro in the background, and posts a Mac notification when it finishes.

---

## 2026-10-13 — Metro must not bundle env files

`.env.e2e.local` is not JavaScript. Metro was parsing its `#` comment as source. Nothing in `app/` or `src/` imports env files; `e2e:build` now parses the file itself, passes only `EXPO_PUBLIC_` values, sets `EXPO_NO_DOTENV=1`, and refuses to build if an env file shows up in the app import graph. Metro also block-lists `.env*`. `npx expo start` still uses `.env` and the hosted test project.

---

## 2026-10-13 — Leave family, create another family, rotation status

Leave family lives on your own member row with Cancel as the default and a destructive confirm. Leaving deletes this phone’s cached family key for that space and keeps the device key pair. Create another family sits next to Join another family and reuses the existing create screen. Admin phones show Updating the family key, then a short confirmation; a lost rotation race is treated as already up to date. Self-leave cleanup matches admin removal in pgTAP.

---

## 2026-10-13 — Maestro phone tests from PHONE_TESTS.md

Phone tests 1–13 now have Maestro flows under `patria-app/.maestro/`. Local Docker Supabase only: `e2e-setup` and `e2e-db-check` refuse any URL that is not `127.0.0.1` or `localhost`. The service role key stays in gitignored files and is never in the app env. Default is two simulators; `E2E_DEVICES=3` runs all of test 12 at once. Share-sheet Copy is tried then marked manual if the sheet is not automatable. `npm run e2e:check` fails when a numbered test has no flow (unless the heading is marked manual) or a flow points at a missing test. Production App Store bundle id is still open (D28). Jest and pgTAP are unchanged.

---

## 2026-10-13 — Rotate the family key when a key holder leaves (CIR05 Step 8)

When an admin, co-admin, teen, or elder leaves or is moved off a key-holding role, remaining approved phones get a new family-key epoch. The rotating admin seals that key to remaining members’ recovery public keys with the existing wrap module (D27). A removed recovery contact cannot approve; the people who named them keep remaining contact plus paper until they redo, which deletes the old recovery public key and its sealed boxes. Caregivers, extended relatives, successors, and children do not trigger rotation. Home is never blocked. Human security review still required on the crypto files.

---

## 2026-10-13 — Per-member recovery key pairs (D27)

One family-wide recovery secret would let a removed admin, anyone who had recovered, or two contacts of any member open every future sealed family-key box. D27 gives each key-holding member an X25519 recovery pair: public half on the server, private half only in that member’s 2-of-3 boxes, wiped after use. Docs (PRD, FEATURES CIR05 and Letters to the Future, KEYS 4d/4e) now match. Stolen-phone rotation with no membership change stays an open question.

---

## 2026-10-12 — Recover after losing every phone (KEYS.md 4d)

A signed-in member starts recovery on a new phone. The server stamps a 48-hour wait (D23; KEYS asked as D20) and a 7-day expiry after `not_before`. Keys stay on the phone (D20; KEYS asked as D17). Contacts confirm in person, then after the wait rewrap a holder secret to the new device. Any two of contact A, contact B, and the printed code reconstruct `recovery_key` on that phone, which opens the current epoch’s family-key box. Complete records the new wrap and does not revoke old devices: the server cannot tell that the new phone really unwrapped the family key, so auto-revoke would let a password plus one colluding contact wipe the owner’s phones. After a local unwrap, the new phone offers “Remove your old phones” through the existing remove-device RPC, which notifies admins. Cancel is the requester’s devices or a family admin, never a contact; we record who cancelled. One open request per user per family. If the recovering member is a family admin, that phone also wraps the recovery key to itself so they can keep helping with recovery. Paper is typed only on the new phone and never stored. Human security review still required on the crypto files.

---

## 2026-10-12 — Recovery contacts and printed code (Step 6)

Admins set up two recovery contacts from adult members who already have a wrap (D26). Contacts accept on Home; the admin phone then wraps a holder secret to that person’s approved devices and rebuilds pairwise boxes over the recovery key. The optional 24-word printed code is shown once and checked locally; nothing about it is stored on the server. Changing a contact or reporting the code lost rotates the recovery key. Home is never blocked. The 48-hour recovery flow is Step 7.

---

## 2026-10-12 — Extra phones are let in only by the same member (Step 5)

A second phone for someone who already has a wrap uploads its public key and waits for that person’s existing phone. That phone shows “Is this your new phone?” and wraps with the KEYS.md AAD. Admins see that a new phone was added and cannot wrap it. “This wasn’t me” rejects that device forever and tells admins the member may want to change their password. Your phones lists this account’s devices and removes another device through a SECURITY DEFINER function. Stolen-phone key rotation stays in Step 8.

---

## 2026-10-12 — Let in could not find the family key after SecureStore namespacing

Step 4 stored device and family keys under `patria.u.{userId}.*`. Phones that created keys in Step 3 still had `patria.device.*` and `patria.familyKey.{space}`. Let in looked only at the new names, minted a new device, and threw `missing family key` while Home still said keys were set up. We migrate those old entries to the signed-in user once, then load the family key from memory, the namespaced cache, or this device’s wrap. Home says “set up” only when that load succeeds.

---

## 2026-10-12 — Let in failed without a database code; notices needed a remount

The Let in error was logged as `unknown` because Home swallowed the caught error. Local REST showed admin wrap-insert is allowed and PostgREST returns bytea as `\x` hex; a JSON-cloned public key is not a Uint8Array and wrapping then throws `invalid length`. One helper now decodes every bytea form and checks 32-byte public keys. Home invalidates notices on open, foreground and pull to refresh (D10). Failed approvals log the error class or database code, never key bytes.

---

## 2026-10-12 — Home join-family test was paying first-render cost

Linux Docker (Node 22) showed the wait is `render(<HomeScreen />)`, not `findBy` and not a case-mismatched mock. A View warmup is not enough: the first HomeScreen tree takes ~1.7s on 2 CPUs and ~13s when the CPU is constrained, which is how GitHub blows Jest’s 5s test budget before `findBy` runs. That first mount now happens while the describe block is collected, which has no test timeout. `npm run test:linux` runs the CI app job in Docker.

---

## 2026-10-12 — Home tests mock keys; crypto logs go through devLog

Home screen tests mock the key ceremony and device-access modules so they do not run crypto on mount. Key step logs use the shared `devLog` helper, which is silent in Jest and production and never takes key material.

---

## 2026-10-12 — Admin lets in a member’s first phone (Step 4)

A new member’s phone uploads its public key and one approval notice. An admin taps Let in on Home; that phone wraps the family key to the member device. Decline closes the notice with no wrap. SecureStore entries are namespaced by account so two people on one install cannot read each other’s keys. One shared phone and two separate phones use the same wrap path.

---

## 2026-10-12 — Screen tests share one QueryClient helper

CI was killing two screen tests at Jest’s 5 second limit. Queries were retrying and garbage-collecting with leftover AppState and focus listeners. Screen tests now share a helper that turns retries off, keeps the cache for the test, and clears the client on the way out.

---

## 2026-10-12 — Create family keys on the founding phone (Step 3)

After a family space is created, that admin phone generates the family and recovery keys, wraps them to itself, and writes meta, the device public key, and wraps in one database function. Existing families without keys do the same the next time an admin opens Home. A second ceremony for the same space is rejected; that phone discards its local key and waits.

---

## 2026-10-12 — CIR05 key tables and RLS (Step 2)

Added family key, recovery, and device-approval tables with forced RLS. Wraps are insert-only ciphertext; the 48-hour recovery wait is stamped on the server and stored in `patria_key_settings` so only a superuser can shorten it for local tests. pgTAP covers first-device vs extra-device wrapping, ineligible roles, and isolation.

---

## 2026-10-12 — CIR05 key primitives (Step 1)

Device-side crypto building blocks only: noble X25519 / HKDF-SHA256 / XChaCha20-Poly1305, pairwise recovery boxes over the recovery key, 24-word printed code, SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and Android backup exclude. No tables, no screens. Every crypto file is marked for security review.

---

## 2026-10-12 — Family keys protocol approved (D20–D25)

`docs/security/KEYS.md` is the CIR05 step 2 protocol. Two additions landed with approval: a long-lived `recovery_key` so printed codes survive family-key rotation, and SecureStore that is excluded from cloud backups (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` plus the Android SharedPreferences exclude). Lasting rules are D20–D25 (KEYS approval numbered them D17–D22; those numbers were already taken). Implementation steps are in `docs/security/KEYS_IMPLEMENTATION.md`. No crypto code yet.

---

## 2026-10-11 — Cap text scaling at 1.3 (D19)

Full Dynamic Type is deferred until an accessibility pass before grandparents beta. Until then every Text and TextInput uses a 1.3 multiplier, no pinned line heights, and every screen still scrolls.

---

## 2026-10-11 — Name gate cache, add child RETURNING, Dynamic Type

Your name was asked twice because the gate reused a stale empty profile cache after save; the gate is the only name check and now gets the new name immediately. Add a child failed with Postgres `42501` / “new row violates row-level security policy”: the insert succeeded, but PostgREST `RETURNING` ran `can_view_child`, which re-selected `child_profiles` before the new row was visible. EXECUTE on helpers was still granted to `authenticated`; the Yes-cell tests did not use `RETURNING`, so CI missed it. Admins/teens/elders now see children in their space without that nested select. Dev builds log action error code and message only. Type tokens no longer pin `lineHeight`; screens scroll; titles cap at 2×.

---

## 2026-10-11 — Join another family, sign out, names

Home no longer shows an invite paste box. People already in a family use a small Join another family link (D18; phone notes called this D15, but D15 already names the build log). Create family has Sign out with the same spinner and replace-to-welcome as Home. After sign in, a missing display name is collected on one screen; member cards fall back to “Family member” so we never show a blank name (D17: no emails to non-admins).

---

## 2026-10-11 — Phone Batch C follow-up

Text fields no longer clip descenders. Home pull-to-refresh and foreground refetch actually reload. Headers use real titles and a plain back arrow so route groups never appear. Invalid invites clear the pending token immediately and leave with replace to `/`, with no `beforeRemove` trap.

---

## 2026-10-10 — Local CI database tests pass

New migration keeps profile emails unreadable while restoring `REFERENCES` on `profiles.id` so admins can insert invites. Invite email matching uses a definer helper. pgTAP now names schemas for `has_table`, grants fixture reads, and looks up invite tokens before switching to `authenticated`.

---

## 2026-10-10 — pgTAP fixture role and plan

Granted SELECT on the temp `fx` table to `authenticated` and `anon`, set `plan(127)`, and kept the file in one `BEGIN`/`ROLLBACK`. Real table grants were not changed.

---

## 2026-10-10 — D8 pgTAP coverage and CI

Added pgTAP for revoked invites, last-admin self-demote, and the remaining D8 cells. GitHub Actions runs app Jest and a fresh local Supabase `test db` with no hosted project.

---

## 2026-10-10 — Lock helpers, invite tokens, admin-only emails

SECURITY DEFINER access helpers now always use the signed-in user as the viewer. Trigger functions set `search_path`. Only Me circles require a matching membership. Profile emails are not selectable on the table; admins read them through a dedicated function. Invite lists no longer load share tokens until Share is tapped. Local API no longer exposes the GraphQL schema.

---

## 2026-10-10 — Auth gate routes (no shared `/`)

### What we built

`/` is only the session gate. Welcome lives at `/(signed-out)/welcome` and home at `/(signed-in)/home`. Signed-out and signed-in layouts wait for the session, then bounce the wrong group back to `/`. Create family stays under signed-in, so it needs a session. After sign-in, a saved invite token still sends the person to `/invite/{token}`.

### Why

Route groups hid the path, so welcome, home, and the gate all claimed `/`. Sign-in looked successful in Supabase but the app stayed on auth screens.

---

## 2026-10-10 — Profiles on Auth insert, friendly errors, Mom

### What we built

A new migration recreates `handle_new_user` so every `auth.users` row gets a `public.profiles` row (including people added in the Supabase dashboard). Existing Auth users without a profile are backfilled. Sign-up no longer writes the profile from the app. Family create and other screens show copy-file messages instead of database errors. The create-family chip reads **Mom**.

### Options we chose, and why

Dashboard-created test users never hit sign-up, so they had no profile and `create_family_space` failed on `family_spaces_created_by_fkey`. The trigger is the single writer at account creation. Display name comes from `raw_user_meta_data.display_name`, or empty if that key is missing. We did not edit already-applied migrations.

UI never shows Postgres or Auth error text (it can include emails and constraint names). We do not log those errors either.

### Deferred

`db push` and `supabase test db` still need Docker / the remote project from a human.

---

## 2026-10-09 — Slice 1 screens: auth, family, invites

### What we built

Email sign up / sign in / verify, create family space, placeholder family home with members, invite by **link and email**, accept/decline, add child profile, admin change role and remove.

Database (function + enum only): `declined` invite status, `decline_invite()`, `get_invite_preview` now includes `inviter_display_name`. No table changes.

### Options we chose, and why

**1. Invite is both a link and an email (D16)**

The invite row still stores email so `accept_invite` can match the signed-in account. After create, the admin can **Share invite link** (`patria://invite/{token}`) and/or **Send by email** (opens the phone mail app with that same link). We did not add a server mailer in this slice.

**2. Decline invalidates the token**

`decline_invite` sets status `declined`. Preview and accept then fail. Pending invites also expire after 14 days (`expires_at`), so a forgotten invite dies even if nobody taps Decline.

**3. Family home is a placeholder, not HOME-01**

HOME-01 includes Sync, memories and tasks, which are out of D1. Home shows family name, members, roles, admin actions, and a switcher only when the user is in more than one space (D5).

**4. Mail composer instead of Supabase Auth invite**

Supabase `inviteUserByEmail` needs the service role key, which must not live in the app. The mail app on the phone is the safe way to send the link in slice 1.

### Deferred

Keys, photo library, SMS, merge spaces, custom circle editor, vault, push notifications. Database tests were not run here because Docker was not running.

---

## 2026-10-09 — App foundation (Expo Router, no feature screens)

### What we built

* Expo Router with a signed-out group, a signed-in group, and a root redirect (signed out by default via `SESSION_PLACEHOLDER_SIGNED_IN`)
* Theme tokens, a single `src/lib/copy.ts` for English UI text (D11)
* Supabase JS client that persists the Auth session in Expo SecureStore (chunked because of the size limit)
* TanStack Query at the app root
* ESLint, Prettier, Jest, React Native Testing Library
* `.env.example` and `.env` in `.gitignore`
* Left `patria-app/supabase/` migrations and tests untouched

### Options we chose, and why

**1. Placeholders, not CIR05 screens**

D2: do not invent a final visual. The design PNGs exist for create-family / invite / home, but this step is foundation only.

**2. Colors from the mockups; fonts and spacing as placeholders**

`docs/design/` has no `tokens.md`. We used cream `#F7F1E8`, green `#2F4F3E`, and orange `#C8553D` from the screens and the README examples. Heading/body fonts are system serif and system sans until Figma names are exported.

**3. SecureStore instead of AsyncStorage**

The official Supabase Expo snippet uses AsyncStorage, which is not encrypted. The plan required secure device storage. We chunk values so large session JSON does not hit Android’s ~2KB SecureStore limit. Web (Expo web only) still uses `localStorage`.

**4. Jest-expo plus shims**

SDK 57’s `jest-expo` expects `@react-native/jest-preset` and a `react-native/setup-env` file that RN 0.86 does not ship. We map that module to a local empty shim. RNTL 14 needed React 19.3’s test renderer; we kept RNTL 13 to match React 19.2.3 from Expo.

**5. No Auth yet**

The signed-in tree exists so later screens have a home. The gate is a boolean, not a session listener.

### Deferred

Feature screens, email sign-in, family space UI, real fonts, loading a session on launch.

---

## 2026-10-09 — Slice 1 database: CIR05, CIR01, CIR02 (no UI)

### What we built

Secure Supabase schema under `patria-app/supabase/`:

* Tables: `profiles`, `family_spaces`, `space_members`, `child_profiles`, `circles`, `circle_members`, `circle_item_type_defaults`, `invites`
* Row Level Security on every table, matching DECISIONS D8
* RPCs: `create_family_space`, `accept_invite`, `get_invite_preview`
* pgTAP tests for family isolation and every Yes/No in the D8 matrix
* No app screens, no cryptography

### Why this order

CIR05 / CIR01 / CIR02 are the trust layer. Every later feature hangs off “who belongs, who sees what, who can do what.” D1 says the first product slice is sign up, family space, invites, roles, and default circles. Building UI before RLS would make it easy to ship screens that leak data.

### Options we chose, and why

**1. Children under 13 as `child_profiles`, not Auth users**

D6: they have no login in v1. Putting them in `auth.users` would create accounts they cannot use and would fight COPPA. A separate table makes “no device access” a hard fact, while still letting us tag them in circles and show them on the invite screen (Sofia and Luis in `CIR05-02`).

**2. Family admin and Co admin share one helper (`is_space_admin`)**

D7: same permissions, two labels. One function means the two roles cannot drift apart in policies. The last-admin rule counts both.

**3. Only Me is per member per space, not one family-wide circle**

The approved plan allowed `family_space_id` null for Only Me. We did **not** do that. D5 allows one person in many family spaces; a single global Only Me circle would mix those spaces. Each membership gets its own Only Me circle owned by that user in that space. This is still D9 (visibility circle), not GROW02 teen private space.

**4. Membership inserts only through RPCs**

If any authenticated user could `INSERT` into `space_members`, RLS would have to re-encode invite rules (expiry, once-only, email match). `create_family_space` bootstraps the first admin (otherwise “must be an admin to add a member” has no first admin). `accept_invite` enforces D12 in one transaction.

**5. Caregiver end date on `space_members`, not a separate table**

D8 only needs “while active” plus default 24 hours / max 30 days. A column plus a trigger is enough. Expired caregivers keep their row (history) but `space_role()` treats them as inactive for space reads.

**6. Successors are members with no data access**

They must exist so admins can “name successors” (D8). A separate table would duplicate membership. RLS: they can `SELECT`/`DELETE` only their own `space_members` row (so they can leave) and cannot read `family_spaces` or anyone else.

**7. `circle_item_type_defaults` before we have photos or tasks**

D8 includes “change default circles per item type.” Without a table, we could not write a Yes/No test. Placeholder item types: photo, story, note, task, document. New spaces default all of them to Household, matching “children’s content defaults to Household” in FEATURES.

**8. `relationship_label` is not a role**

The create-family mockup uses Mom / Dad / Grandparent / Guardian. Those are how someone describes themselves in the family, not what they can do. Permissions stay on `space_role`. Mixing them would make “Mom” an admin by accident.

**9. Extended relatives see the member list only through shared circles**

D8: “Only members in circles they share.” Shared means a non-Only Me circle. Only Me never has a second person, so it cannot be used to peek. Children follow the same rule via `circle_members.child_profile_id`.

**10. No encryption columns yet**

D1 and the approved plan: keys and recovery contacts are later. We left a TODO comment on `family_spaces` rather than nullable crypto columns that would invite storing plaintext by mistake.

**11. Tests are pgTAP via `supabase test db`**

Project rules require a SQL test for every policy. pgTAP runs inside Postgres, so it can `SET ROLE authenticated` and set `auth.uid()` the same way the API does. App-level tests cannot prove RLS.

**12. SELECT denials return empty rows, not errors**

Postgres RLS on `SELECT` filters; it does not throw. Tests for “cannot view” assert empty results. `INSERT`/`UPDATE`/`DELETE` that violate `WITH CHECK` raise `42501`.

### Mockups we used (UI still not built)

* `CIR05-01` — display name, email, relationship chips, privacy line (“family holds the keys”)
* `CIR05-02` — family name in the title, pending invite, SMS invite (not built; CIR03), child profiles with no email
* `CIR05-03` — space ready, invite summary, Family Sync and keys called out (Sync and keys not in this slice)
* `HOME-01` — “Good evening, the Rivera family” and member initials (needs `family_spaces.name` and member list)

The create screen has no family-name field. We still store `family_spaces.name` so later screens can say “the Rivera family.” The app can default it from a last name when UI is built.

### Deferred on purpose

* Family encryption keys and recovery contacts
* Photo library / first Story
* SMS / phone invites (nullable `phone` TODO on `invites`)
* Merging two parent-created spaces
* Linked households (CIR04)
* Teen private space (GROW02)
* Role-change push notifications (D10: refresh on open is enough for slice 1)
* Realtime fan-out under 60 seconds (D10)

### How to run

See `patria-app/supabase/README.md`.
