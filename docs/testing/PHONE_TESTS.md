# Patria phone tests (source for Maestro automation)

Master copy for people: the Patria Test and Demo Script (Claude Doc). Keep both in step; this file is the one Cursor reads.

Copied from the Patria Test and Demo Script on Oct 13, 2026. When a test changes, both are updated.

Each step says what counts as a pass. Steps marked **(manual)** need a person's judgement and stay manual. Each test lists `Areas:` (auth, navigation, invites, children, keys, devices, recovery, rotation, membership, memories) so `npm run e2e:affected` can run only the tests that match changed files.

## Accounts

| Account | Email | Role in the tests |
| --- | --- | --- |
| Test 1 | femipaul7535+test1@gmail.com | Creates the family; Family admin |
| Test 2 | femipaul7535+test2@gmail.com | Invited; Elder (Co admin in test 10) |
| Test 3 | femipaul7535+test3@gmail.com | Cancelled invite in slice 1; Elder or Teen in key tests |

Passwords are never written in this file. Invites must go to these exact addresses, because Patria checks that an invite is accepted by the email it was sent to.

## Slice 1 (CIR05, CIR01, CIR02)

### 1. Back navigation
Areas: navigation, auth
1. Sign in as Test 1. You land on Home. Pass if the greeting is time of day plus **E2E Family** (not “Hello, Test 1”).
2. Open the **Family** tab, then tap **Invite someone**. Pass if a back arrow shows at the top left.
3. Tap the arrow. Pass if you return to Family and **Invite someone** is still there.
4. Open **Invite someone** again and swipe right from the left edge. Pass if you return to Family.
5. Repeat with **Add a child**. Pass if the Home tab itself has no back arrow.

### 2. Pull to refresh
Areas: navigation
1. On Home, drag down from near the top and let go.
2. Pass if a spinner shows briefly, the screen reloads, and there is no **Continue** button.

### 3. Invite and accept
Areas: invites, auth, membership
1. As Test 1, open the **Family** tab, tap **Invite someone**, enter Test 2's email, choose **Elder**, and send.
2. In the share sheet, tap **Copy**. (manual)
3. Sign out, then sign in as Test 2. A new person with no family lands on **Create family**.
4. Use **Were you invited to a family? Paste your invite link**: paste, then **Open**.
5. Pass if you see the family name, your role, and what others can see about you, before accepting.
6. Tap **Accept**. Pass if you land on Home and see the family and its members.

### 4. Cancelled invite
Areas: invites, auth
1. Sign out, sign in as Test 1, invite Test 3's email, and tap **Copy**. (manual)
2. Find the pending invite and tap **Revoke**.
3. Sign out, sign in as Test 3, and paste the link.
4. Pass if you see a friendly "no longer valid" message with no technical error text.
5. Sign out and back in as Test 3. Pass if the old invite does not reappear.

### 5. Sign out
Areas: auth
1. Open the **Family** tab, then tap **Sign out**. Pass if a spinner shows, then the Welcome screen.
2. Swipe right from the left edge. Pass if you stay on Welcome.

### 6. Add a child
Areas: children, membership
1. As Test 1, open the **Family** tab, tap **Add a child**, enter **Lily**, and save.
2. Pass if Lily appears in the member list as a child with no email.
3. Sign out, sign in as Test 2. Pass if there is no **Add a child** option and no email addresses are shown (D17).

### 7. Large text (manual)
Areas: navigation
1. Settings, Accessibility, Display & Text Size, Larger Text: turn on Larger Accessibility Sizes and drag the slider most of the way right.
2. Open Welcome, Home, Invite someone and Add a child.
3. Pass if all text is readable, no button is cut off, and everything can be reached by scrolling. For now (D19) text stops growing at a moderate size.
Automation may capture screenshots at large text for a person to review, but a person decides pass or fail.

## Family keys (CIR05 part B)

