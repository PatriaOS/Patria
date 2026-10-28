# Patria screen designs

Put exported screens from the Patria Figma file in this folder, so Cursor can match them when building each feature.

## How to export from Figma

1. In Figma, select a screen (frame).
2. In the right panel, under **Export**, choose **PNG** at **2x**.
3. Click **Export** and save the image into this folder.

## Naming

Name each file with the feature ID and screen name, so Cursor can find the right one:

* `CIR05-01-create-family.png`
* `CIR05-02-invite-members.png`
* `CIR05-03-family-space-ready.png`
* `GOV02-01-family-sync.png`
* `GOV02-sync-hub-light.png` / `GOV02-sync-hub-dark.png` (D35 Sync hub fixtures)
* `GOV02-sync-meeting-step2-light.png` / `GOV02-sync-meeting-step2-dark.png` (D35 in-meeting flow)
* `GOV02-add-agenda-light.png` / `GOV02-add-agenda-dark.png` (D35 Add to agenda fixtures)
* `GOV02-members-avatars-light.png` / `GOV02-members-avatars-dark.png` (D35 avatar tones)
* `LEG01-01-new-decision.png`

**Current Home (D36):** no matching screenshots in this folder yet. Femi will add them from his iPhone. Until then, do not treat any Home PNG here as the source of truth for new Home work.

### Home history (keep; do not match for new work)

These show earlier Home layouts. Kept for reference only.

* `HOME-01-today.png` — early HOME-01 (Oct 2026)
* `D32-home-light.png` / `D32-home-dark.png` — D32 Home (Oct 19)
* `GOV02-home-today-light.png` / `GOV02-home-today-dark.png` / `GOV02-home-today-light-week.png` / `GOV02-home-today-dark-week.png` — D35 Home Today (Oct 25)
* `GOV02-home-real-light.png` / `GOV02-home-real-dark.png` / `GOV02-home-real-notice.png` / `GOV02-home-real-large.png` — D35 Home tab chrome (Oct 25)
* `HOME-v2-filled-light.png` / `HOME-v2-filled-dark.png` / `HOME-v2-empty-light.png` / `HOME-v2-empty-dark.png` / `HOME-v2-drawer-light.png` / `HOME-v2-drawer-dark.png` — first-round Home v2 (before attention cards left Home, before bell/menu icon fix and card tone rhythm)

## Design tokens

If you can, also add a short `tokens.md` file here listing the colors, fonts and spacing used in Figma, for example:

* Primary green: #2F4F3E
* Accent orange: #C8553D
* Background cream: #F7F1E8
* Heading font: (font name from Figma)
* Body font: (font name from Figma)

Replace the example values above with the real ones from your Figma file.
