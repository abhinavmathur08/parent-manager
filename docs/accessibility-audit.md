# Accessibility and one-handed audit

Backlog L-02 (#103). Spec requirements: `NFR-A11Y-2` (largest text), `NFR-A11Y-3` (screen readers), `NFR-A11Y-5` (one-handed reach) and `NFR-A11Y-8` (interruptions), with `NFR-A11Y-1`, `-4`, `-6` and `-7` checked along the way.

Audited on 2026-11-26 at commit `7f699e5` (main), by code review of the shared components and the core Phase 1 screens, unit tests, and a release build on the iOS Simulator. Real-device checks that a simulator can't do are listed in section 5.

## 1. Scope

Core Phase 1 flows: sign-in and onboarding, recipes (list, detail, editor, import review), the planner (week, add sheet, entry actions, templates and history), the grocery list (items, add, details, export, shopping together), household and invites (members, invite sheet, join by code, settings, people), and subscriptions (Premium sheet, subscription status).

## 2. How it was checked

- **Shared components** (`src/components`): every interactive component's role, label, state, hint and touch target, and how text scales.
- **Screens:** every raw `Pressable` and pressable `Card` in `src/features`, every label that replaces its children, `numberOfLines`, fixed sizes, `left`/`right` styles, raw colors, and which forms keep a draft (`useDraftState`).
- **Tests:** the component tests in `__tests__/components` and the screen tests that query by role and accessible name.
- **iOS Simulator (iPhone 17 Pro, iOS 27.2):** a release build at the largest accessibility text size (AX5), in light and dark mode, with Maestro reading the accessibility tree. Only the signed-out screens were covered; see section 4.

## 3. Findings

### 3.1 Fixed

| ID  | Area                                             | Finding                                                                                                                                                                                                                                                                                      | Fix                                                                                                                                                                     |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1 | Planner, screen readers (NFR-A11Y-3, FR-PLAN-11) | **Blocker.** A meal in the week view is one button whose label is only the title and servings. A label replaces the children for VoiceOver and TalkBack, so the allergen warning inside the row ("Contains milk. Mia is allergic."), and the leftovers and baby-plate tags, were never read. | The row's label now includes the tags and every allergen warning. Test: `week-screen.test.tsx`.                                                                         |
| A-2 | Planner, screen readers (NFR-A11Y-3)             | Move, duplicate, leftovers and remove are only on a long-press. The hint mentioned it, but there was no screen-reader action.                                                                                                                                                                | The row offers "More actions" as an accessibility action (VoiceOver's actions rotor, TalkBack's actions menu), which opens the same menu. Test: `week-screen.test.tsx`. |
| A-3 | Premium sheet (FR-PAY-8)                         | After a purchase or restore, the "Premium is on" status appears at the top of the sheet's body while the body stays scrolled to the plans at the bottom, so on a small screen or at large text it's out of sight. Found by the Android end-to-end flows.                                     | Fixed in #216's PR: the sheet scrolls back to the top when its status changes.                                                                                          |
| A-4 | Planner, reach                                   | Stepping to another week scrolled the list to where today had been, so the week arrows left the screen after one tap and had to be scrolled back for the next.                                                                                                                               | Fixed in #216's PR: a week without today keeps its scroll position.                                                                                                     |
| A-5 | Tab screens, reach and touch                     | Tab screens padded only the end of their content, so mid-scroll a row could sit under the floating tab bar, where a tap opens a tab instead.                                                                                                                                                 | Fixed in #216's PR: the scrolling area ends at the bar's top edge (`useTabBarClearance`).                                                                               |

### 3.2 Passed

- **Roles, labels and state (NFR-A11Y-3):** `Button`, `IconButton`, `Checkbox`, `CheckboxRow`, `Chip`, `Switch`, `RadioOption`, `SegmentedControl`, `Stepper`, `TextField`, `ListRow`, `TopBar` and the tab bar all set a role, a translated label and their state (checked, selected, disabled, busy). `CheckboxRow` reads "checked, by Alex" and offers its details as an action. Icons are hidden from screen readers. Allergen notices are alerts outside lists. The labels are covered by `__tests__/components` and the screen tests.
- **Every raw `Pressable`** in `src/features` (calendar, Apple button, planner) has a role and a translated label.
- **Touch targets (NFR-A11Y-4):** the components use `layout.minTarget` (48) and `layout.minRowHeight` (56); chips and the segmented control reach 48 with `hitSlop`.
- **No meaning by color alone (NFR-A11Y-6):** allergen notices have an icon and text, checked items a checkmark, errors text.
- **Right-to-left:** no `left`/`right` margins, padding or positions, and no `textAlign: 'left'` in `src`. Directional icons mirror (`Icon`). Not run in an RTL locale, since the app has none yet.
- **Dark mode:** screens use theme tokens only; the only raw colors are Apple's required button colors. A unit test checks every color pair for WCAG AA in both modes (NFR-A11Y-1).
- **Motion (NFR-A11Y-7):** sheets, toasts and skeletons follow Reduce Motion.
- **Interrupted use (NFR-A11Y-8):** onboarding, the recipe editor, import and its review, and the event editor keep drafts that survive the app being killed. Sheets stay mounted while the app is in the background.

### 3.3 Deferred

| ID  | Area                                           | Finding                                                                                                                                                                                         | Why deferred, and the proposal                                                                                                                                                          |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | List and Recipes, reach (NFR-A11Y-5, PROPOSED) | With items on the list, "Add" is only a text action in the top bar, outside the bottom 40%. The same holds for adding a recipe once the library has recipes. Empty states have a bottom button. | Not a blocker: the action works, it's just a stretch. Needs a design decision: a pinned "Add an item" button above the tab bar, like the List's empty state.                            |
| D-2 | Short forms, interruptions (NFR-A11Y-8)        | The add-item, staple, person, invite-code, household-name and template-name sheets keep their values in memory only, so the OS killing the app loses them.                                      | These are one or two fields; the spec names longer forms. The person sheet (name, age band, allergies) is the one worth a draft next.                                                   |
| D-3 | Tab bar, largest text (NFR-A11Y-2)             | Tab labels are capped at 1.3× by design and truncate ("Househ…") on narrow screens.                                                                                                             | By design (design system section 3). iOS shows the large-content viewer only for UIKit tab bars, so a long-press preview would need a native module. Screen readers get the full label. |
| D-4 | Sign-in, largest text (NFR-A11Y-2)             | At AX5 the app name on the sign-in screen breaks mid-word ("Manag" / "er"). Nothing is clipped, and the screen scrolls.                                                                         | Cosmetic. Proposal: cap the display style's scale on that one title, or a smaller display size, once design picks.                                                                      |

## 4. Simulator results

- **Sign-in at AX5, light and dark:** every element is reachable by scrolling, nothing is clipped, the email field and error message stay readable, and the status bar follows the mode. The flows' own taps needed a scroll first at this size, which is expected ("content scrolls instead"). Apple's sign-in button keeps its own fixed text size; that's Apple's control.
- **Signed-in screens: not covered.** The release build ran against a local stack, and this machine's Docker had eight other stacks running, so the sign-in email timed out (`request_timeout` from Auth). The signed-in screens were reviewed in code only. They're the first item in section 5.

## 5. Still to check on real devices

- **Every signed-in core screen at AX5 in light and dark mode** on a simulator or device: Plan, the add sheet, List, Recipes and the editor, Household, members and the invite sheet, and the Premium sheet.
- **VoiceOver on an iPhone and TalkBack on an Android phone,** through every core flow: reading order, the actions rotor on plan entries and list items, and announcements (toasts, the Premium status, sync errors).
- **Android at the largest font and display size,** which the simulator pass doesn't cover.
- **One-handed reach** on a 6.1-inch phone held in one hand, for the main action of each tab.
- **Interrupted use:** a real OS kill (memory pressure) during onboarding, a recipe edit and an import review, on both platforms.
- **Switch Control and Voice Control** on iOS, at least once.

These need people with devices in the internal beta (#104), so #103 stays open until they're done.