### 8. Family key created on this phone (Step 3)
Areas: keys
1. Sign in as Test 1 and create a new family, for example **Test Keys Family**. If you already have a space, open the **Family** tab and tap **Create another family**.
2. Open the **Family** tab. Pass if it shows that family keys are set up on this phone (Home no longer shows this once keys are ready).
3. Database: one row in `family_key_meta` for the new family with key epoch 1.
4. Database: exactly one row in `family_key_wraps` for that family, and the wrapped key column is unreadable bytes.
5. Open an older family Test 1 is an admin of. Pass if keys are set up automatically, with no extra screens.
6. Sign in as Test 2 (not an admin) in a family Test 2 belongs to. Pass if no new key is created and Home calmly says this phone is waiting for a family admin (Home keeps this notice until the phone is let in).
7. Fully close and reopen the app as Test 1. Open **Family**. Pass if keys still show as set up, with no new rows in `family_key_meta`.

### 9. Let a new member's phone in (Step 4)
Areas: keys, devices, membership, invites
One device is enough: each account on the same device counts as its own device. With two devices, keep Test 1 on device A and Test 2 on device B and skip the sign outs.
1. As Test 1 in the family with keys, invite Test 2 as **Elder** if not already a member.
2. As Test 2, accept the invite if needed. Pass if Home says this phone is waiting for a family admin.
3. As Test 1, open **Family**. Pass if a notice shows that Test 2 **added a new phone**, with name, role and when the phone was set up (date and time without seconds).
4. Tap **Let in**. Pass if the notice disappears and a new row for Test 2 appears in `family_key_wraps`.
5. As Test 2. Open **Family**. Pass if it now says family keys are set up on this phone.
6. Repeat with Test 3 invited as **Extended relative**. Pass if no notice ever appears for Test 3.
7. Invite Test 3 to a different test family as **Elder**, have them accept, then as Test 1 tap **Decline**. Pass if Test 3 keeps waiting and no wrap row is created.

### 10. Approve your own new phone (Step 5)
Areas: devices, keys
Needs a second device for the same account (device B). Device A is where Test 1 already has keys.
1. Sign in as Test 1 on device B. Pass if B says it is waiting for one of your existing phones.
2. On device A as Test 1. Pass if a notice asks "Is this your new phone?" with when B was set up.
3. Make Test 2 a Co admin, sign in as Test 2. Pass if they see an information notice about Test 1's new phone with no button to let it in.
4. On device A tap **Yes, this is my phone**. Pass if B now says family keys are set up and a new row for Test 1 and device B appears in `family_key_wraps`.
5. Sign in as Test 1 on a fresh device (or B after clearing app data), then on device A tap **This wasn't me**. Pass if that device never gets keys and admins are told.
6. On device A, open the **Family** tab, then **Your phones**. Remove device B and confirm **Remove**. Pass if B goes back to waiting and its row disappears from `family_key_wraps`.

### 11. Set up recovery contacts and printed code (Step 6)
Areas: recovery, keys
Device A: Test 1 (Family admin). Device B: Test 2, Elder or Co admin, already let in. After D27 (Oct 13), run this fresh for each account before test 12.
1. On A as Test 1, open Home. Pass if the **Needs you** bell shows a count, and **Needs you** lists **Set up recovery**. Open it through Privacy and Security → Recovery contacts. Pass if that blocks nothing on Home.
2. Choose Test 2 as the first contact. Pass if only adult family members whose phones are let in can be chosen.
3. On B as Test 2, open **Family** and pull to refresh. Pass if a notice explains what being a recovery contact means, with **Accept** and **Decline**. Tap **Accept**.
4. Back on A, add a second contact the same way (make Test 3 an Elder, let them in, have them accept). Pass if Family shows recovery is set up with two contacts.
5. On A, after two contacts have accepted, Privacy and Security shows **Write down a printed code**. Tap it. Pass if 24 words appear once with a clear "write this down" warning, and the app asks you to type a few back before finishing. (Automation: read the words from the screen and keep them in memory for test 12; never write them to a file or log.)
6. Database: locked boxes, contact rows, one row per member in `recovery_public_keys` (a public key only), no `recovery_key_wraps` table, and nothing that looks like the 24 words or a readable key.
7. Remove Test 3 as a contact. Pass if that member sees **Recovery needs attention** and is asked to choose a new contact. Remaining contact and paper stay valid until they redo (D27). Redo offers a new printed code; the old code then no longer works.
8. On B as Test 2 (Elder), open **Set up recovery** and choose Test 1. On A, Test 1 accepts. Pass if Test 2 can finish asking that contact (holder secrets wrap to Test 1’s let-in phone without Test 2 listing wraps).

