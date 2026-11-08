# Parent Manager design system

Status: draft for review, 2026-11-07. It defines the chosen direction, **Calm Kitchen with Village touches** ([design-directions.md](design-directions.md#decision-calm-kitchen-with-village-touches); reference board `docs/design/direction-ac.html`), as tokens and components that backlog item F-06 turns into code.

How to use this document:

- **Token names are code names.** Each name below (`color.primary`, `space.4`, `radius.card`) maps one to one to a key in the theme file F-06 creates, `src/constants/theme.ts`. Screens use tokens only, never raw hex values or numbers.
- **The spec wins on behavior.** Where this document and [spec.md](spec.md) differ, the spec decides.
- **PROPOSED** marks choices the reference board didn't settle. They're open for review.

## 1. Principles

1. **One decision per screen.** One primary button, in the bottom third, within thumb reach.
2. **Calm by default.** Warm neutrals, one accent, and no motion or sound that isn't needed.
3. **Shared, visibly.** Member avatars show who added or checked something, so partners don't have to ask.
4. **Interruption-proof.** Edits save immediately, sheets keep their state when backgrounded, and undo replaces "are you sure?" dialogs.
5. **Accessible first.** The rules in section 9 aren't optional polish.

## 2. Color tokens

Every color comes from these tokens. Light and dark values are switched automatically by the system appearance setting.

| Token                 | Light              | Dark              | Use                                                                                    |
| --------------------- | ------------------ | ----------------- | -------------------------------------------------------------------------------------- |
| `color.background`    | `#FAF7F2`          | `#1C1B19`         | Screen background                                                                      |
| `color.surface`       | `#FFFFFF`          | `#262421`         | Cards, sheets, rows, the tab bar                                                       |
| `color.surfaceAlt`    | `#F1ECE3`          | `#302D29`         | Chips, inputs, the active tab pill, progress track                                     |
| `color.border`        | `#E2DACC`          | `#3D3833`         | Hairline dividers and card outlines. Decorative only, never the only edge of a control |
| `color.text`          | `#2B2A28`          | `#F2EEE8`         | Body text and titles                                                                   |
| `color.textSecondary` | `#6B665E`          | `#B5AFA6`         | Captions, hints, quantities, inactive tab labels, checkbox and switch outlines         |
| `color.primary`       | `#3F6B4F`          | `#8DBB9C`         | Primary buttons, the active tab, links, checked state, progress                        |
| `color.onPrimary`     | `#FFFFFF`          | `#10291A`         | Text and icons on `color.primary`                                                      |
| `color.accent`        | `#B4602F`          | `#E39A6B`         | Rare highlights only. In light mode, never small text                                  |
| `color.onAccent`      | `#FFFFFF`          | `#2A1406`         | Text on `color.accent` fills                                                           |
| `color.success`       | `#2F6B45`          | `#8FD19E`         | "Synced", "in the cart"                                                                |
| `color.warning`       | `#8A5A00`          | `#E9B949`         | Allergen notices, low-confidence import lines, offline banner                          |
| `color.error`         | `#B3261E`          | `#F2B8B5`         | Errors and destructive actions                                                         |
| `color.avatarSand`    | `#E9CFA6`          | `#E9CFA6`         | Avatar fill, member 1                                                                  |
| `color.avatarSage`    | `#B7D3BF`          | `#B7D3BF`         | Avatar fill, member 2                                                                  |
| `color.onAvatar`      | `#2B2A28`          | `#2B2A28`         | Avatar initials, in both modes                                                         |
| `color.scrim`         | `rgba(0,0,0,0.28)` | `rgba(0,0,0,0.5)` | Behind bottom sheets (PROPOSED dark value)                                             |

**More members:** a third and later member cycle through `avatarSand` and `avatarSage` with a different initial. More avatar colors are PROPOSED for when caregiver seats ship, and each must reach at least 7:1 with `color.onAvatar`.

### Contrast (WCAG 2.x)

| Pair                            | Light     | Dark | Allowed use                                                         |
| ------------------------------- | --------- | ---- | ------------------------------------------------------------------- |
| `text` on `background`          | 13.4      | 14.9 | All text                                                            |
| `text` on `surface`             | 14.3      | 13.4 | All text                                                            |
| `text` on `surfaceAlt`          | 12.2      | 11.9 | All text                                                            |
| `textSecondary` on `surface`    | 5.7       | 7.1  | All text                                                            |
| `textSecondary` on `background` | 5.3       | 7.9  | All text                                                            |
| `primary` on `background`       | 5.7       | 8.0  | All text and icons                                                  |
| `primary` on `surfaceAlt`       | 5.2       | 6.3  | Active tab label                                                    |
| `onPrimary` on `primary`        | 6.1       | 7.2  | Button labels                                                       |
| `onAccent` on `accent`          | 4.5       | 7.6  | Labels on accent fills, at the AA limit in light mode               |
| `accent` on `background`        | 4.2       | 7.5  | Light mode: large text (24 pt and up, or 19 pt bold) and fills only |
| `success` on `surface`          | 6.3       | 8.7  | All text                                                            |
| `warning` on `surface`          | 5.9       | 8.5  | All text                                                            |
| `error` on `surface`            | 6.5       | 9.1  | All text                                                            |
| `onAvatar` on avatar fills      | 9.5 / 8.9 | Same | Initials                                                            |
| `textSecondary` on `border`     | 4.1       | 5.3  | Control outlines pass the 3:1 minimum for interface parts           |

**Light-mode avatars:** the fills reach only about 1.5:1 against white, so avatars get a 1.5 pt `color.textSecondary` ring in light mode. In dark mode the ring is a 2 pt `color.surface` ring.

## 3. Typography

**Fonts:**

- **Headings:** Fraunces (SIL Open Font License), for screen titles, sheet titles, card titles and recipe names only. It's loaded through `expo-font` with the weight 600 file, and falls back to the system serif.
- **Everything else:** the system font (SF Pro on iOS, Roboto on Android).
- **Numbers:** quantities, counts and codes use tabular figures (`fontVariant: ['tabular-nums']`).

| Token               | Font     | Size / line height (pt) | Weight                           | Use                                          |
| ------------------- | -------- | ----------------------- | -------------------------------- | -------------------------------------------- |
| `type.screenTitle`  | Fraunces | 30 / 36                 | 600                              | One per screen                               |
| `type.sheetTitle`   | Fraunces | 22 / 28                 | 600                              | Bottom sheet titles, section headings        |
| `type.cardTitle`    | Fraunces | 21 / 26                 | 600                              | Card titles, recipe names in cards           |
| `type.sectionLabel` | Fraunces | 19 / 24                 | 600                              | Store sections on the list                   |
| `type.body`         | System   | 17 / 24                 | 400                              | Default text, list rows, inputs              |
| `type.bodyStrong`   | System   | 17 / 24                 | 600                              | Button labels, emphasised rows               |
| `type.label`        | System   | 15 / 20                 | 500                              | Secondary row text, field labels, quantities |
| `type.caption`      | System   | 13 / 18                 | 400                              | Hints, timestamps, disclaimers               |
| `type.overline`     | System   | 13 / 18                 | 600, uppercase, 0.05 em tracking | Small labels such as "TONIGHT"               |
| `type.tab`          | System   | 12 / 16                 | 500, or 600 when active          | Tab bar labels                               |

**Rules:**

- Body text is never smaller than 17 pt, and no text is smaller than 12 pt.
- Never set `allowFontScaling={false}`.
- Only two kinds of text are capped:
  - Tab bar labels, at `maxFontSizeMultiplier` 1.3. Each tab keeps its accessibility label, and iOS shows the large-content viewer on long press.
  - Avatar initials, at `maxFontSizeMultiplier` 1, so the circle keeps its size and list rows keep their room. The initial always sits beside text that does scale, and the avatar's accessibility label names the person (product owner decision, November 2026).
- Line heights scale with the text.
- Avoid text in all caps, except `type.overline`. Never use it for anything longer than 3 words.

## 4. Spacing, layout and radii

**Spacing**, on a 4-point scale:

| Token     | Value | Token      | Value |
| --------- | ----- | ---------- | ----- |
| `space.0` | 0     | `space.5`  | 20    |
| `space.1` | 4     | `space.6`  | 24    |
| `space.2` | 8     | `space.8`  | 32    |
| `space.3` | 12    | `space.10` | 40    |
| `space.4` | 16    | `space.12` | 48    |

**Layout:**

- **Margins:** screen side margins are `space.4` (16).
- **Gaps:** sections are separated by `space.6` (24), and items in a group by `space.2` (8).
- **Bottom of screen:** the primary action sits `space.3` (12) above the floating tab bar. Scrollable content gets bottom padding equal to the tab bar height plus its offset (`layout.tabBarClearance` = 92), so nothing sits under the bar.
- **Wide screens:** tablets and landscape cap readable content at `layout.maxContentWidth` = 640 (PROPOSED).

**Radii:**

| Token            | Value | Use                                                |
| ---------------- | ----- | -------------------------------------------------- |
| `radius.sm`      | 8     | Small inputs inside rows, code boxes               |
| `radius.control` | 12    | Buttons, text fields, steppers, segmented controls |
| `radius.card`    | 16    | Cards, active tab pill                             |
| `radius.sheet`   | 22    | Bottom sheet top corners, floating tab bar         |
| `radius.pill`    | 999   | Chips, tags, avatars, progress bars                |

## 5. Elevation

There are only three levels. Prefer a hairline `color.border` outline to a shadow.

| Token                | Light                                                                         | Dark                                | Use                                                             |
| -------------------- | ----------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| `elevation.flat`     | none                                                                          | none                                | Rows, chips and cards (cards use a 1 pt `color.border` outline) |
| `elevation.floating` | shadow `#2B2A28` at 12% opacity, offset y 6, radius 20; Android `elevation` 6 | Black at 45% opacity, same geometry | Floating tab bar, floating buttons                              |
| `elevation.sheet`    | Black at 12% opacity, offset y −8, radius 30; Android `elevation` 12          | Black at 50% opacity                | Bottom sheets, over `color.scrim`                               |

## 6. Motion

- **Durations:**
  - `motion.fast` (150 ms): presses and toggles.
  - `motion.base` (220 ms): sheets, list reorders, checked items moving to "in the cart".
  - `motion.slow` (300 ms): screen transitions, the completion moment.
- **Easing:** `motion.easing.standard` is cubic-bezier(0.2, 0, 0, 1). Exits use `motion.easing.exit`, cubic-bezier(0.4, 0, 1, 1).
- **Reduce Motion:** when the user has Reduce Motion on, replace movement with a cross-fade of `motion.fast` or less, or no animation. Never loop an animation.
- **Celebration:** one only, the list-complete screen (direction decision, item 4), shown once per list. No confetti, bouncing or particles.
- **Haptics:** off by default (spec FR-NOT-6, NFR-A11Y-7). If added later as a setting, use one light tap for a check-off only.
- **Sound:** none in the app.

## 7. Iconography

- **Style:** outline icons with a 24 pt grid, a 1.8 to 2 pt stroke, and round caps and joins, matching the reference board.
- **Library:** decided in F-06.2: `expo-symbols`, which draws SF Symbols on iOS and Material Symbols on Android, both in outline style. Expo's docs mark `@expo/vector-icons` (the earlier Feather proposal) for deprecation. The `Icon` component maps each app icon name to one symbol per platform, so screens never name symbols directly.
- **Sizes:** `icon.sm` 20 inside rows and fields, `icon.md` 24 for tabs and buttons, `icon.lg` 44 for empty states and the completion check.
- **Color:** an icon takes the color of its text, `color.primary` when it leads an action, or `color.textSecondary` when decorative.
- **Meaning:** an icon is never the only carrier of meaning. Icon-only buttons need a translated `accessibilityLabel` and a 48 pt target, and a warning icon always comes with text.

## 8. Components

Every component reads only tokens, has a `testID` prop for Maestro, and takes translated strings from its caller. A component never contains hard-coded copy.

| Component                | Variants                                                         | States                                                                                                                                                                            | Usage rules                                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Button**               | `primary`, `secondary` (outlined), `ghost` (text), `destructive` | default, pressed (darken 8% or 92% opacity), disabled (`surfaceAlt` fill, `textSecondary` label), loading (spinner, label kept for screen readers), focused (3 pt `primary` ring) | One `primary` per screen. Height 52, `radius.control`, `type.bodyStrong`. Full width in the bottom area. Labels are verbs ("Add a meal")                                                           |
| **IconButton**           | `plain`, `tinted`                                                | default, pressed, disabled, focused                                                                                                                                               | 48 × 48 target even when the icon is 24. A translated `accessibilityLabel` is required                                                                                                             |
| **ListRow**              | `plain`, `navigation` (chevron), `value` (trailing text)         | default, pressed (`surfaceAlt`), disabled                                                                                                                                         | Minimum height 56. The whole row is the target. Dividers are hairlines inset from the leading edge                                                                                                 |
| **CheckboxRow**          | unchecked, checked                                               | default, pressed, checked-by-member (avatar), pending sync (small clock)                                                                                                          | Grocery and checklists. A tap anywhere on the row toggles it. Checked rows fade to `textSecondary` with strikethrough and move to the "in the cart" group after `motion.base` (spec FR-LIST-4)     |
| **Checkbox**             | round                                                            | unchecked (2 pt `textSecondary` ring), checked (`primary` fill with an `onPrimary` check)                                                                                         | 26 pt visual inside a 48 pt target                                                                                                                                                                 |
| **Avatar / AvatarGroup** | `sm` 22, `md` 28, `lg` 56                                        | default                                                                                                                                                                           | Initials only, never photos (spec NFR-SEC-4). Initials don't scale with text size (section 3). Groups overlap by 6 pt. The accessibility label names the person and the action ("checked by Alex") |
| **Chip**                 | `filter` (selectable), `action` (one tap adds)                   | default, selected (`primary` fill), pressed, disabled                                                                                                                             | Minimum height 44 (48 in grids). Filter chips allow multiple selections. Never use chips for the screen's primary action                                                                           |
| **Tag**                  | `neutral`, `warning`                                             | static                                                                                                                                                                            | Not interactive. Outline style, `type.caption`. `warning` (allergens) always includes the allergen name in text                                                                                    |
| **TextField**            | `filled`, `search` (leading icon)                                | default, focused (`primary` border, `surface` fill), filled, error (`error` border and message), disabled                                                                         | Height 52. Every field has a visible label or a translated placeholder and accessibility label. Errors are in text, not color only                                                                 |
| **Stepper**              | `default`                                                        | default, at min or max (button disabled)                                                                                                                                          | 48 × 48 buttons. The value is announced on change. Used for servings, portions and quantities                                                                                                      |
| **SegmentedControl**     | 2 or 3 options                                                   | selected, unselected, pressed                                                                                                                                                     | Minimum height 48 (NFR-A11Y-4). For switching views, never for settings                                                                                                                            |
| **Switch**               | `default`                                                        | on (`primary`), off (`surfaceAlt` with a `textSecondary` outline), disabled                                                                                                       | Always paired with a row label. Changes apply immediately                                                                                                                                          |
| **RadioOption**          | card style                                                       | selected (`primary` border and dot), unselected, pressed                                                                                                                          | Minimum height 64. For one choice from a short list (region, role, plan)                                                                                                                           |
| **Card**                 | `default`, `highlight` ("tonight")                               | default, pressed (if tappable)                                                                                                                                                    | `radius.card`, `space.4` padding, 1 pt border, no shadow. Don't nest cards                                                                                                                         |
| **BottomSheet**          | `content`, `form`                                                | open, dragging, closed                                                                                                                                                            | Grabber, `type.sheetTitle`, `radius.sheet`. It keeps its state when the app is backgrounded. The primary action sits at the bottom. Closing doesn't need a confirmation                            |
| **FloatingTabBar**       | 4 tabs                                                           | active (`surfaceAlt` pill, `primary` icon and label), inactive (`textSecondary`), pressed                                                                                         | Inset `space.4` from the screen edges and 22 pt above the bottom safe area. Each tab is 52 pt tall. Always visible on tab screens, and hidden behind sheets                                        |
| **TopBar**               | `title`, `back`, `actions`                                       | default                                                                                                                                                                           | Back on the leading side. At most two trailing text actions. Wrapped titles are allowed                                                                                                            |
| **SectionHeader**        | `list` (Fraunces), `group` (overline)                            | default                                                                                                                                                                           | Store sections and settings groups                                                                                                                                                                 |
| **ProgressBar**          | `segmented` (dinners planned), `linear`                          | partial, complete                                                                                                                                                                 | Always paired with text ("6 of 7 dinners planned")                                                                                                                                                 |
| **Banner**               | `offline`, `partnerActivity`, `info`                             | visible, dismissed (info only)                                                                                                                                                    | Pinned under the TopBar, `type.label`. The offline banner can't be dismissed while offline                                                                                                         |
| **AllergenNotice**       | `recipe`, `importReview`, `inline`                               | static                                                                                                                                                                            | `warning` outline with an icon and text, naming the allergen and the person. Always includes the not-medical-advice disclaimer (spec AI-14)                                                        |
| **Toast / UndoBar**      | `undo`, `info`                                                   | visible (5 seconds), dismissed                                                                                                                                                    | Above the tab bar. The undo action is 48 pt. Announced to screen readers                                                                                                                           |
| **EmptyState**           | per screen                                                       | default                                                                                                                                                                           | An icon (`icon.lg`), one sentence and one primary action. No illustrations required                                                                                                                |
| **CodeInput**            | 6 cells                                                          | empty, focused cell, filled, error                                                                                                                                                | Tabular digits, a paste-friendly single field behind the cells, numeric keyboard for email codes                                                                                                   |
| **OnboardingSteps**      | 4 segments                                                       | done, current, upcoming                                                                                                                                                           | Paired with "Step 2 of 4" text                                                                                                                                                                     |
| **CompletionScreen**     | `listComplete`                                                   | shown once                                                                                                                                                                        | A check in a `primary` circle (`icon.lg`), a title, a member summary, and a primary and a ghost action                                                                                             |
| **PremiumBadge**         | `badge`                                                          | static                                                                                                                                                                            | `surfaceAlt` pill, `type.caption`. Marks Premium-only options. Never blocks reading                                                                                                                |
| **Skeleton**             | `row`, `card`                                                    | loading                                                                                                                                                                           | `surfaceAlt` blocks, no shimmer when Reduce Motion is on. Used after 300 ms of waiting                                                                                                             |

## 9. Accessibility rules

These apply to every screen and component. They come from spec section 6.4, and any change to them needs the spec changed first.

1. **Tap targets:** 44 × 44 pt is the platform minimum and a hard floor. The product standard is **48 × 48 pt** (spec NFR-A11Y-4), and list rows are at least 56 pt tall. Visual size can be smaller if the touch area (`hitSlop` or padding) reaches 48.
2. **Contrast:** WCAG 2.2 AA in light and dark mode. Text needs 4.5:1 (3:1 for large text at 24 pt and up, or 19 pt bold), and interface parts and focus rings need 3:1. Use only the pairs allowed in section 2.
3. **Dynamic type:** every screen works at the largest accessibility text size on both platforms. Layouts wrap and scroll instead of clipping; rows grow, and fixed heights are minimums only. Test at default, at the largest standard size, and at the largest accessibility size.
4. **Screen readers:** every interactive element has a translated label, a role and its state ("checked, by Alex"). The reading order follows the visual order, and changes such as sync updates and toasts are announced.
5. **Color is never the only signal:** allergens, checked state, errors and offline status also use text or an icon.
6. **One-handed reach:** the main action of each main screen sits in the bottom 40% of a 6.1-inch phone (spec NFR-A11Y-5).
7. **Motion:** respect Reduce Motion (section 6). Nothing flashes more than 3 times a second.
8. **Localization:**
   - **Layout:** layouts accept text up to 100% longer and mirror for right-to-left languages. Use `start`/`end` rather than `left`/`right`.
   - **Copy:** no text in images, and every string comes from the locale files (`CLAUDE.md`).

## 10. Theme file shape

This is for F-06. The shape is illustrative, and the values are the tokens above:

```ts
export const theme = {
  light: { color: { background: '#FAF7F2', surface: '#FFFFFF' /* … */ } },
  dark: { color: { background: '#1C1B19', surface: '#262421' /* … */ } },
  type: {
    screenTitle: { fontFamily: 'Fraunces_600SemiBold', fontSize: 30, lineHeight: 36 } /* … */,
  },
  space: { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 },
  radius: { sm: 8, control: 12, card: 16, sheet: 22, pill: 999 },
  motion: { fast: 150, base: 220, slow: 300 },
  layout: { tabBarClearance: 92, maxContentWidth: 640, minTarget: 48, minRowHeight: 56 },
} as const;
```

The current `src/constants/theme.ts` has keys from the Expo template (`backgroundElement`, `backgroundSelected`). F-06 replaces it.
