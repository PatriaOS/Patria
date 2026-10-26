# Patria design system

D32. Tokens, type, shared `src/ui` components, tabs, Appearance, and restyled screens.

## Freeze (D32)

D32 design tokens, type scale, spacing, radii and component styles are fixed. Do not change them without Femi's explicit approval. New tokens may only be added, must use the Hearth palette, and must pass the contrast test. The only approved deviation is light terracotta `#A84C2A` (instead of `#B5532F`) for 4.5:1 contrast.

## Color (Hearth)

Two palettes, same roles. Body text meets WCAG AA 4.5:1. Large type (24pt+ or 18pt+ bold) may use 3:1. Contrast pairs live in `patria-app/src/theme/contrastPairs.ts`.

| Role | Light | Dark | Use |
|---|---|---|---|
| background | `#F5F0E7` | `#111A16` | Screen |
| surface | `#FFFDF8` | `#18231E` | Cards, fields |
| softSurface | `#F2E6D6` | `#1D2A24` | Soft cards, pills |
| tabBar | `#FFFDF8` | `#0E1612` | Tab bar |
| text | `#22302A` | `#F1EADB` | Body |
| textMuted | `#5F645B` | `#A9B3A9` | Secondary |
| hairline | `#E3D9C8` | `#2A3832` | Dividers |
| primary | `#2F4A3A` | `#9CC7AA` | Actions, selected tab |
| onPrimary | `#F5F0E7` | `#0F1713` | Text on a primary fill |
| heroCard | `#2F4A3A` | `#1F3A2B` | Dark green hero |
| accentTerracotta | `#A84C2A` | `#E8896A` | Overlines, Home notice dot |
| accentMustard | `#D9A441` | `#E3B65A` | Accent buttons, EmptyState sun |
| success | `#3F8A5F` | `#3F8A5F` | Fills only |
| successText | `#246644` | `#9CC7AA` | Success labels |
| danger | `#8C2F24` | `#F0A090` | Danger text |
| dangerFill | `#8C2F24` | `#E07A6A` | Danger buttons |

Light terracotta is one step deeper than the Figma `#B5532F`, which is 4.36:1 on linen. Success green is not used as body text.

Light cards use one shadow: offset 0 / 8, radius 24, 5% ink.

## Type (Heirloom)

* Display and titles: Cormorant Garamond 600, section labels 500 italic. Display, Title and Section set `fontVariant: ['lining-nums']` so dates and “Test 1” do not render as old-style numerals.
* Body: Manrope 400 / 500 / 700.
* Scale (size / line multiplier): display 36 / 1.02, title 23 / 1.2, section 21 / 1.25, body 15 / 1.5, small 13 / 1.45, caption 12 / 1.4, overline 10.5 / 1.3 with 1.68 letter spacing.
* React Native styles do not set `lineHeight`. Multipliers stay in tokens only (D19).
* `allowFontScaling` is on. `maxFontSizeMultiplier` is 1.3 until the accessibility pass.
* If the webfonts fail (offline first launch), `FontGate` waits 4 seconds then continues with the system font. The splash does not hang.

## Space, radius, stroke

Space: 4, 8, 12, 18, 24, 32, 48. Screen padding and card padding are 24 and 18. Card radius 22, tile 14, pills and buttons full round. Icon stroke 1.5. Hit targets at least 44 points.

## Appearance

Stored as `system` | `light` | `dark` in expo-secure-store under `patria.appearance`. Default is match the phone. The Appearance screen is a later layer. The design gallery can preview light and dark without writing that key.

## Components (`patria-app/src/ui`)

Screen, Display, DisplayItalic, Title, Section, Body, Small, Caption, Overline, Button (primary, accent, ghost, secondary, danger, loading), Card (default, hero, soft), ChoiceChip, UnderlineTabs, StatusPill, Avatar, AvatarStack, PhotoTile, Icon, IconButton, IconCircle, ListRow, TextField, EmptyState, Skeleton, Banner, Divider, TabBar, LoadingState, ErrorState.

Cards always use `theme.surface` / `theme.softSurface` / `theme.heroCard`. A Jest check fails if a Card in dark mode still has the light cream surface.

### Accessibility

* Tabs use `accessibilityRole="tab"` and `accessibilityState.selected`.
* Decorative Lucide icons, EmptyState sun-and-hill art, photo frames, and the Home notice dot are hidden from VoiceOver.
* Icon-only buttons always take an `accessibilityLabel`.
* TabBar accepts `homeNoticeCount`. When the count is above zero and Home is not selected, a terracotta dot appears and the label is `Home, 1 notice` (or `Home, N notices`). Layer 2 will pass the notices Home already loads. No new data.

## Design gallery

Development only: `/design-gallery`. Redirects away in production builds. Use Light / Dark and Default text / Largest text (1.3) to preview D19.

## Navigation (Layer 2)

Tabs: Home, Memories, **Sync**, Vault, Family (D35). Appearance lives on Family (`Match my phone` / `Light` / `Dark`). Headers, the tab bar and the status bar follow the theme. A screen with a header does not add a second top safe-area inset; a tab screen does not add a second bottom inset.

## Home Today layout (D35)

Top to bottom on Home:

1. Security notices only when action is needed (same wording and prominence as before). Home tab notice dot unchanged.
2. Overline date in small capitals; Display greeting on two lines (“Good evening,” + italic primary family name); `AvatarStack` top right opens Family.
3. Family Sync hero card (`heroCard`): mustard overline countdown (TONIGHT / TODAY / TOMORROW / IN N DAYS), title from the meeting circle, body from agenda counts, Review agenda (accent) and Add an item (ghost). No schedule: set-up invitation for admins, ask-admin copy for others.
4. On this day soft card only when a circle-visible memory exists for this month and day in an earlier year (family time zone); otherwise omitted.
5. This week section with See all: up to four Sync tasks, checkbox, owner/backup, day chip, Done today/yesterday.

Keys and recovery status pills live on Family, not Home. Vault teaser and Recent memories leave Home.

## Screens (Layer 3)

Auth, create family, invite and accept, add child, members and roles, Home, Memories (library, add, item, connect), Sync, Vault, Family, Appearance, key notices, let in, your phones, recovery setup, printed code, recovery flow and leave family all use `src/ui`. Home greets the family by name. Vault’s tab icon is a lock. Icons are Lucide through `react-native-svg` only.