### 12. Recover after losing every phone (Step 7)
Areas: recovery, devices
Before: test 11 passed for Test 2 (contacts Test 1 and Test 3, printed code known). Recovery wait shortened for testing only. Devices: device 1 = Test 1 (contact A, admin); device 2 = Test 2's old phone; new device = Test 2's new device.
1. On the new device sign in as Test 2. Pass if "Waiting for approval" shows with **I lost my phone**. Tap it and confirm. (manual, pending automation: Start recovery succeeds but Maestro does not see “Waiting until” on the recover screen)
2. Pass if the new device shows a countdown and says contacts were asked to call first, and devices 1 and 2 both show a recovery alert, with **This wasn't me** on device 2. (manual, pending automation: depends on step 1 completing)
3. Cancel check: on device 2 tap **This wasn't me**. Pass if the new device shows the request was cancelled. Start a new request. (manual, pending automation: restarting recovery after cancel hits the same start assertion)
4. Admin stop check: on device 1 tap **Stop this recovery**. Pass if the new device shows it was cancelled by a family admin. Starting a new request also cancels any older open one. Start a fresh request. (manual, pending automation: Stop this recovery is not stable after a cancelled request)
5. Too early check: on device 1 open the request right away. Pass if Approve is locked and shows when it unlocks.
6. After the wait, on device 1 tap **Approve** after the reminder to confirm by phone. (manual, pending automation: Help with recovery depends on an open request from step 1)
7. On the new device tap **Use my printed code** and type the 24 words. Pass if a wrong word gives a friendly error, not a crash. (manual, pending automation: printed-code field only appears after recovery can finish)
8. Pass if the new device says the family key is restored, then shows **Remove your old phones** with device 2 ticked. Tap to confirm. Pass if device 2 becomes removed and device 1 gets a notice. Old phones must never be removed before the tap. (manual, pending automation: Maestro relaunches onto Home, so Remove your old phones is gone)
9. One helper is not enough: fresh request, only device 1 approves, no code typed. Pass if the new device keeps waiting.
10. Optional: recover with contact A and contact B, no code. (manual)
Pass when steps 2 to 8 behave as written, no screen shows the code words after typing, and no database column holds the printed code.

### 13. A new family key when someone leaves (Step 8)
Areas: rotation, membership, keys
Before: Test 1 (admin) and Test 2 (Elder) have let in devices; Test 3 joined as Teen or Elder with a let in device. Note the highest key epoch for the family.
1. On device 1 (Test 1) remove Test 3. Confirm the native alert **Remove from this family**. Pass if Home briefly shows **Updating the family key**, then **The family key is up to date**. (manual, pending automation: Remove often completes, but Maestro still misses the Updating copy)
2. Database: key epoch up by one; new wraps only for Test 1's and Test 2's let in devices; none for Test 3 at any epoch.
3. On Test 2's device pull to refresh. Pass if keys are still set up with no approval needed.
4. As Test 3, bring the app to the foreground (or pull to refresh). Pass if they no longer see the family and no new wrap exists for them; they should not need to sign out.
5. If Test 3 was a recovery contact, pass if that member sees **Recovery needs attention** and is asked to choose a new contact. (manual, pending automation: seeding Test 1’s recovery contacts before Remove exceeds the phone-test time budget)
6. Database: `family_key_under_recovery` has one new row at the new epoch per remaining member with recovery set up, none for Test 3. (manual, pending automation: depends on recovery being seeded before Remove)
7. Invite Test 3 back, let them in, then as Test 3 open your own member row and tap **Leave family**. Confirm on the destructive **Leave family** button. Pass if the next time Test 1 opens the app the key is updated on its own (epoch up again). (manual, pending automation: inviting Test 3 back onto their member row is not stable in Maestro)
8. Change Test 2 from Elder to Extended relative. Pass if the key is updated and Test 2 no longer holds it. Change back and let Test 2 in again.
9. Add and remove a Caregiver. Pass if the key epoch does not change.
10. Optional: two admins remove someone at the same moment. Pass if only one new key version appears and both end up on it. (manual)
Pass when steps 1 to 9 behave as written and no screen or log shows a key.

## Memories (MEM)

MEM01 slice 1 is done: tests 14, 15 and 16 passed on a real iPhone after D30 was on the hosted test project. Test 17 step 2 is still pending by hand.

MEM01 slice 2 is done: tests 18 and 19 passed on a real iPhone (Expo Go, hosted). Tests 20–23 stay as written.

Before you start (all memories tests): Test 1 is Family admin (Household and Extended Family by default). Test 2 is an Elder in Household and Extended Family (D30). Test 3 is an Extended relative in the Extended Family circle only. Close Friends stays empty until an admin adds people, so it does not appear in the picker. Have two or three photos on the phone or Simulator (the automated run adds sample photos to each Simulator).

### 14. Add photos to the family library (MEM01)
Areas: memories
1. As Test 1, open Memories and tap Add photos. Pick two photos. **(manual)** Maestro cannot drive the system photo picker; automated runs use bundled samples only when `EXPO_PUBLIC_E2E=1`.
2. Pass if the circle picker shows Household selected by default, with the circle explained in plain words, and also offers Extended Family and Only Me. Close Friends is absent until someone is added to it.
3. Add an optional caption and tap Share. Pass if a progress indicator shows and both photos appear at the top of the library, newest first, each with a Household badge, the uploader's name and the date the photo was taken.
4. Tap a photo. Pass if it opens full screen with its caption, circle badge and date, and no location.
5. Pull to refresh on another device signed in as Test 2. Pass if both photos appear.
Pass when: steps 1 to 5 behave as written.

### 15. Only the right circle sees a photo (MEM01, CIR01)
Areas: memories
1. As Test 1, add photo A to Household and photo B to Extended Family.
2. As Test 2 (Household and Extended Family). Pass if Test 2 sees photo A and photo B.
3. As Test 3 (Extended Family only). Pass if Test 3 sees photo B and not photo A, and the library never hints that photo A exists. **(manual, pending automation: Test 3 on the third Simulator leaves Welcome but Maestro does not see Sign in)**
4. Add photo C to Only Me as Test 1. Pass if nobody else ever sees it. **(manual, pending automation: checking Test 3 for Photo C hits the same third-Simulator sign-in)**
5. Database and server check (automated): signed in as Test 3, asking the server directly for photo A's record or file returns nothing and no viewing link can be made.
Pass when: each person sees exactly the photos their circles allow, in the app and through the server.

### 16. Move or remove your own photo (MEM01)
Areas: memories
1. As Test 1, open photo B and move it to Household (a smaller circle). Pass if it moves without extra questions and Test 3 no longer sees it after refresh. **(manual, pending automation: Move is tapped but Maestro does not see Household on the item, so Test 3’s refresh is not a fair check)**
2. Move a Household photo to Extended Family (a larger circle). Pass if the app asks to confirm, explaining more people will see it.
3. Delete one of your own photos. Pass if it disappears for everyone after refresh, and its file is gone from storage. **(manual, pending automation: Delete confirm is tapped but Maestro does not land back on the library)**
4. As Test 2, open a photo Test 1 shared. Pass if there is no Delete or Move option. **(manual, pending automation: Test 2 never got a Photo B row to open after the move/delete steps)**

### 17. Access ends when someone leaves (MEM01)
Areas: memories
1. As Test 1, remove Test 3 from the family (or remove them from the Extended Family circle).
2. On Test 3's device, pull to refresh or reopen the app. Pass if no family photos remain on screen and none can be opened. **(manual, pending automation: Test 3 on the third Simulator leaves Welcome but Maestro does not see Sign in)**
3. Server check (automated): a viewing link created for Test 3 before the removal stops working once it expires, and Test 3 cannot create a new one.

### 18. Pick many photos or a short video (MEM01 slice 2)
Areas: memories
1. As Test 1, open Memories and tap Add photos. Pick two photos and a short video. **(manual)** Maestro cannot drive the system photo picker; automated runs use bundled samples only when `EXPO_PUBLIC_E2E=1`.
2. Pass if the screen shows “Videos up to 1 minute and 50 MB”, how many items were selected, Household is selected by default, and Share is offered.
3. Tap Share. Pass if progress counts each item, the video tile shows a frame from the video (or a clean placeholder, never a stretched speck) with a play mark and the length on the thumbnail, opening it plays full screen with pause and sound, and it says no location is stored with this video.
4. Pick a video longer than one minute, or larger than 50 MB. Pass if it is refused kindly on the add screen before Share, and nothing is uploaded. If that video is picked with photos, pass if the photos stay selected and the screen says the video was not shared and why (for example “1 video wasn’t shared: it’s longer than 1 minute”). **(manual)**
5. Pick a video that still has location in the file. Pass if it is refused. **(manual)** Keep a real GPS video check on a phone before treating video as done.
Pass when: steps 1 to 3 behave as written. Over-limit and located videos stay off the library.

### 19. Connect the photo library (MEM01 slice 2)
Areas: memories
1. As Test 1, on Memories tap Connect my photos. Pass if an explainer appears before any permission sheet, in plain words, and nothing is shared yet.
2. Continue, allow photos. Pass if the setup is numbered steps (What to share, Who will see them, Start from, Network), no circle is preselected, and Turn on sharing does not pick a circle for you. Tap Household, leave From today selected, and turn sharing on. Pass if Memories shows a status pill (Up to date, Sharing N, Waiting for WiFi, or Paused) and a sync starts.
3. Take a new camera photo while sharing is on. Pass if it appears within a minute on WiFi, marked automatic. **(manual)**
4. Add a new photo to the Simulator library (`simctl addmedia`) while Patria is open. The file must have today's Photos creation date (the Simulator uses the file birthdate, not mtime). Pass if it appears, marked automatic, older photos from before today are not uploaded, and Test 2 sees it.
5. Photo access **(manual for Limited and Denied)**: Full access shows “Photo access: Full” and no Open Settings button. Limited: the Limited explanation with Choose allowed photos and Open Settings, and Selected albums is shown only with full access plus a short reason otherwise. Denied: an explanation and Open Settings.
Pass when: steps 1, 2 and 4 behave as written on iOS. Camera and Limited access stay manual. Android library sync waits for a development build.

### 20. Share only selected albums (MEM01 slice 2)
Areas: memories
1. With full photo access, open Connect my photos and Continue. Pass if Selected albums is offered next to All new photos.
2. Choose one album and add a photo that is outside it. Pass if only the album photo is shared, and the album name is never shown to others. **(manual)**
Pass when: step 1 behaves as written. Album isolation stays a phone check.

### 21. Pause, cellular and WiFi (MEM01 slice 2)
Areas: memories
1. With sharing on, turn on Use cellular data, then Pause. Pass if status becomes Paused and nothing new is shared.
2. Resume. Pass if sharing continues when the network is allowed.
3. With cellular off and WiFi unavailable, pass if status is Waiting for WiFi. **(manual)**
Pass when: pause, resume and WiFi default behave as written.

### 22. Disconnect leaves shared photos (MEM01 slice 2)
Areas: memories
1. With sharing on, tap Disconnect. Pass if the app says new photos will stop sharing and already shared photos stay.
2. Confirm. Pass if Connect my photos is offered again and previously shared items are still in the library.
Pass when: disconnect stops new sharing and does not delete what was already shared.

### 23. Deleted library photos stay deleted (MEM01 slice 2)
Areas: memories
1. Share a photo automatically from the connected library. **(manual)** Needs a real library-sync photo (not the Add photos picker).
2. Open it. Pass if it can be deleted by the person who shared it. **(manual)**
3. Delete it. Pass if it leaves the library. **(manual)**
4. Reopen Patria. Pass if that deleted photo is not shared again, and adding it by hand through Add photos is still allowed. **(manual)**
Pass when: a deleted sync photo is not re-shared, and adding it again by hand through Add photos is still allowed.

## Design foundation (D32)

Layer 2: tabs and Appearance. Layer 3: restyled screens, Home mockup, lining numerals, themed cards, Vault lock.

### 24. Tab bar
Areas: navigation
1. Sign in as Test 1. Pass if Home, Memories, Sync, Vault and Family tabs show at the bottom, in that order.
2. Tap **Memories**. Pass if the Memories library opens.
3. Tap **Sync**. Pass if the Family Sync tab opens.
4. Tap **Vault**. Pass if you see **Kept with your family key.** and **No decisions yet**.
5. Tap **Family**. Pass if Invite someone and Sign out are there.
6. On Family with nothing waiting, pass if the Home tab is labeled **Home** (no terracotta dot).
7. Return to Home. If a let-in, new phone, recovery alert or This wasn’t me is waiting, pass if the Home tab is labeled **Home, 1 notice** and shows a terracotta dot while you are on another tab. (Jest covers the let-in case; this run asserts the quiet case.)

### 25. Appearance
Areas: navigation
1. Open **Family**, then **Appearance**.
2. Pass if you can choose **Match my phone**, **Light** or **Dark**.
3. Choose **Dark**. Pass if Family, the tab bar and the header go dark, and the clock and battery stay readable.
4. Choose **Light**. Pass if they return to linen.

## Decision Ledger (D33)

LEG01 slice 1 is done: tests 26 to 30 passed on a real iPhone (Expo Go, hosted). Text decisions, encrypted on the phone with a per-entry key wrapped to the family key. Slice 2 (D34) adds voice notes and Only me entries; tests 31 to 35.

### 31. Add a voice note to a decision
Areas: vault, keys
1. Sign in as Test 1, with recovery already set up. Open **Vault**, tap **New decision**, and tap **Record a voice note**. Record about 20 seconds, then **Play** before saving. Pass if you hear the recording.
2. Add a title and why, tap **Save**, and open the decision. Pass if the voice note shows its length and **Play** works.
3. Sign in as Test 2. Pass if Test 2 can play the same family voice note. (manual)
4. Pass if recording stops on its own at 5 minutes and explains why. (manual)
5. Pass if the stored audio object is unreadable bytes. (manual)

### 32. Only me entries
Areas: vault, keys
1. Sign in as Test 1 with recovery set up. Write a decision, choose **Only me**, and save.
2. Pass if the list and the entry show an **Only me** badge.
3. Sign in as Test 2. Pass if there is no sign of that entry. (manual)
4. Pass if the server returns nothing to Test 2 for the entry or its voice note. (manual)

### 33. Change who can read an entry
Areas: vault, keys
1. Sign in as Test 1. Open an **Only me** decision, tap **Edit**, tap **Family**, and confirm. Pass if the confirm explains that people who hold the family key will be able to read this.
2. Sign in as Test 2. Pass if Test 2 can now read it. (manual)
3. As Test 1, switch it back to **Only me**. Pass if the confirm warns that people who already read it may remember it.
4. Sign in as Test 2. Pass if Test 2 cannot see it. (manual)

### 34. Only me entries on a new phone
Areas: vault, keys, devices, rotation
1. Sign in as Test 1 with an **Only me** decision. Approve your own new phone. Pass if that phone can open the Only me decision. (manual)
2. Write a family decision with a voice note. Remove Test 3 so the family key changes. Pass if the Only me decision still opens and the family voice note still plays.
3. After recovery on a new phone, pass if Only me entries open. (manual)

### 35. Leaving deletes Only me entries
Areas: vault, membership
1. Sign in as Test 1. Open your member screen and tap **Leave family**. Pass if a confirm appears and **Cancel** is there. Pass if the warning mentions Only me entries. (manual)
2. After Test 2 leaves, pass if Test 1 still sees Test 2’s family entry as **A former family member**. (manual)
3. Pass if Test 2’s private entries, voice notes and personal key rows are gone. (manual)

### 26. Write a decision
Areas: vault, keys
1. Sign in as Test 1, with recovery already set up. Open **Vault**. Pass if you see **No decisions yet** and **Kept with your family key.**
2. Tap **New decision**. Type a title, who it is for, and why. Tap **Save**. Pass if the title is on the list with your name and the date.
3. Open it. Pass if the body you typed is there.

### 27. Teen can read, not write
Areas: vault, keys
1. Sign in as Test 3 (teen). Open **Vault**. Pass if **New decision** is not there.
2. Pass if the vault still opens (empty, waiting for this phone, or a list).

### 28. Follow-up
Areas: vault, keys
1. Sign in as Test 1 with recovery set up. Write a decision, open it, tap **Add a follow-up**.
2. Write how it turned out and save. Pass if the follow-up is listed on the original decision.

### 29. Recovery first
Areas: vault, recovery
1. Sign in as Test 1 without recovery set up. Open **Vault**. Pass if **New decision** is not there and you see to set up recovery first.
2. Pass if you can still see the empty vault (reading is allowed).

### 30. Read after rotation
Areas: vault, rotation, keys
1. Sign in as Test 1 with recovery set up. Write a decision.
2. Remove Test 3. Pass if Home updates the family key.
3. Open **Vault**. Pass if the decision is still there and opens.

## Weekly Family Sync (GOV02, D35)

Slice 1 of the weekly Sync: a Sync tab, a schedule, an agenda anyone in the circle can add to, and one phone that runs the meeting. Tests 36 to 41. Sync is Standard tier (not the family key), so there is nothing to unlock. Run these in order with Test 1 (Family admin) and Test 2 (Elder or Co admin) on a family that has no Sync schedule yet.

### 36. Set up our Sync
Areas: sync, navigation
1. Sign in as Test 1. Tap **Sync**. Pass if you see **Family Sync** and a **Set up our Sync** button.
2. Tap **Set up our Sync**. Pass if you see the days of the week, **Time**, **Time zone** and a choice of **Household** or **Extended Family**.
3. Pick a day, type a time like 19:00, leave the time zone as it is, keep **Household**, and tap **Save schedule**. Pass if you return to Sync and see the day and time, **Household**, and the four steps of tonight's flow.
4. Sign in as Test 2 (not an admin). Open **Sync**. Pass if Test 2 sees the same meeting but no **Schedule** button.
5. On a family with no schedule yet, pass if a member who is not an admin sees **Ask a Family admin to set up the weekly Sync.** instead of the button. (manual)

### 37. Add to the agenda
Areas: sync
1. Sign in as Test 1. Open **Sync** and tap **Add to the agenda**. Pass if you can choose **Win**, **Discuss**, **Decide** or **Plan**, and a short line says where the item will show up.
2. Choose **Discuss**, type a title, and tap **Save**. Pass if you return to Sync and the title is on the agenda with **Discuss** beside it.
3. Tap the item, change the title, and tap **Save**. Pass if the new title shows on the agenda.
4. Sign in as Test 2. Add a **Win**. Pass if the Win shows on Test 1's agenda as **Added by** Test 2's name after a pull to refresh.

### 38. Run the Sync
Areas: sync
1. Sign in as Test 1 with at least one Win and one Decide item on the agenda. Open **Sync** and tap **Continue**. Pass if the **Wins** step opens with a note box.
2. Tap **Mark discussed** on a Win, type a note, and tap **Next**. Pass if the **Look ahead** step opens.
3. Tap **Next** to reach **Decide**. Type what the family decided, tap **Mark discussed**, then tap **Next**. Pass if **Gratitude** opens.
4. Tap **Next**. Pass if you can write **One priority for the week** and add a task with an owner.
5. Tap **Add a task**, then **Finish the Sync**. Pass if you return to Sync and the next meeting is a week away.
6. Open **Tasks**. Pass if the task you added is listed and you can mark it done.
7. If the meeting time has already passed and nobody started it, pass if Sync says the time has passed and offers **Hold it now** without any scolding. Tap **Hold it now**. Pass if the **Wins** step opens.

### 39. A second phone follows along (read only)
Areas: sync
1. Sign in as Test 1 on one phone. Open **Sync** and tap **Continue** so the Sync is running.
2. Sign in as Test 2 on a second phone. Open **Sync**. Pass if Test 2 sees **The Sync is running on** Test 1's name **phone** and a **Follow along** button, and no **Continue**.
3. Tap **Follow along**. Pass if Test 2 sees the steps and Test 1's notes, with no way to edit them.
4. On Test 1's phone, add a note and tap **Next**. Pass if the note shows up on Test 2's phone after a pull to refresh.

### 40. Past meetings
Areas: sync
1. Sign in as Test 1 after finishing a Sync (Test 38). Open **Sync** and tap **Past meetings**. Pass if the finished Sync is listed with its date, the priority you wrote, and a line like **1 of 2 items discussed**.
2. Pass if any decision you wrote shows under that meeting.
3. Pass if a family with no finished Sync sees **No finished Syncs yet.** (manual)

### 41. The Sync tab
Areas: sync, navigation
1. Sign in as Test 1. Pass if the bottom bar shows **Home**, **Memories**, **Sync**, **Vault** and **Family**, with Sync between Memories and Vault.
2. Tap **Sync**. Pass if the tab is marked selected and the Family Sync screen opens.
3. Tap **Family**, then **Sync** again. Pass if Sync shows the same screen without a back arrow.
4. Use the largest text size. Pass if Sync scrolls and nothing is cut off. (manual)

## Home v2 (design)

Home starts with the header (greeting, avatars, Needs you bell, menu), then five body cards with the D36 tone rhythm. Urgent items live under the bell and on Family / Privacy and Security. Tests 42–45.

### 42. Home Today
Areas: sync, navigation
1. Sign in as Test 1 in a family that has a Sync schedule (Test 36). Pass if Home shows the date, **Good morning, / afternoon, / evening,** and the family name on a second line in italics (with **The** only when the stored name does not already start with it), with the member avatars, **Needs you** bell and **Open menu** clearly visible under the avatars.
2. Pass if the Sync card is the green hero with a mustard CTA: a line like **SUNDAY FAMILY SYNC · IN 4 DAYS** (or **TONIGHT**, **TODAY**, **TOMORROW**), the title **Household meeting**, a line about the agenda, and **Review agenda** and **Add an item**.
3. Tap **Review agenda**. Pass if the Sync tab opens. Go back to Home and tap **Add an item**. Pass if the add-to-agenda screen opens.
4. Pass if no attention cards sit above the greeting, and no keys or recovery status pills show while keys are set up. Pass if the five body cards are present in tone order: Sync (hero), This week (surface), voice (warm), Memories (surface), Vault (hero).
5. Scroll to **This week**. Pass if it lists up to four open Sync tasks due this week (see Test 38) with a day chip, or the empty card with **No tasks due this week.** and a green **Add a task** when there are none. Tap a task's checkbox when a task is shown. Pass if it stays visible with **Done today**.
6. Tap **See all** beside **This week**. Pass if the Sync tasks screen opens.
7. Tap the avatars at the top right. Pass if the Family tab opens and shows the keys status and the recovery status below **Your phones**.
8. On a family with no Sync schedule, pass if the Sync card invites a Family admin to **Set up our Sync**, and tells anyone else to ask a Family admin.
9. On a day when a photo or video from an earlier year was taken on this month and day, pass if **On this day** appears as a line inside the Memories card and tapping it opens the memory; on other days pass if that line is absent.
10. Use the largest text size. Pass if Home scrolls and nothing is cut off. (manual)

### 43. Home empty body cards
Areas: navigation
1. Sign in as Test 1 in a brand-new family with no Sync schedule, no tasks, no Vault entries and no Memories. Pass if Home shows five empty body cards: Sync (**Set up our Sync** for an admin), This week (**No tasks due this week.** with **Add a task**, or the ask-admin line), voice (**Record a voice note** or ask-admin / locked), Memories (**Add photos and videos**), and Vault (**Add a decision** or ask-admin / locked).
2. Pass if each empty card has a short overline, a serif headline and one explanation line. Pass if no card shows a dead button for an action this role cannot take. Pass if a phone without Vault keys shows the calm locked copy on voice and Vault instead of a crash or blank card.

### 44. Home menu drawer
Areas: navigation
1. Sign in as Test 1. Tap **Open menu**. Pass if the drawer slides in from the right over a dimmed backdrop, showing the person's name, family name, close control, group dividers, **Sign out** pinned above the app version without hunting.
2. Double-tap **Settings** quickly. Pass if Appearance opens once and the drawer closes (only one screen).
3. Open the menu again. Tap **Privacy and Security**. Pass if that screen opens with a Recovery section. Go back, open the menu, tap **Sign out**. Pass if an in-drawer confirmation appears (**Sign out?** with Cancel and Sign out). Cancel it. Pass if you stay signed in and the drawer menu returns.
4. Open the menu, tap **Sign out**, confirm. Pass if you land on Welcome.

### 45. Needs you bell and sign-in reminder
Areas: navigation, recovery
1. Sign in as Test 1 with recovery not set up. Pass if a bottom sheet explains why recovery matters, with **Set it up now** and **Remind me later**. Tap **Remind me later**. Pass if the sheet closes and Home stays usable.
2. Pass if the **Needs you** bell shows a terracotta badge with the count. Tap the bell. Pass if **Needs you** lists recovery (and any other ranked items), most important first.
3. From **Needs you**, open recovery. Return to Home. Pass if the badge still reflects open items (count drops when an item is fully resolved).
4. Sign out and sign in again as Test 1 without finishing recovery. Pass if the reminder sheet appears once. Tap **Remind me later**. Pass if opening Home again in the same session does not show the sheet again.
5. Force-quit and reopen the app while still signed in. Pass if the reminder sheet does not appear, Home is usable, and the **Needs you** bell still shows the recovery item.
