# Parent Manager: Phase 1 (MVP) product specification

Status: draft for the product owner's review, 2026-11-07.

How this relates to the other docs:

- [vision.md](vision.md) says what we're building and why. It's the source of truth, and this spec doesn't override it.
- This spec says exactly how Phase 1 should behave.
- [architecture.md](architecture.md) says how it's built.
- [backlog.md](backlog.md) breaks the work into items. Where this spec and the backlog differ, section 9 lists the difference.

**How to read this spec:**

- Requirements are numbered `FR-<area>-<n>` (functional) and `NFR-<area>-<n>` (non-functional). Each is a testable statement.
- **PROPOSED** marks anything not set by the vision or an approved decision. The product owner should confirm or change these.
- **ASSUMPTION** marks something I assumed to be true. If it's wrong, the requirement needs revisiting.
- User-facing text is referred to by purpose ("the invite-expired message"), never written out. All copy lives in the locale files (see `CLAUDE.md`).
- Decision IDs (`D-1` to `D-12`) refer to [decisions-needed.md](decisions-needed.md).

## 1. Overview and scope

### 1.1 What Phase 1 delivers

Phase 1 takes a two-parent household from an empty week to a finished, shared grocery list, and gets that list out of the app. It is also the first proof of the shared household model that every later module reuses.

Phase 1 is done when two partners can plan a week, share the list, and shop from it on iOS and Android in beta testing (vision, "Roadmap and MVP scope").

### 1.2 In scope

1. **Accounts:** email sign-in, Sign in with Apple, Google sign-in, biometric unlock, account deletion and data export.
2. **Households:** one household per user, partner invitations, roles (parent, family member and caregiver), household people (including children without accounts), and dietary and allergy profiles.
3. **Recipes:** manual recipes, a starter library, tags, scaling, and AI import from a web link, pasted text, a photo or a screenshot, always with a review step.
4. **Weekly planner:** breakfast, lunch, dinner, snacks and drinks; copy last week; portions per person, including baby plates; leftover links; saved week templates (Premium).
5. **Pantry:** staples hidden from the list, and "I already have this".
6. **Grocery list:** built automatically from the plan, merged by ingredient with normalized units, grouped by store section, shared in real time, usable offline, with manual additions.
7. **List export:** print or PDF, Apple Reminders (iOS), the share sheet and Copy as text.
8. **Purchase memory (foundation):** purchases are recorded from check-offs and "finish shopping", and frequently bought items are suggested when adding to the list. See section 9 for how this relates to the vision's roadmap.
9. **Notifications:** the weekly "plan your week" prompt, "list is ready", and "defrost tonight", with per-type controls and quiet hours, plus an in-app inbox.
10. **Free versus Premium:** two parents free; Premium adds caregiver and family seats, a larger AI import allowance, saved templates and full history. Moment-of-need upgrade prompts, a free trial, and restore purchases.
11. **Localization:** a localization-ready build in US English, with the data model and formatting supporting UK and Australian English and metric units.

### 1.3 Explicitly out of scope for Phase 1

These are in the vision but outside its MVP row:

- **Capture methods:** voice import and voice capture, widgets, lock-screen shortcuts, Siri and Google Assistant shortcuts, the share extension, and natural-language adds ("add bananas and diapers").
- **Scanning:** barcode scanning and receipt scanning.
- **Pantry depth:** pantry quantities, expiry tracking and running-low alerts.
- **Suggestions:** purchase recommendations ("you usually buy milk every 8 days") and "fill my week" suggestions.
- **List depth:** multiple lists, custom aisle order per store, and price and budget estimates.
- **Other:** email digests, the meal train and grocery gifting, the caregiver handoff brief, and the UK and Australia store launch (Phase 2).

### 1.4 Glossary

| Term               | Meaning                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account            | A person's sign-in identity. One account can belong to one household in Phase 1.                                                                                    |
| Household          | The shared space where plans, recipes, the pantry and the list live. It has a region, a locale, a unit system, a timezone and a week-start day.                     |
| Member             | An account that belongs to a household, with one role.                                                                                                              |
| Role               | What a member can do: **parent**, **family member** or **caregiver** (section 2).                                                                                   |
| Person             | Someone the household feeds, with or without an account, such as a baby. A person has an age band, and optionally diets and allergies.                              |
| Age band           | A coarse age group: expecting, 0 to 6 months, 6 to 12 months, toddler, preschool, older child or adult. Used instead of birth dates.                                |
| Recipe (meal)      | A dish with ingredient lines, steps, servings, times and tags. "Meal" is the user-facing word. A recipe belongs to a household, or to the starter library.          |
| Starter library    | A read-only set of recommended recipes, available to every household. "Save a copy" makes an editable household recipe.                                             |
| Ingredient         | A language-neutral catalog item (such as `ingredient.milk`) with names per locale, a store section, allergen codes and staple status. Households can add their own. |
| Ingredient line    | One line of a recipe: quantity, unit, ingredient and optional note, plus the original text.                                                                         |
| Unit               | A language-neutral unit with a dimension (mass, volume or count) and a conversion to a base unit (grams, millilitres or each). Regional sizes are separate units.   |
| Plan               | The household's entries for a week.                                                                                                                                 |
| Plan entry         | A recipe or free-text item in a day-and-slot, with servings, portions and an optional leftover link.                                                                |
| Slot               | A part of the day: breakfast, lunch, dinner, snack or drink.                                                                                                        |
| Week               | Seven days starting on the household's week-start day.                                                                                                              |
| Template           | A saved week of plan entries by weekday and slot (Premium).                                                                                                         |
| Grocery list       | The household's shopping list for a week. Phase 1 has one per household.                                                                                            |
| List item          | One line of the list: an ingredient or free text, a merged quantity, a section and a checked state.                                                                 |
| Generated item     | A list item built from the plan. A **manual item** is one a member added by hand.                                                                                   |
| User-modified item | A generated item whose quantity, unit or name a member changed.                                                                                                     |
| Pantry             | The household's record of what's at home: **staples** and **have** items.                                                                                           |
| Staple             | An ingredient assumed to be at home (salt, oil, flour). It's left off the list unless turned off.                                                                   |
| "Have" item        | An ingredient a member marked "I already have this" for the current week.                                                                                           |
| Store section      | A language-neutral grouping such as produce or dairy, used to group the list.                                                                                       |
| Purchase event     | A record that an item was bought, from a check-off or "finish shopping".                                                                                            |
| Entitlement        | The household's subscription status: Free or Premium. Premium covers every member.                                                                                  |
| AI import          | Turning a link, text or image into a draft recipe with AI.                                                                                                          |
| Draft              | An AI import result that hasn't been saved. A member must review it first.                                                                                          |
| Allowance          | The number of AI imports a household may use in a calendar month.                                                                                                   |
| Region             | US, GB or AU. Sets the default units, locale and store sections.                                                                                                    |

### 1.5 Later phases (names only)

These modules are out of Phase 1. Phase 1's household layer (members, roles, sharing, sync, notifications and entitlements) and language-neutral data must not block them:

- Household Supplies
- Shared Calendar and Appointments
- Tasks and Chores
- Documents and Records
- Baby Tracking (integrations)
- Meal train and grocery gifting

## 2. Users and roles

### 2.1 Roles

| Role              | Who                                                                           | Tier         | Count per household                              |
| ----------------- | ----------------------------------------------------------------------------- | ------------ | ------------------------------------------------ |
| **Parent**        | The two partners running the household, with full access and co-equal rights. | Free         | At least 1, at most 2                            |
| **Family member** | A grandparent or relative who helps with meals and shopping.                  | Premium seat | Up to 6, PROPOSED (combined with caregivers)     |
| **Caregiver**     | A nanny, babysitter or au pair: limited, task-focused access.                 | Premium seat | Up to 6, PROPOSED (combined with family members) |

Rules:

- **Phase 1 is one household per account (ASSUMPTION).** Joining another household means leaving the current one. Multiple households per account is a later decision.
- **Household people need no seat.** People without accounts, such as a baby, are free and limited to 12 per household (PROPOSED).

### 2.2 Permissions matrix

Key:

- ✓ allowed
- ✗ not allowed
- **P** only while the household has Premium
- **R** read only

| #                | Action                                                               | Parent                                                         | Family member | Caregiver | Tier                                                     |
| ---------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- | ------------- | --------- | -------------------------------------------------------- |
| **Account**      |                                                                      |                                                                |               |           |                                                          |
| 1                | Sign in or out, manage own profile and biometric lock                | ✓                                                              | ✓             | ✓         | Free                                                     |
| 2                | Delete own account                                                   | ✓                                                              | ✓             | ✓         | Free                                                     |
| 3                | Set own notification preferences and quiet hours                     | ✓                                                              | ✓             | ✓         | Free                                                     |
| **Household**    |                                                                      |                                                                |               |           |                                                          |
| 4                | Create a household (during onboarding)                               | ✓                                                              | —             | —         | Free                                                     |
| 5                | Edit household name, region, units, timezone and week start          | ✓                                                              | ✗             | ✗         | Free                                                     |
| 6                | Invite a second parent                                               | ✓                                                              | ✗             | ✗         | Free                                                     |
| 7                | Invite a family member or caregiver                                  | ✓                                                              | ✗             | ✗         | Premium                                                  |
| 8                | Revoke a pending invitation                                          | ✓                                                              | ✗             | ✗         | Free                                                     |
| 9                | Change a member's role                                               | ✓                                                              | ✗             | ✗         | Free (changes to family or caregiver roles need Premium) |
| 10               | Remove a member                                                      | ✓                                                              | ✗             | ✗         | Free                                                     |
| 11               | Leave the household                                                  | ✓ (not the last parent, see FR-HH-14)                          | ✓             | ✓         | Free                                                     |
| 12               | Delete the household                                                 | ✓ (with both parents' confirmation if there are two, PROPOSED) | ✗             | ✗         | Free                                                     |
| 13               | Add, edit or remove household people and their age bands             | ✓                                                              | ✓             | ✗ (R)     | Free                                                     |
| 14               | Edit diets and allergies                                             | ✓                                                              | ✓             | ✗ (R)     | Free, always                                             |
| **Recipes**      |                                                                      |                                                                |               |           |                                                          |
| 15               | View household recipes and the starter library                       | ✓                                                              | ✓             | ✓         | Free                                                     |
| 16               | Create, edit or delete household recipes                             | ✓                                                              | ✓             | ✗         | Free                                                     |
| 17               | Save a copy of a starter recipe                                      | ✓                                                              | ✓             | ✗         | Free                                                     |
| 18               | AI import within the allowance                                       | ✓                                                              | ✓             | ✗         | Free allowance, larger with Premium                      |
| **Planner**      |                                                                      |                                                                |               |           |                                                          |
| 19               | View the plan                                                        | ✓                                                              | ✓             | ✓         | Free                                                     |
| 20               | Add, edit, move or remove plan entries; set portions; link leftovers | ✓                                                              | ✓             | ✗         | Free                                                     |
| 21               | Copy last week                                                       | ✓                                                              | ✓             | ✗         | Free                                                     |
| 22               | Save or apply a week template                                        | ✓                                                              | ✓             | ✗         | Premium                                                  |
| 23               | View plans older than the free history window                        | ✓                                                              | ✓             | ✓         | Premium                                                  |
| **Pantry**       |                                                                      |                                                                |               |           |                                                          |
| 24               | Manage staples                                                       | ✓                                                              | ✓             | ✗         | Free                                                     |
| 25               | Mark "I already have this" on the list                               | ✓                                                              | ✓             | ✓         | Free                                                     |
| **Grocery list** |                                                                      |                                                                |               |           |                                                          |
| 26               | View the list                                                        | ✓                                                              | ✓             | ✓         | Free                                                     |
| 27               | Check off or uncheck items                                           | ✓                                                              | ✓             | ✓         | Free                                                     |
| 28               | Add manual items; edit quantities; delete items                      | ✓                                                              | ✓             | ✓         | Free                                                     |
| 29               | Regenerate the list from the plan                                    | ✓                                                              | ✓             | ✗         | Free                                                     |
| 30               | Finish shopping                                                      | ✓                                                              | ✓             | ✓         | Free                                                     |
| 31               | View lists older than the free history window                        | ✓                                                              | ✓             | ✓         | Premium                                                  |
| **Export**       |                                                                      |                                                                |               |           |                                                          |
| 32               | Print or PDF, Apple Reminders, share or copy                         | ✓                                                              | ✓             | ✓         | Free, always                                             |
| **Subscription** |                                                                      |                                                                |               |           |                                                          |
| 33               | View subscription status                                             | ✓                                                              | ✓ (R)         | ✗         | Free                                                     |
| 34               | Start a trial, subscribe, manage or restore purchases                | ✓                                                              | ✗             | ✗         | Free                                                     |
| **Privacy**      |                                                                      |                                                                |               |           |                                                          |
| 35               | Export household data                                                | ✓                                                              | ✗             | ✗         | Free, always                                             |
| 36               | Export own account data                                              | ✓                                                              | ✓             | ✓         | Free, always                                             |

When Premium lapses (FR-PAY-9):

- Family members and caregivers keep their membership rows but lose access to the household until Premium returns.
- Parents keep everything free parents have. Premium-only data, such as templates and older history, is kept but hidden, and stays exportable.

## 3. Functional requirements

### 3.0 Conventions for this section

**Analytics events:**

- Event names are `snake_case`, in the past tense.
- Properties hold only IDs, counts, durations and fixed values. They never hold names, emails, free text, recipe or list content, or children's details (NFR-SEC-6).
- Every event automatically carries `household_id`, `role`, `tier`, `platform`, `app_version`, `locale` and `region`.
- Events are queued offline and sent when the device is back online.

**Offline:** unless a requirement says otherwise, every action works offline and syncs later (section 6.2).

### 3.1 Accounts and auth (AUTH)

**User stories**

- As a parent, I want to sign up with my email or an Apple or Google account in under a minute, so that I can start planning straight away.
- As a parent, I want the app to stay signed in and optionally lock with Face ID, so that it's quick to open but safe if someone else picks up my phone.
- As any member, I want to delete my account from inside the app, so that I stay in control of my data.

**Requirements**

- **FR-AUTH-1:** The sign-in screen offers three methods: email, Sign in with Apple and Google sign-in. Sign in with Apple is shown on both platforms.
- **FR-AUTH-2:** Email sign-in sends a 6-digit one-time code, valid for 10 minutes (PROPOSED), and the same email contains a magic link as an alternative. Entering a correct code signs the user in. After 5 wrong codes, the code is invalidated (PROPOSED).
- **FR-AUTH-3:** The same email address always maps to one account, whichever method is used. A verified Apple or Google email that matches an existing account signs into that account instead of creating a duplicate.
- **FR-AUTH-4:** On first sign-in, a profile is created with a display name: taken from Apple or Google if provided, otherwise asked for in onboarding. The locale comes from the device.
- **FR-AUTH-5:** The session persists across app restarts. It's stored encrypted on the device and refreshed automatically. The user stays signed in until they sign out, delete the account, or the refresh token is revoked.
- **FR-AUTH-6:** Biometric unlock is off by default. When it's on, opening the app after it has been in the background for longer than the lock timeout requires Face ID, Touch ID or a fingerprint, with the device passcode as fallback. The default timeout is 5 minutes (PROPOSED), and choices are immediately, 1, 5 or 15 minutes.
- **FR-AUTH-7:** Signing out deletes the local session, the encrypted local copy of household data and the push token registration for that device.
- **FR-AUTH-8:** Signing in on a new device downloads the household's data and shows the Plan tab, with a loading state that lasts at most 5 seconds on a 4G connection for a household with 200 recipes (PROPOSED).

**Acceptance criteria**

- **Email sign-up:**
  - **Given** a new user on the sign-in screen
  - **When** they enter their email and the 6-digit code they received
  - **Then** they're signed in and taken to onboarding, and `signed_up` is recorded with `method=email`.
- **Apple account matches an email account:**
  - **Given** an existing account created with email
  - **When** the same person uses Sign in with Apple with the same verified email
  - **Then** they sign into the existing account and no second account is created.
- **Biometric lock:**
  - **Given** biometric unlock is on and the app has been in the background for more than 5 minutes
  - **When** the user opens the app
  - **Then** a biometric prompt appears before any household data is visible.

**Edge cases and error states**

- **Offline at sign-in:** sign-in and sign-up need a network connection. Offline, the screen shows the offline message, and the buttons stay disabled until a connection returns.
- **Wrong or expired code:** shows the invalid-code message and a "send a new code" action, limited to once every 30 seconds (PROPOSED).
- **Email not received:** the code screen offers "resend" and "use a different email".
- **The user cancels Apple or Google sign-in:** they return to the sign-in screen with no error message.
- **Apple "Hide My Email" relay addresses** are treated as normal emails. Invitations sent by email to a relay address may not arrive, so invite codes are the fallback (FR-HH-4).
- **Biometrics unavailable or changed:** the app falls back to the device passcode. If there's no passcode either, biometric lock is turned off with a notice.

**Analytics events**

| Event                    | Properties                              |
| ------------------------ | --------------------------------------- |
| `sign_in_started`        | `method` (`email`, `apple` or `google`) |
| `signed_up`              | `method`                                |
| `signed_in`              | `method`, `is_new_device`               |
| `sign_in_failed`         | `method`, `error_code`                  |
| `signed_out`             | none                                    |
| `biometric_lock_changed` | `enabled`, `timeout_minutes`            |

### 3.2 Onboarding (ONB)

**User stories**

- As a new parent, I want setup to take under a minute and ask only what matters, so that I can get to planning while the baby naps.
- As an expecting parent, I want the app to know I'm expecting, so that it suits my stage.
- As a partner who was invited, I want to skip household setup and join my partner's household directly.

**Requirements**

- **FR-ONB-1:** After first sign-in, a user with no household sees a choice: "create a household" or "join with an invite". A user who opened an invite link goes straight to joining (FR-HH-5).
- **FR-ONB-2:** Creating a household takes at most 4 steps, each one screen, with every step except the first skippable:
  1. Household name, prefilled from the user's name.
  2. Region (US, GB or AU), prefilled from the device's region. It sets the locale, unit system, store-section order, week start and currency.
  3. "Who are you feeding?": adults (prefilled with the user, plus their partner if known), and children by age band, including "expecting".
  4. Allergies and diets for the people entered, from fixed codes, showing the not-medical-advice disclaimer (FR-HH-12).
- **FR-ONB-3:** The default week start is Sunday for US and Monday for GB and AU (PROPOSED). The timezone comes from the device. Both can be changed in settings.
- **FR-ONB-4:** Onboarding never asks for an exact birth date. For "expecting", it asks for the due month only (PROPOSED; decision D-6).
- **FR-ONB-5:** When onboarding finishes, the user lands on the Plan tab for the current week. An empty state offers two next steps: "add your first meal" and "invite your partner".
- **FR-ONB-6:** The default staples for the region are added to the pantry automatically (FR-PAN-1). No setup screen is shown for them.
- **FR-ONB-7:** If onboarding is interrupted, for example when the app is killed, the user resumes at the step they left, with answers kept.
- **FR-ONB-8:** Notification permission is not requested during onboarding. It's requested the first time the user turns on a notification type or finishes their first plan (FR-NOT-2).

**Acceptance criteria**

- **Completing onboarding:**
  - **Given** a newly signed-up user
  - **When** they choose to create a household, accept the defaults and add one child aged 6 to 12 months
  - **Then** a household exists with region, locale, units, timezone and week start set, two people (the user and the child) exist, and the Plan tab for the current week is shown within 4 screens.
- **Resuming:**
  - **Given** a user who closed the app on step 3
  - **When** they reopen it
  - **Then** they return to step 3 with steps 1 and 2 kept.

**Edge cases and error states**

- **Offline:** creating the household needs a network connection, so the household ID is confirmed on the server. If the user goes offline mid-flow, answers are kept, and the last step shows the offline message with a retry.
- **The device region isn't US, GB or AU:** default to US, and show all three options (ASSUMPTION: only these three regions are supported in Phase 1).
- **An invited user starts creating a household by mistake:** step 1 shows a "have an invite?" link to the join flow.

**Analytics events**

| Event                       | Properties                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `onboarding_started`        | `entry` (`create` or `join`)                                                          |
| `onboarding_step_completed` | `step`, `skipped`                                                                     |
| `household_created`         | `region`, `adults_count`, `children_count`, `has_expecting`, `allergy_profiles_count` |
| `onboarding_completed`      | `duration_seconds`                                                                    |

### 3.3 Households and partner invitations (HH)

**User stories**

- As a parent, I want to invite my partner with a link or a short code, so that we share one plan and one list without passing my phone around.
- As a parent with Premium, I want to invite a grandparent or a nanny with limited access, so that they can help with the shopping without changing our plans.
- As a parent, I want to remove someone or cancel an invitation, so that I control who sees our family's information.

**Requirements**

- **FR-HH-1:** A parent can create an invitation for a role. The **parent** role is free while the household has fewer than 2 parents. The **family member** and **caregiver** roles need Premium, and a free household sees the upgrade prompt instead (FR-PAY-4).
- **FR-HH-2:** An invitation produces both a link and a 6-character code. The code uses only uppercase letters and digits that can't be confused with each other (no 0, O, 1 or I). Both are single-use and expire after 7 days.
- **FR-HH-3:** The invite can be shared through the share sheet, with the share text referring to the invite purpose and containing the link and code. Phase 1 sends no invitation email by default (PROPOSED). The Resend email is used only if the parent enters an email address.
- **FR-HH-4:** The join screen accepts a code typed in any case, ignoring spaces.
- **FR-HH-5:** Opening an invite link:
  - **App installed:** opens the join screen.
  - **App not installed:** a web page links to the app store. After installing and signing in, the user is shown the join screen with the code prefilled, if the platform passes it through. Otherwise they're asked to enter the code (ASSUMPTION: deferred deep linking isn't guaranteed).
- **FR-HH-6:** The join screen shows the household name, the inviter's display name and the role before the user accepts.
- **FR-HH-7:** Accepting checks four things on the server: the invite is valid, it isn't expired or revoked, the seat limit isn't exceeded (2 parents; the Premium seat cap), and the user isn't already in another household. Accepting makes the user a member, and they see the household's plan within 5 seconds online.
- **FR-HH-8:** A user already in another household is asked to leave it first. If they're the only member there, leaving deletes that household, after a confirmation that names what will be deleted.
- **FR-HH-9:** Parents see pending invitations, with role and expiry date, and can revoke any of them. A revoked or expired invite can't be accepted.
- **FR-HH-10:** Parents see all members with role and joined date, and can change a role (within the seat rules) or remove a member. A removed member loses access immediately on the server, and their device clears household data at its next sync.
- **FR-HH-11:** Household people (section 1.4) can be added, edited and removed by parents and family members. Each has a display name (a nickname is fine), an age band and an optional linked member.
- **FR-HH-12:** Each person can have diets (such as vegetarian) and allergies, chosen from fixed codes. The allergen codes cover the US major allergens; the UK and EU 14 are in the data for later. The not-medical-advice disclaimer is shown on every screen that edits or displays allergies.
- **FR-HH-13:** When a member makes a change, other members' devices show it within 2 seconds at the 95th percentile when both are online (NFR-PERF-3).
- **FR-HH-14:** The last parent can't leave the household. They must either promote another member to parent or delete the household.
- **FR-HH-15:** Only parents can change household settings (name, region, units, timezone and week start). Changing the region or units updates how quantities are displayed, without changing stored data.

**Acceptance criteria**

- **Partner joins by code:**
  - **Given** parent A has created a parent invite
  - **When** partner B, signed in with no household, enters the code
  - **Then** B is shown the household and role, accepts, becomes a parent, and sees A's plan and list. `invite_accepted` is recorded.
- **Third parent rejected:**
  - **Given** a free household with 2 parents
  - **When** a parent tries to invite another parent
  - **Then** the action isn't available, with the reason shown. A direct server call to accept such an invite is rejected.
- **Revoked invite:**
  - **Given** an invite that was revoked
  - **When** someone enters its code
  - **Then** they see the invite-no-longer-valid message, with a suggestion to ask for a new invite.
- **Removed member:**
  - **Given** caregiver C is removed
  - **When** C's device next syncs
  - **Then** C sees the removed-from-household message, the household's data is gone from C's device, and C returns to the create-or-join screen.

**Edge cases and error states**

- **Expired invite:** shows the expired message, and tells the inviter that it expired (in-app only).
- **Invite used twice:** the second use fails with the already-used message.
- **Both partners create separate households before inviting:** joining requires one of them to leave theirs (FR-HH-8). If the leaving partner's household has data, they're offered a data export first (PROPOSED; merging households is out of scope).
- **Offline:** creating, accepting and revoking invitations need a network connection. Offline, the actions are disabled with the offline message. Viewing members works offline from cached data.
- **Premium lapses with caregivers present:** the caregivers lose access (FR-PAY-9). Pending family and caregiver invitations are suspended and can't be accepted until Premium returns.
- **Two parents change the same person's allergies at the same time:** each allergy code is its own row, so additions from both are kept. Removing a code wins over a simultaneous add of the same code (PROPOSED, for safety visibility: show the "updated by" hint).

**Analytics events**

| Event                     | Properties                                                                    |
| ------------------------- | ----------------------------------------------------------------------------- |
| `invite_created`          | `role`, `share_method` (`share_sheet`, `copy` or `email`)                     |
| `invite_opened`           | `via` (`link` or `code`)                                                      |
| `invite_accepted`         | `role`, `via`, `hours_since_created`                                          |
| `invite_failed`           | `reason` (`expired`, `revoked`, `used`, `seat_limit` or `in_other_household`) |
| `invite_revoked`          | `role`                                                                        |
| `member_removed`          | `role`                                                                        |
| `member_role_changed`     | `from_role`, `to_role`                                                        |
| `person_added`            | `kind`, `age_band`                                                            |
| `dietary_profile_updated` | `allergy_count`, `diet_count`                                                 |

### 3.4 Recipes and meals (REC)

**User stories**

- As a parent, I want useful meals in the app on day one, so that I can plan a week before I've added anything.
- As a parent, I want to add a family recipe by hand quickly, one-handed, so that our regular meals are in the planner.
- As a parent, I want to filter by tags like "no-cook" or "one-handed", so that I find meals that fit a newborn week.
- As a parent, I want to scale a recipe to a different number of servings, so that the grocery quantities are right.

**Requirements**

- **FR-REC-1:** The Recipes tab shows two groups: the household's recipes, sorted by most recently used then name, and the starter library. Each card shows the title, total time, tags and a "used in plan" indicator.
- **FR-REC-2:** The starter library contains 40 to 60 recipes (PROPOSED; content decision D-8). Every starter recipe uses catalog ingredient and unit IDs and has at least one new-parent tag.
- **FR-REC-3:** A starter recipe is read-only. "Save a copy" creates an editable household recipe that keeps a link to the original.
- **FR-REC-4:** Members with write access can create a recipe with:
  - a title (required, at most 120 characters)
  - servings (required, 1 to 24, default 4, PROPOSED)
  - optional prep and cook times
  - tags
  - ingredient lines (at most 100, PROPOSED)
  - steps (at most 50, PROPOSED)
  - optional notes and a source link
- **FR-REC-5:** Each ingredient line has an optional quantity, an optional unit and a required ingredient:
  - **Quantities:** fractions such as "1/2" and mixed numbers such as "1 1/2" are accepted, and decimals follow the locale.
  - **Units:** the picker shows the household's unit system first.
  - **Ingredients:** the picker searches catalog names and synonyms in the household's locale. If there's no match, "add as new ingredient" creates a household ingredient with a section picked by the user (default: other).
- **FR-REC-6:** A line without a unit is a count when the ingredient's default dimension is count (for example "2 onions"). Otherwise it's treated as "to taste" and isn't added to the list (PROPOSED, see 5.1).
- **FR-REC-7:** The tag set is fixed in Phase 1: no-cook, one-handed, freezer-friendly, batch-prep, quick (total time 20 minutes or less, PROPOSED), kid-friendly, toddler, baby-led weaning, and needs-defrosting. Users can't create tags in Phase 1 (PROPOSED).
- **FR-REC-8:** The recipe detail screen shows ingredients at the recipe's servings, with a servings stepper (1 to 24) that rescales quantities on screen without changing the saved recipe (section 5.1 rules).
- **FR-REC-9:** If a recipe contains an ingredient whose allergen codes match an allergy of any household person, the detail screen shows an allergen notice naming the allergen (from translations) and the disclaimer. This is always free.
- **FR-REC-10:** Search on the Recipes tab matches titles, ingredient names in the household's locale, and tags. It works offline, and results appear within 200 ms for 500 recipes (NFR-PERF-5).
- **FR-REC-11:** Deleting a recipe that's used in current or future plan entries asks for confirmation and shows how many entries use it. Those entries keep a snapshot of the title as free text, so the plan isn't left with gaps (PROPOSED).
- **FR-REC-12:** Recipes, ingredient lines and steps sync between members. An edit made offline appears on the partner's device after both reconnect (6.2).

**Acceptance criteria**

- **Manual recipe:**
  - **Given** a parent creating a recipe
  - **When** they add "2 cups milk" by choosing 2, cup and milk, and save
  - **Then** the recipe is saved with `ingredient.milk`, `unit.cup_us` and a base quantity of 473.2 ml, and appears on the partner's device within 2 seconds.
- **Scaling:**
  - **Given** a recipe for 4 servings with "2 cups milk"
  - **When** the servings stepper is set to 6
  - **Then** the line shows "3 cups milk", formatted by the locale.
- **Allergen notice:**
  - **Given** the household has a person with a peanut allergy
  - **When** a recipe containing `ingredient.peanut_butter` is opened
  - **Then** the allergen notice and the disclaimer are visible.

**Edge cases and error states**

- **Empty state:** with no household recipes, the household group shows an empty state with two actions: "add a meal" and "import a meal". The starter library is still shown.
- **Unknown ingredient typed:** "add as new ingredient" creates a household ingredient. It merges on the list only with itself (by ID), never with a catalog item that has a similar name.
- **Two members edit the same recipe offline:** the last edit to reach the server wins for the whole recipe (architecture section 5). The other member sees the "updated by" hint on the recipe.
- **A recipe was deleted by the partner while another member is viewing it:** the screen shows the deleted message and goes back.
- **Very long text:** titles and steps wrap without truncating on the detail screen, and truncate with an ellipsis on cards.

**Analytics events**

| Event                   | Properties                                                           |
| ----------------------- | -------------------------------------------------------------------- |
| `recipe_created`        | `source_type`, `ingredient_count`, `step_count`, `tag_count`         |
| `recipe_edited`         | `source_type`                                                        |
| `recipe_deleted`        | `plan_entries_affected`                                              |
| `starter_recipe_copied` | `recipe_id`                                                          |
| `recipe_scaled`         | `from_servings`, `to_servings`                                       |
| `recipe_search_used`    | `results_count`, `has_tag_filter`                                    |
| `allergen_notice_shown` | `surface` (`recipe`, `import_review` or `planner`), `allergen_count` |

### 3.5 AI recipe import (AI)

**User stories**

- As a parent, I want to paste a link to a recipe and get it into the app without typing, so that adding meals takes seconds.
- As a parent, I want to take a photo of a cookbook page or a screenshot, so that recipes from anywhere can be planned.
- As a parent of a child with allergies, I want any possible allergens highlighted before I save, so that I don't plan an unsafe meal by mistake.

**Requirements**

- **FR-AI-1:** Import accepts four inputs in Phase 1: a web link, pasted text, a camera photo, or an image from the photo library (including screenshots). One image per import in Phase 1 (PROPOSED).
- **FR-AI-2:** Before starting, the import screen shows the allowance remaining this month: `used of total`.
- **FR-AI-3:** An import needs a network connection. Offline, the import actions are disabled, with the offline message.
- **FR-AI-4:** Every import produces a **draft**. Nothing is saved to recipes until a member confirms on the review screen (section 7).
- **FR-AI-5:** The review screen shows the title, servings, times, ingredient lines and steps, all editable, plus suggested tags and any detected allergens. Each ingredient line shows the original text alongside the parsed quantity, unit and ingredient.
- **FR-AI-6:** Lines with a confidence below 0.7 (PROPOSED), and lines with an unmatched ingredient, are highlighted. The save button stays enabled; highlights are guidance, not blockers (PROPOSED). Unmatched ingredients become household ingredients on save.
- **FR-AI-7:** If a parsed ingredient's allergen codes match an allergy of any household person, or the model flags a possible allergen, the review screen shows an allergen notice at the top, marks the affected lines, and shows the disclaimer. The notice can't be dismissed before saving, but it doesn't block saving.
- **FR-AI-8:** A successful import that's saved or discarded counts as one import against the allowance. Failed imports don't count. Link imports parsed from embedded schema.org recipe data, without calling the AI model, don't count (PROPOSED; architecture section 6).
- **FR-AI-9:** Allowances, per household per calendar month in the household's timezone:
  - **Free:** 5 imports (PROPOSED; D-9).
  - **Premium:** 100 imports (PROPOSED; D-9).
  - **Per member, any tier:** at most 10 imports an hour (PROPOSED).
- **FR-AI-10:** When the allowance is used up, the import screen shows the allowance-reached message, with the reset date and, for free households, the upgrade prompt (FR-PAY-4). Manual recipe creation is always available.
- **FR-AI-11:** An import that hasn't finished within 45 seconds (PROPOSED) fails with the timeout message and is retryable. The pasted input is kept, so retrying needs no retyping.
- **FR-AI-12:** Images are compressed on the device to 1600 pixels on the long edge (PROPOSED) before upload. The server deletes them after processing, and always within 24 hours.
- **FR-AI-13:** If parsing fails or returns no ingredients, the user can "enter manually instead", which opens the recipe editor prefilled with any title and the raw text in notes.
- **FR-AI-14:** Every import request includes the household's locale and region (section 7).
- **FR-AI-15:** A saved imported recipe records its source type and, for links, its source URL, which is shown on the recipe detail screen.
- **FR-AI-16:** Caregivers can't import (section 2).

**Acceptance criteria**

- **Link import:**
  - **Given** a free household with 3 imports left
  - **When** a parent pastes a recipe link
  - **Then** within 20 seconds (p95) they see a review screen with the parsed recipe, and on saving the recipe appears in the household's recipes.
  - If the page had schema.org recipe data, the allowance still shows 3. Otherwise it shows 2.
- **Low confidence:**
  - **Given** an import where 2 lines have confidence below 0.7
  - **When** the review screen opens
  - **Then** those 2 lines are highlighted, and the user can edit them before saving.
- **Allowance reached:**
  - **Given** a free household that has used 5 imports this month
  - **When** a parent opens import
  - **Then** the import actions are replaced by the allowance-reached message, the reset date and the upgrade prompt.
- **Discard:**
  - **Given** a review screen
  - **When** the user discards
  - **Then** no recipe is created, and the allowance reflects one used import.

**Edge cases and error states**

- **Link isn't a recipe:** the not-a-recipe message is shown, with "enter manually instead". It doesn't count against the allowance.
- **Link can't be fetched** (paywalled, blocked or timed out): the could-not-read-link message is shown, with "paste the text instead". It doesn't count.
- **Image too dark or blurry, or no text found:** the could-not-read-image message is shown, with "retake". It doesn't count.
- **Recipe in a language other than the household's:** the draft is parsed as is, and the title and steps keep the original language. Ingredients are matched where possible (ASSUMPTION: Phase 1 targets English sources).
- **Quantity missing in the source:** the line is saved with no quantity (FR-REC-6) and marked low-confidence. The AI must not invent a quantity (section 7).
- **The app goes to the background during an import:** the import continues on the server. Reopening the app shows the result, or a "your import is ready" in-app notice, for up to 30 minutes (PROPOSED).
- **Allowance reached between start and finish** (a concurrent import by the partner): the server reserves allowance at the start (architecture section 6), so a started import always finishes.

**Analytics events**

| Event                  | Properties                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_import_started`    | `input_type` (`url`, `text`, `photo` or `screenshot`), `allowance_remaining`                                                                        |
| `ai_import_completed`  | `input_type`, `parser` (`schema_org` or `llm`), `duration_ms`, `ingredient_count`, `low_confidence_count`, `unmatched_count`, `allergen_flag_count` |
| `ai_import_failed`     | `input_type`, `error_code`                                                                                                                          |
| `ai_import_saved`      | `input_type`, `lines_edited_count`, `seconds_in_review`                                                                                             |
| `ai_import_discarded`  | `input_type`, `seconds_in_review`                                                                                                                   |
| `ai_allowance_reached` | `tier`                                                                                                                                              |

### 3.6 Weekly planner (PLAN)

**User stories**

- As a parent, I want to see the whole week and fill dinners in a couple of minutes, so that we stop deciding what to eat at 6 p.m.
- As a parent, I want to copy last week, so that a good week can be reused with one tap.
- As a parent of a toddler, I want separate portions and a baby plate, so that quantities on the list are right for our family.
- As a parent, I want to mark tomorrow's lunch as leftovers of tonight's dinner, so that I cook once and the list accounts for it.

**Requirements**

- **FR-PLAN-1:** The Plan tab shows one week, starting on the household's week-start day, as 7 days with 5 slots each: breakfast, lunch, dinner, snack and drink. Slots without entries stay compact. Today is highlighted and scrolled into view.
- **FR-PLAN-2:** Members move between weeks by swiping or using previous and next controls, and "today" returns to the current week. Past weeks inside the history window (FR-PAY-6) can be viewed; older weeks show the history upgrade prompt.
- **FR-PLAN-3:** Tapping a slot opens an add sheet with recent recipes, search across household and starter recipes, and free text (such as "takeout"). Adding takes at most 2 taps after the search result appears.
- **FR-PLAN-4:** A slot can hold more than one entry, for example a main and a side.
- **FR-PLAN-5:** Each entry has servings, defaulting to the number of people in the household, counting adults as 1 and children by age band (section 5.3). Members can change servings or set portions per person.
- **FR-PLAN-6:** Portions per person:
  - Each person's portion can be set to 0 (not eating), ½, 1 or 2. ½ is the default for toddler and preschool (PROPOSED).
  - People in the 6 to 12 month band can get a "baby plate", meaning the baby eats from the same dish. A baby plate counts as ¼ serving (PROPOSED) and is labelled on the entry.
  - People in the 0 to 6 month band and "expecting" are excluded by default.
- **FR-PLAN-7:** Long-pressing an entry lets the user move it to another day or slot, duplicate it, mark it as leftovers, or remove it. Removing it shows an undo option for 5 seconds (PROPOSED).
- **FR-PLAN-8:** "Leftovers of": an entry can be linked to an earlier entry in the same or the previous week. The linked entry adds nothing to the grocery list, and the original's servings increase by the linked entry's servings for list purposes (section 5.3).
- **FR-PLAN-9:** "Copy last week" copies all entries from the previous week to the same weekday and slot of the current week, adjusting dates. If the current week has entries, the user chooses "add to this week" or "replace this week". "Replace" shows an undo option.
- **FR-PLAN-10:** Saved week templates (Premium):
  - A parent or family member can save the current week as a named template, of up to 60 characters.
  - Applying a template to a week works like copy, with the same add-or-replace choice.
  - Free households see the upgrade prompt when tapping "save as template".
- **FR-PLAN-11:** Plan changes sync to other members' devices within 2 seconds (p95) when online. If a planned recipe contains an allergen for a person whose portion is above 0, the entry shows an allergen marker (FR-REC-9).
- **FR-PLAN-12:** "Week planned" means 5 or more dinner entries in the week (PROPOSED). It's the threshold for the activation metric and for the "list is ready" prompt (FR-NOT-4).

**Acceptance criteria**

- **Plan a week:**
  - **Given** a household with 10 recipes
  - **When** a parent adds a dinner to each of 7 days
  - **Then** it takes at most 21 taps in total (PROPOSED target: 3 per day), every entry appears on the partner's device within 2 seconds, and `week_planned` is recorded once.
- **Copy last week:**
  - **Given** last week has 9 entries and this week is empty
  - **When** a parent taps "copy last week"
  - **Then** this week has the same 9 entries on the same weekdays and slots, and the grocery list updates (FR-LIST-3).
- **Leftovers:**
  - **Given** Monday dinner (chili, 4 servings) and Tuesday lunch linked as leftovers with 2 servings
  - **When** the list is generated
  - **Then** chili's ingredients are scaled to 6 servings, and Tuesday lunch adds no separate items.

**Edge cases and error states**

- **Empty week:** shows the empty state, with "add a meal", "copy last week" (if last week had entries) and "apply a template" (Premium).
- **Both partners add a meal to the same slot offline:** both entries are kept, because a slot can hold several entries (FR-PLAN-4). Each partner sees the other's entry after syncing.
- **One partner moves an entry while the other deletes it:** the delete wins, because deletes are recorded as tombstones (architecture section 5).
- **The planned recipe was deleted:** the entry shows the snapshot title as free text (FR-REC-11).
- **Daylight-saving change or a timezone change:** entries belong to calendar dates in the household's timezone and never move because of a clock change.
- **Week boundary and week-start changes:** changing the week start in settings re-groups the display only. Entries keep their dates.

**Analytics events**

| Event                | Properties                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `plan_entry_added`   | `slot`, `source` (`household_recipe`, `starter_recipe` or `free_text`), `via` (`recent`, `search` or `template`) |
| `plan_entry_moved`   | `slot_changed`, `day_changed`                                                                                    |
| `plan_entry_removed` | none                                                                                                             |
| `portions_set`       | `people_count`, `has_baby_plate`                                                                                 |
| `leftover_linked`    | none                                                                                                             |
| `week_copied`        | `entries_count`, `mode` (`add` or `replace`)                                                                     |
| `template_saved`     | `entries_count`                                                                                                  |
| `template_applied`   | `entries_count`, `mode`                                                                                          |
| `week_planned`       | `dinners_count`, `days_until_week_start`                                                                         |

### 3.7 Pantry and staples (PAN)

**User stories**

- As a parent, I want salt, oil and flour left off the list automatically, so that the list only shows what I actually need to buy.
- As a parent, I want to tap "I already have this" on an item, so that I don't buy things already at home.
- As a parent, I want to see what's been hidden and why, so that nothing goes missing from the list without me knowing.

**Requirements**

- **FR-PAN-1:** New households get the region's default staples from the catalog: ingredients flagged as default staples, such as salt, black pepper, cooking oil, flour, sugar and water (PROPOSED list, finalized in the catalog).
- **FR-PAN-2:** The pantry screen lists staples by store section. Members with write access can add any catalog or household ingredient as a staple, or remove one.
- **FR-PAN-3:** Staples are never added to the grocery list by generation. The list shows a collapsed "assumed at home" row with a count, and expanding it lets the user add a staple to this week's list with one tap (FR-LIST-6).
- **FR-PAN-4:** "I already have this" on a generated list item:
  - Removes it from this week's list.
  - Records the ingredient as "have" for that list week.
  - Expires when the next week's list is generated (PROPOSED).
- **FR-PAN-5:** "Have" items appear in the pantry screen under "have this week", and can be undone, which puts the item back on the list.
- **FR-PAN-6:** Pantry changes sync to all members within 2 seconds (p95) online. Caregivers can mark "I already have this" (section 2), but can't change staples.
- **FR-PAN-7:** Quantities and expiry dates aren't tracked in Phase 1 (section 1.3).

**Acceptance criteria**

- **Staples hidden:**
  - **Given** salt is a staple and two planned recipes use salt
  - **When** the list is generated
  - **Then** salt isn't on the list, and the "assumed at home" row shows 1 more.
- **"Have" this week:**
  - **Given** milk is on this week's list
  - **When** a parent taps "I already have this" on milk
  - **Then** milk disappears from the list on both partners' devices within 2 seconds, and appears under "have this week". After next week's list is generated, milk returns if the plan needs it.

**Edge cases and error states**

- **A staple is the only use of an ingredient a member actually needs:** they open "assumed at home" and add it this week (FR-PAN-3).
- **Offline:** everything works offline and syncs later.
- **One partner marks "have" while the other checks the item off:** the "have" removes the item, and the check-off is kept as a purchase event (FR-MEM-1). Both actions mean "don't buy again".

**Analytics events**

| Event                  | Properties                     |
| ---------------------- | ------------------------------ |
| `staple_added`         | `is_catalog_ingredient`        |
| `staple_removed`       | none                           |
| `have_marked`          | `surface` (`list` or `pantry`) |
| `have_undone`          | none                           |
| `staple_added_to_list` | none                           |

### 3.8 Grocery list (LIST)

**User stories**

- As a parent, I want the list built from our plan automatically, with quantities merged, so that I never add things up myself.
- As a parent shopping in a store with poor signal, I want the list to work offline and check off with one thumb, so that I can shop holding a baby.
- As a parent, I want my partner to see what I've already picked up, so that we don't buy the same thing twice.
- As a parent, I want to add things that aren't from recipes, like diapers, so that one list covers the whole shop.

**Requirements**

- **FR-LIST-1:** Each household has one grocery list per week. It covers the planned entries for that week's dates (section 5.4).
- **FR-LIST-2:** The list for the current week is created automatically the first time a member opens the List tab, or when a plan entry is first added for that week (PROPOSED).
- **FR-LIST-3:** The list stays in sync with the plan: adding, editing or removing a plan entry updates generated items automatically, following the rules in section 5.4, without overwriting user-modified, checked or manual items.
  - When an update changes the list while it's open, a short summary is shown: items added, changed and removed.
  - "Regenerate" is also available as an explicit action, with the same rules.
- **FR-LIST-4:** Items are grouped by store section, in the household's section order, which is the region default in Phase 1. Within a section, unchecked items come first, alphabetical by display name in the locale. Checked items move to a collapsed "in the cart" group at the bottom.
- **FR-LIST-5:** Each item row shows the display name, the merged quantity in the household's unit system (section 5.2), a source hint (for example "for 2 meals"), and an allergen marker where relevant. The whole row is the tap target for checking off, and is at least 56 points tall.
- **FR-LIST-6:** Members can add manual items by typing, with catalog suggestions as they type, frequently bought suggestions (FR-MEM-3), and an optional quantity and unit. A manual item for a catalog ingredient that's already on the list as a generated item merges into it, adding the quantity (section 5.4).
- **FR-LIST-7:** Members can edit an item's quantity, unit or name, which makes it user-modified, and can delete items. Deleting a generated item stops it coming back for that week unless the plan adds more of the same ingredient (section 5.4).
- **FR-LIST-8:** Checking off records who checked the item and when, writes a purchase event (FR-MEM-1), and syncs within 2 seconds (p95). Unchecking within 10 minutes deletes that purchase event (PROPOSED).
- **FR-LIST-9:** Each item shows "checked by <member>" when the household has more than one member. A banner shows "someone else is updating the list" when another member changed it in the last 60 seconds (PROPOSED).
- **FR-LIST-10:** "Finish shopping" asks for confirmation, then records purchase events for any checked items that don't already have one. Checked items move to the week's history, and unchecked items stay on the list.
- **FR-LIST-11:** The list, check-offs, adding and editing all work offline. An offline banner and a pending-changes indicator are shown, and changes sync when the device reconnects (section 6.2).
- **FR-LIST-12:** An item can be expanded to show its sources: the plan entries and recipe lines it comes from.
- **FR-LIST-13:** Free households see the current week's list and lists from the last 4 weeks (PROPOSED; D-9). Premium sees all history (FR-PAY-6).

**Acceptance criteria**

- **Merging:**
  - **Given** this week's plan has two recipes with "1 cup milk" and "2 cups milk" for a US household
  - **When** the list is generated
  - **Then** the list has one milk item showing "3 cups", under dairy.
- **Shopping together:**
  - **Given** two parents have the list open, both online
  - **When** parent A checks off eggs
  - **Then** parent B sees eggs move to "in the cart" with "checked by A" within 2 seconds.
- **Plan change after shopping started:**
  - **Given** eggs are checked off
  - **When** a parent adds a recipe that needs 2 more eggs
  - **Then** a new unchecked eggs item for 2 is added, and the checked item isn't changed (section 5.4).
- **Manual item:**
  - **Given** an empty list
  - **When** a member types "diap" and picks the diapers suggestion
  - **Then** a diapers item is added under the household-supplies section, marked as manual.

**Edge cases and error states**

- **Empty states:**
  - **No plan entries:** the List tab shows the empty state with "plan meals" and "add an item".
  - **Everything is checked:** the "all done" state is shown, with "finish shopping".
- **Conflicting edits by two partners:** row-level last-write-wins applies (architecture section 5). A check-off by one member is never undone by a stale offline uncheck from another, so the later "checked" always wins (PROPOSED). Two partners adding the same manual catalog item at the same time produce two rows, which are merged on the next sync (section 5.4).
- **A plan entry is removed after its item was checked:** the checked item stays, and nothing is deleted from a list someone is shopping from.
- **The household region changes mid-week:** quantities are re-displayed in the new unit system, and stored values don't change.
- **Very long list** (200 or more items): scrolling stays at 60 fps on reference devices (NFR-PERF-6).

**Analytics events**

| Event                 | Properties                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `list_generated`      | `item_count`, `merged_count`, `staples_excluded_count`, `have_excluded_count`, `trigger` (`auto`, `regenerate` or `plan_change`) |
| `list_item_added`     | `source` (`typed`, `suggestion_catalog`, `suggestion_frequent` or `assumed_at_home`), `merged_into_existing`                     |
| `list_item_checked`   | `offline`, `section_id`                                                                                                          |
| `list_item_unchecked` | `within_undo_window`                                                                                                             |
| `list_item_edited`    | `field` (`quantity`, `unit` or `name`)                                                                                           |
| `list_item_deleted`   | `origin` (`plan` or `manual`)                                                                                                    |
| `shopping_finished`   | `checked_count`, `unchecked_count`, `members_who_checked_count`                                                                  |

### 3.9 List export (EXP)

**User stories**

- As a parent, I want to print the list grouped by aisle, so that I can shop from paper.
- As an iPhone user, I want the list in Apple Reminders, so that I can use Siri and my watch while shopping.
- As an Android user, I want to send the list to Google Keep or a message, so that I can use the apps I already have.

**Requirements**

- **FR-EXP-1:** Export is available from the List tab to every role, and is always free. It exports the unchecked items by default, with an option to include checked items (PROPOSED).
- **FR-EXP-2:** **Print or PDF:**
  - Produces a single-column checklist grouped by store section, with a checkbox per item, the quantity in the household's units, and a heading with the week dates formatted by the locale.
  - Users can print through the system dialog (AirPrint on iOS, the print service on Android), or save and share a PDF.
  - Works offline.
- **FR-EXP-3:** **Apple Reminders (iOS only):**
  - Asks for the reminders permission the first time it's used.
  - Creates a Reminders list named by the grocery-list purpose and the week, or updates the one created earlier for the same week, adding one reminder per item. Quantity and section are included in the reminder's title or notes (exact format decided in the G-06 spike).
  - Re-exporting the same week adds new items, and marks reminders for items that have since been removed or checked in the app as completed. It never creates duplicates.
  - Works offline, because Reminders is on the device.
- **FR-EXP-4:** **Share or Copy as text (both platforms):** produces plain checklist text with a checkbox symbol, the quantity and the name, grouped under section headings. "Share" opens the system share sheet, and "Copy" copies to the clipboard and shows a confirmation.
- **FR-EXP-5:** If the reminders permission is refused, the app explains how to enable it in Settings and offers Share or Copy instead.
- **FR-EXP-6:** All export formats are produced by the same function and must contain the same items, in the same order, with the same quantities (architecture section 7).

**Acceptance criteria**

- **Print:**
  - **Given** a list with 3 sections and 12 unchecked items
  - **When** a member chooses Print
  - **Then** the print preview shows 3 section headings and 12 checkbox lines with quantities in the household's units.
- **Reminders, repeated:**
  - **Given** an earlier export to Reminders for this week
  - **When** 2 items are added and 1 is checked off in the app, and the member exports again
  - **Then** Reminders has 2 new reminders, the checked item is completed in Reminders, and nothing is duplicated.
- **Android share:**
  - **Given** an Android member
  - **When** they share to Google Keep
  - **Then** Keep receives a note with section headings and one line per item.

**Edge cases and error states**

- **Empty list:** export actions are disabled, with the reason shown.
- **The Reminders list was deleted by the user in the Reminders app:** the next export creates a new one.
- **No printer available:** the system dialog handles it, and "save as PDF" is always available.
- **Long names and quantities:** they wrap in print and in text. Nothing is truncated.

**Analytics events**

| Event                         | Properties                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `list_exported`               | `target` (`print`, `pdf`, `apple_reminders`, `share_text` or `copy_text`), `item_count`, `included_checked` |
| `reminders_permission_result` | `granted`                                                                                                   |
| `list_export_failed`          | `target`, `error_code`                                                                                      |

### 3.10 Purchase memory (MEM)

Phase 1 builds the foundation and one free feature. Recommendations are Phase 2 (see section 9, conflict C-1).

**User stories**

- As a parent, I want items we buy often suggested when I add to the list, so that adding the usual things takes one tap.
- As a parent, I want the app to learn from what we tick off, without connecting to any store account.

**Requirements**

- **FR-MEM-1:** A purchase event is recorded for each item checked off (FR-LIST-8) and for each checked item at "finish shopping" (FR-LIST-10), at most once per item per list. It stores the ingredient ID (or the household item ID for free text), the quantity in base units, the time, the source and the member.
- **FR-MEM-2:** Purchase events come only from in-app actions. No retailer data is used (vision).
- **FR-MEM-3:** **Frequently bought (free):**
  - When adding a list item, the suggestions show up to 8 items (PROPOSED).
  - They're ranked by the number of purchase events in the last 8 weeks (PROPOSED), from items bought at least twice (PROPOSED), leaving out items already unchecked on the list.
- **FR-MEM-4:** Purchase events are kept for the life of the household, are included in data export, and are deleted with the household. Free households see frequently bought items based on all their events. The history-window limit applies to viewing past lists and plans, not to suggestions (PROPOSED).
- **FR-MEM-5:** Members can remove an item from frequently bought suggestions ("don't suggest"), which hides it for 90 days (PROPOSED).

**Acceptance criteria**

- **Frequently bought:**
  - **Given** a household that checked off bananas in each of the last 3 weeks
  - **When** a member opens add-item on an empty list
  - **Then** bananas appears in the frequently bought suggestions.
- **Mistaken check-off:**
  - **Given** an item checked off 2 minutes ago
  - **When** it's unchecked
  - **Then** its purchase event is deleted.

**Edge cases and error states**

- **New household with no history:** the frequently bought section is hidden. Catalog suggestions only.
- **Offline:** purchase events are queued and synced. Suggestions use the local copy.

**Analytics events**

| Event                        | Properties |
| ---------------------------- | ---------- |
| `frequent_suggestion_used`   | `rank`     |
| `frequent_suggestion_hidden` | none       |

### 3.11 Notifications (NOT)

**User stories**

- As a parent, I want a gentle reminder to plan the week, so that Sunday evening doesn't slip by.
- As a parent, I want to know when my partner has finished the list, so that I can shop without asking.
- As a parent, I want quiet hours, so that the app never buzzes during a night feed or naptime.

**Requirements**

- **FR-NOT-1:** Phase 1 has four notification types:

  | Type                                                 | Default | Delivery                                  |
  | ---------------------------------------------------- | ------- | ----------------------------------------- |
  | Plan your week                                       | On      | Push, scheduled on the server             |
  | List is ready                                        | On      | Push, sent by the server to other members |
  | Defrost tonight                                      | On      | Local notification on the device          |
  | Household changes (invites accepted, member removed) | On      | In-app inbox only                         |

- **FR-NOT-2:** Push permission is requested in context: the first time a member finishes a planned week, or turns on a push type in settings. It's never requested at first launch. If permission is denied, the types show as "off in system settings", with a link to the system settings.
- **FR-NOT-3:** **Plan your week:**
  - Sent once a week, the day before the week starts, at 18:00 in the household's timezone (PROPOSED).
  - Not sent if the coming week is already planned (FR-PLAN-12).
  - Each member can change the day and time.
- **FR-NOT-4:** **List is ready:**
  - Sent to the other members when a member taps "list is ready" on the List tab (an explicit action, PROPOSED), or when the week becomes planned and the list is generated, whichever comes first.
  - At most once per list per day.
- **FR-NOT-5:** **Defrost tonight:**
  - Scheduled on each member's device for 08:00 local time (PROPOSED) on the day of a dinner entry whose recipe has the needs-defrosting tag.
  - Cancelled or rescheduled when the entry moves or is removed.
- **FR-NOT-6:** **Quiet hours:**
  - Set per member, defaulting to 21:00 to 07:00 (PROPOSED).
  - Push notifications that fall within quiet hours are held and delivered at the end of quiet hours, and local notifications are scheduled outside them.
  - Notifications make no sound by default (PROPOSED).
- **FR-NOT-7:** Each type can be turned on or off per member in settings, and from the notification itself (a "turn off this type" action where the platform supports it).
- **FR-NOT-8:** The in-app inbox shows the last 50 notifications (PROPOSED), with read state. Tapping one opens the related screen.
- **FR-NOT-9:** Notification text is localized on the server in the recipient's locale and contains no children's names or allergy details (NFR-SEC-6).

**Acceptance criteria**

- **Plan your week:**
  - **Given** a US household with a Sunday week start and next week unplanned
  - **When** it's Saturday 18:00 in the household's timezone
  - **Then** each member with the type on receives the notification, held until quiet hours end if needed.
- **Already planned:**
  - **Given** next week already has 5 dinners
  - **When** the Saturday schedule runs
  - **Then** no notification is sent.
- **Defrost tonight:**
  - **Given** a Wednesday dinner whose recipe is tagged needs-defrosting
  - **When** it's Wednesday 08:00
  - **Then** a local notification names the meal, and tapping it opens the plan entry.

**Edge cases and error states**

- **A member has no push token** (permission denied): they get the inbox entry only.
- **Several devices per member:** all of them get the push. Reading it on one marks it read in the inbox everywhere.
- **The timezone changes while travelling:** schedules follow the household's timezone. Local notifications follow the device's timezone (ASSUMPTION).

**Analytics events**

| Event                       | Properties                   |
| --------------------------- | ---------------------------- |
| `push_permission_prompted`  | `trigger`                    |
| `push_permission_result`    | `granted`                    |
| `notification_sent`         | `type` (server-side)         |
| `notification_opened`       | `type`                       |
| `notification_type_toggled` | `type`, `enabled`, `surface` |
| `quiet_hours_changed`       | `start_hour`, `end_hour`     |

### 3.12 Settings, privacy, data export and account deletion (PRIV)

**User stories**

- As a parent, I want to control units, week start and notifications, so that the app fits our routine.
- As a parent, I want to download all our data, so that I'm never locked in.
- As any member, I want to delete my account completely from the app, so that I stay in control of my family's information.

**Requirements**

- **FR-PRIV-1:** The Household tab contains:
  - **Settings:** household name, region, units, timezone and week start (editable by parents only).
  - **Members and invitations.**
  - **People and allergies.**
  - **Pantry and staples.**
  - **Notifications.**
  - **Subscription.**
  - **Privacy and data.**
  - **Account:** profile, biometric lock, sign out and delete account.
  - **About:** version, terms, privacy policy and licences.
- **FR-PRIV-2:** **Data export** (always free):
  - **Parents** can export the household's data: household, members (display names and roles), people and dietary codes, recipes, plans, lists, pantry and purchase events.
  - **Any member** can export their own account data.
  - **Format:** a ZIP file containing a JSON file for each data type and a CSV file for recipes, plans and lists, shared through the share sheet.
  - **Speed:** for a typical household (200 recipes, 1 year of plans), the export is ready within 30 seconds (PROPOSED).
- **FR-PRIV-3:** **Account deletion:**
  - **Where:** in the app, reachable in at most 3 taps from the Household tab.
  - **Confirmation:** the user re-authenticates (a code or Apple or Google sign-in), and the confirmation names what will be deleted.
  - **What happens:** the user's account is removed. If they're the only member of the household, the household and all its data are deleted. Otherwise the household continues and their personal data (profile, push tokens, notification preferences) is deleted. Recipes and entries they created stay with the household, attributed to "former member" (PROPOSED).
  - **Last parent with other members:** they must promote another member first (FR-HH-14), or delete the household.
- **FR-PRIV-4:** Deleted data is removed from the live database immediately, and from backups as they expire, within 30 days (PROPOSED; depends on the Supabase plan's backup retention). The privacy policy states this period.
- **FR-PRIV-5:** **Analytics opt-out:** any member can turn off product analytics on their device. Crash reports stay on, because they contain no personal data, unless the platform's tracking settings require otherwise (ASSUMPTION; confirmed in legal review, D-11).
- **FR-PRIV-6:** **Policy links:** the privacy policy and terms are reachable from sign-in and from settings, in the user's locale.
- **FR-PRIV-7:** **Delete household:** a parent can delete the household from settings. If there are two parents, the other parent must confirm in the app within 7 days, or the request expires (PROPOSED). All members are notified.

**Acceptance criteria**

- **Export:**
  - **Given** a parent in a household with recipes, plans and a list
  - **When** they choose to export household data
  - **Then** within 30 seconds the share sheet opens with a ZIP file containing every data type listed in FR-PRIV-2.
- **Deletion, only member:**
  - **Given** the only member of a household
  - **When** they confirm account deletion
  - **Then** they're signed out, can't sign in again with the same method without creating a new account, and none of the household's rows remain on the server.
- **Deletion, other members remain:**
  - **Given** a household with two parents
  - **When** parent A deletes their account
  - **Then** parent B keeps the household with all its recipes, plans and lists, and A no longer appears as a member.

**Edge cases and error states**

- **Export or deletion while offline:** both need a network connection, and the actions are disabled with the offline message.
- **Deletion of an account that has an active subscription:** the app warns that the store subscription must be cancelled in the App Store or Google Play, links there, and doesn't cancel it itself. The household's Premium ends when the store subscription ends.
- **An export that's too large to finish in time:** it's prepared on the server, and the member gets an in-app notice when it's ready, within 24 hours (PROPOSED).

**Analytics events**

| Event                        | Properties                                                               |
| ---------------------------- | ------------------------------------------------------------------------ |
| `settings_changed`           | `setting` (a fixed name), `role`                                         |
| `data_export_requested`      | `scope` (`household` or `account`)                                       |
| `data_export_completed`      | `scope`, `size_bucket`                                                   |
| `account_deletion_requested` | `was_only_member`                                                        |
| `account_deleted`            | `was_only_member` (sent before deletion; no identifiers kept afterwards) |
| `analytics_opt_out_changed`  | `opted_out` (sent only when opting back in)                              |

### 3.13 Free versus Premium limits and the paywall (PAY)

**User stories**

- As a parent, I want the core plan-shop loop free for my partner and me, so that I can tell other parents about it.
- As a parent, I want to see exactly what Premium adds, at the moment I need it, so that I upgrade because it helps, not because I'm blocked.
- As a parent whose subscription lapsed, I want our data kept, so that nothing is lost.

**Requirements**

- **FR-PAY-1:** The household's tier comes from its entitlement on the server (architecture section 8). Every member sees the same tier. The app never decides the tier from local purchase state alone.
- **FR-PAY-2:** Free includes everything in section 2 marked Free: two parents, unlimited manual recipes, the starter library, the full planner, copy last week, the auto-built list, pantry, sharing, offline, all exports, purchase memory suggestions, notifications, and safety and privacy features.
- **FR-PAY-3:** Premium adds, in Phase 1:
  1. Family and caregiver seats (FR-HH-1).
  2. A larger AI import allowance (FR-AI-9).
  3. Saved week templates (FR-PLAN-10).
  4. Full history of plans and lists (FR-PAY-6).
- **FR-PAY-4:** **Moment-of-need prompts:**
  - When a free household tries a Premium action, a sheet names that specific benefit, lists the other Premium benefits, shows the prices and trial from the store, and offers "start free trial", "not now" and "restore purchases".
  - There's no full-screen paywall at launch or in onboarding (vision paywall principle 5).
  - Only parents can buy. Family members and caregivers in a lapsed household see "ask a parent".
- **FR-PAY-5:** Prompt triggers in Phase 1: inviting a family member or caregiver, running out of AI imports, saving or applying a template, and opening history older than the free window. A Premium section in the Household tab is the only place Premium is advertised without a trigger.
- **FR-PAY-6:** **History window:**
  - **Free:** plans and lists of the last 4 weeks and the current week (PROPOSED; D-9).
  - **Premium:** everything.
  - **Enforcement:** on the server. Older data is kept, not deleted.
- **FR-PAY-7:** **Products:** monthly and annual household subscriptions with a free trial, configured by the product owner in the App Store, Google Play and RevenueCat (D-10). The trial length is 14 days (PROPOSED; D-10). Prices are shown from the store, in the store's currency.
- **FR-PAY-8:** **Purchase effect:** after a purchase, every member's device shows Premium within 60 seconds (p95), through the RevenueCat webhook. "Restore purchases" restores an existing subscription for the buying parent's store account.
- **FR-PAY-9:** **Lapse:** when Premium ends through expiry, cancellation or refund:
  - The tier becomes Free within 60 seconds of the webhook.
  - Family members and caregivers lose access, but their memberships are kept, suspended.
  - Templates and older history are hidden, not deleted.
  - The AI allowance drops to the free number, and any imports already used this month count against it.
  - Export still includes everything.
  - Restarting Premium restores access fully.
- **FR-PAY-10:** **Never charged for:** allergy profiles and warnings, export, account deletion, privacy controls, offline use and core notifications (vision, "Always free").
- **FR-PAY-11:** **No ads,** in either tier (PROPOSED in the vision; D-11).

**Acceptance criteria**

- **Moment of need:**
  - **Given** a free household
  - **When** a parent taps "invite a caregiver"
  - **Then** the Premium sheet opens, naming caregiver seats first, with the trial offer from the store.
- **Purchase:**
  - **Given** a parent completes a sandbox purchase
  - **When** 60 seconds pass
  - **Then** both parents' devices show Premium, and inviting a caregiver works.
- **Lapse:**
  - **Given** a Premium household with a caregiver and 2 templates
  - **When** the subscription expires
  - **Then** the caregiver sees "household access paused", the templates are hidden but included in export, and nothing is deleted.

**Edge cases and error states**

- **Purchase made offline, or the webhook is delayed:** the buying device shows "activating" for up to 5 minutes and then refreshes. If it's still not active, it offers "restore purchases" and a support contact.
- **The buying parent leaves the household:** the household keeps Premium until the current period ends, then becomes free unless another parent subscribes (architecture section 8).
- **Both parents subscribe:** the second purchase attempt shows that the household is already Premium and doesn't start a purchase (PROPOSED).
- **Refund:** treated as a lapse (FR-PAY-9).
- **Store region differs from the household region:** the prices shown follow the store.

**Analytics events**

| Event                 | Properties                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `paywall_viewed`      | `trigger` (`caregiver_invite`, `family_invite`, `ai_allowance`, `template` or `history`), `role` |
| `trial_started`       | `product_period` (`monthly` or `annual`)                                                         |
| `purchase_completed`  | `product_period`, `is_trial`                                                                     |
| `purchase_failed`     | `error_code`                                                                                     |
| `purchases_restored`  | `found`                                                                                          |
| `entitlement_changed` | `from_tier`, `to_tier`, `reason` (server-side)                                                   |

## 4. Screen inventory and flows

This section covers structure only. Layout and visuals come from the chosen design direction ([design-directions.md](design-directions.md)). Routes follow architecture section 2.

### 4.1 Screen inventory

| ID   | Screen                          | Purpose                                                           | Main elements                                                                                                                      | Navigation                                  |
| ---- | ------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| S-01 | Launch and update check         | Load the session and cached data, and enforce the minimum version | Progress indicator; forced-update screen if below the minimum                                                                      | To S-02, S-05 or S-10                       |
| S-02 | Sign in                         | Choose a sign-in method                                           | Email field; Apple and Google buttons; terms and privacy links                                                                     | To S-03, or to S-05 or S-10 after sign-in   |
| S-03 | Enter code                      | Verify the email code                                             | 6-digit code input; resend; change email                                                                                           | Back to S-02; on to S-05 or S-10            |
| S-04 | Biometric lock                  | Unlock after the timeout                                          | Biometric prompt; passcode fallback                                                                                                | Back to the previous screen                 |
| S-05 | Create or join                  | First choice for a user with no household                         | Create household; join with an invite                                                                                              | To S-06 or S-09                             |
| S-06 | Onboarding: name and region     | Steps 1 and 2                                                     | Household name; region picker                                                                                                      | To S-07                                     |
| S-07 | Onboarding: who you're feeding  | Step 3                                                            | Adults; children by age band; expecting with the due month                                                                         | To S-08                                     |
| S-08 | Onboarding: allergies and diets | Step 4                                                            | Codes per person; disclaimer                                                                                                       | To S-10 (Plan)                              |
| S-09 | Join household                  | Accept an invitation                                              | Code input or prefilled code; household name, inviter and role preview; accept                                                     | To S-10                                     |
| S-10 | Plan tab (week)                 | View and edit the week                                            | Week header with previous, next and today; days with 5 slots; entries with allergen markers; copy last week; apply template        | Tabs; S-11, S-12                            |
| S-11 | Add to slot (sheet)             | Add an entry                                                      | Recent recipes; search; free text; servings                                                                                        | Back to S-10                                |
| S-12 | Entry detail (sheet)            | Edit an entry                                                     | Servings and portions per person; baby plate; leftovers-of; move; duplicate; remove                                                | Back to S-10; to S-16                       |
| S-13 | List tab                        | Shop and manage the list                                          | Section groups; item rows; add-item field; offline and updating banners; "assumed at home"; "in the cart"; finish shopping; export | Tabs; S-14, S-15, S-23                      |
| S-14 | Add item (sheet)                | Add a manual item                                                 | Typed text with catalog suggestions; frequently bought; quantity and unit                                                          | Back to S-13                                |
| S-15 | Item detail (sheet)             | Edit an item                                                      | Quantity, unit and name; sources; "I already have this"; delete                                                                    | Back to S-13                                |
| S-16 | Recipes tab                     | Browse and search                                                 | Search; tag filters; household recipes; starter library; add and import actions                                                    | Tabs; S-17, S-18, S-19                      |
| S-17 | Recipe detail                   | View a recipe                                                     | Title, times and tags; servings stepper; ingredients; steps; allergen notice; source; edit; save a copy; add to plan               | To S-18, S-11                               |
| S-18 | Recipe editor                   | Create or edit a recipe                                           | Fields per FR-REC-4; ingredient line editor with quantity, unit and ingredient pickers; steps; tags                                | Back to S-17                                |
| S-19 | Import: choose input            | Start an import                                                   | Paste link; paste text; take photo; choose image; allowance remaining                                                              | To S-20                                     |
| S-20 | Import: progress                | Wait for parsing                                                  | Progress indicator; cancel; can be left (continues on the server)                                                                  | To S-21, or an error state                  |
| S-21 | Import: review                  | Review a draft                                                    | Allergen notice; highlighted lines; editable fields; save; discard; enter manually instead                                         | To S-17 (saved) or S-16                     |
| S-22 | Pantry                          | Staples and "have this week"                                      | Staples by section; "have this week" with undo; add staple                                                                         | From S-13 or S-25                           |
| S-23 | Export (sheet)                  | Get the list out                                                  | Print or PDF; Apple Reminders (iOS); Share; Copy; include-checked option                                                           | Back to S-13                                |
| S-24 | Notifications inbox             | Past notifications                                                | List with read state                                                                                                               | From the header bell; to the related screen |
| S-25 | Household tab                   | Household hub                                                     | Sections per FR-PRIV-1                                                                                                             | Tabs; S-26 to S-31, S-22                    |
| S-26 | Members and invitations         | Manage people with accounts                                       | Members with roles; pending invites; invite by role; revoke; remove; change role; leave                                            | To S-27, S-32                               |
| S-27 | Invite (sheet)                  | Create and share an invite                                        | Role; link and code; share; copy; optional email                                                                                   | Back to S-26                                |
| S-28 | People and allergies            | Manage the people being fed                                       | People with age band; diets and allergies; disclaimer                                                                              | From S-25                                   |
| S-29 | Notification settings           | Per-type settings                                                 | Type toggles; plan-your-week day and time; quiet hours                                                                             | From S-25                                   |
| S-30 | Privacy and data                | Export and analytics                                              | Export household or account data; analytics opt-out; policy links                                                                  | From S-25                                   |
| S-31 | Account                         | Personal settings                                                 | Display name; biometric lock and timeout; sign out; delete account                                                                 | From S-25                                   |
| S-32 | Premium sheet                   | Moment-of-need upgrade                                            | Triggering benefit; benefit list; store prices and trial; purchase; restore; not now                                               | Modal from any trigger                      |
| S-33 | Subscription status             | Status and management                                             | Tier; renewal or expiry date; manage subscription (store link); restore                                                            | From S-25                                   |
| S-34 | History                         | Past weeks                                                        | Weeks list; past plan and list (read only); upgrade prompt beyond the free window                                                  | From S-10 or S-13                           |
| S-35 | Removed or paused               | Access lost                                                       | Removed-from-household or access-paused message; create or join; ask a parent                                                      | Shown when access ends                      |

The bottom tabs are Plan, List, Recipes and Household. Plan is the default tab.

### 4.2 Flow: first launch to first shared grocery list

1. **S-01 to S-02:** a new user chooses email, Apple or Google sign-in (via S-03 for email).
2. **S-05:** the user chooses "create household". S-06, S-07 and S-08 run with the defaults. The user lands on S-10, showing the current week's empty state.
3. **S-10:** the user taps "invite your partner", which opens S-27 with the parent role preselected, and shares the link through the share sheet.
4. **S-10:** the user taps tonight's dinner slot, which opens S-11. They search the starter library and pick a meal. They repeat for more days, or use "copy last week" from the second week on.
5. **S-13:** the List tab already shows the generated list (FR-LIST-2), grouped by section, with staples collapsed.
6. **Partner joins:** on another device the partner opens the link. They sign in (S-02, S-03), then S-09 shows the household and role, and they accept. Their S-10 shows the same plan.
7. **Shared list:** both open S-13. Changes from one appear on the other within 2 seconds. **Activation** happens when the household has a planned week and an export or shared shopping session within 7 days of creation (vision metrics, section 8).

### 4.3 Flow: importing a recipe

1. Choose the input: **S-16 then "import" then S-19,** or the import action in S-11's add sheet.
2. **S-19:** the user sees the allowance remaining, then pastes a link (or text, or takes or chooses a photo).
3. **S-20:** progress. If the user leaves the screen, parsing continues on the server, and returning shows the result.
4. **S-21:** the allergen notice, if any, is shown at the top with the disclaimer. Low-confidence and unmatched lines are highlighted. The user edits two lines and saves.
5. **S-17:** the new recipe, with its source shown. "Add to plan" opens S-11 with the recipe preselected.
6. **Failure branches:**
   - **Not a recipe, can't be read, or timed out:** an error state on S-20 offers "enter manually instead", which opens S-18 prefilled, or "paste the text instead".
   - **Allowance reached:** S-19 shows the reset date, plus S-32 for free households.

### 4.4 Flow: planning a week

1. **S-10:** the coming week is shown, either from the "plan your week" notification or by navigating.
2. **Starting point:** if last week had entries, the user can tap "copy last week" and choose "add" or "replace". Otherwise they tap each dinner slot and pick from recent recipes in S-11.
3. **S-12:** the user adjusts portions for a toddler (½) and a baby plate (¼), and marks Tuesday lunch as leftovers of Monday dinner.
4. **Week planned:** once 5 dinners are planned, the week counts as planned (FR-PLAN-12). The list updates, and the user can tap "list is ready" on S-13 to notify their partner.
5. **Templates (Premium):** "save as template". A free household gets S-32.

### 4.5 Flow: shopping offline

1. **Before going out:** the list is on the device. No action is needed, because the data is always stored locally.
2. **In the store, no signal:** S-13 shows the offline banner. The user checks off items with one thumb, and they move to "in the cart". Adding an item through S-14 works with catalog suggestions from the local copy.
3. **The partner shops at another store, also offline:** they check off other items.
4. **Back online:** both devices sync. Items checked by either partner are checked on both devices, and stale unchecks don't undo checks. Manual items added on both devices merge where they're the same catalog ingredient (section 5.4). Pending indicators clear.
5. **S-13:** the user taps "finish shopping", which records purchase events. Unchecked items remain for next time.

## 5. Data and business rules

### 5.1 Ingredient normalization

- **R-ING-1:** Every ingredient line refers to an ingredient ID (catalog or household) and, optionally, a unit ID and a quantity. Display names come from `ingredient_names` for the household's locale, falling back to `en-US`.
- **R-ING-2:** Each unit has a dimension (mass, volume or count) and a factor to its base unit:
  - **Mass** to grams.
  - **Volume** to millilitres.
  - **Count** to "each".

  Regional units are separate IDs:

  | Unit                   | Factor     | Unit           | Factor     |
  | ---------------------- | ---------- | -------------- | ---------- |
  | US teaspoon            | 4.929 ml   | AU tablespoon  | 20 ml      |
  | US tablespoon          | 14.787 ml  | Metric cup     | 250 ml     |
  | US cup                 | 236.588 ml | US fluid ounce | 29.574 ml  |
  | Metric teaspoon        | 5 ml       | US pint        | 473.176 ml |
  | Metric tablespoon (UK) | 15 ml      | Imperial pint  | 568.261 ml |
  | Ounce (mass)           | 28.350 g   | Pound          | 453.592 g  |

- **R-ING-3:** `quantity_base = quantity × unit.to_base`, and it's stored on each line. Scaling multiplies the base quantity by the servings ratio.
- **R-ING-4:** A line with no unit is a count if the ingredient's default dimension is count. Otherwise (for example "salt to taste") it's a no-quantity line. No-quantity lines appear on the list once per ingredient with no quantity, unless the ingredient is a staple or marked "have".
- **R-ING-5:** Lines with "a pinch" or "a dash" use count-like units with no base conversion. They never merge with measured quantities, and they're shown as written (PROPOSED).
- **R-ING-6:** Ingredients aren't matched or merged by display text. Typed or parsed text is resolved to an ingredient ID first (by exact name or synonym in the locale, then by search). Only IDs are compared.

### 5.2 Unit merging and display (US customary and metric)

- **R-UNIT-1:** Quantities for the same ingredient and the same dimension are summed in base units.
- **R-UNIT-2:** **Different dimensions** for the same ingredient (for example "200 g butter" and "2 tbsp butter"):
  - Merged into the ingredient's default dimension only if the catalog has a density for it (`density_g_per_ml`).
  - Otherwise shown as two quantities on one item, joined by the locale's list format ("200 g + 2 tbsp", PROPOSED).
  - Count and mass are never merged in Phase 1.
- **R-UNIT-3:** **Display unit by unit system:**

  | Dimension | US customary                                                                                                           | Metric                                      |
  | --------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
  | Volume    | Under 3 tbsp: tsp or tbsp. Under 1 cup: tbsp or fractional cups. 1 cup or more: cups. Over 4 cups for liquids: quarts. | Under 1 litre: ml. 1 litre or more: litres. |
  | Mass      | Under 1 lb: oz. 1 lb or more: lb with oz.                                                                              | Under 1 kg: g. 1 kg or more: kg.            |
  | Count     | Whole numbers, rounded up for shopping (2.25 eggs shows as 3)                                                          | Same                                        |

  These thresholds are PROPOSED.

- **R-UNIT-4:** **Rounding for display:**
  - **US cups:** to the nearest ¼, never showing 0 for a non-zero quantity.
  - **US tbsp and tsp:** to the nearest ½.
  - **ml:** to 5 under 100 and to 25 under 1 litre.
  - **g:** to 5 under 100, to 25 under 1 kg, and 1 decimal for kg and litres.
  - **Count:** rounded up.

  These are PROPOSED. Display rounding never changes stored values.

- **R-UNIT-5:** A list item shows quantities in the household's unit system, regardless of the units the recipe used. The recipe detail screen shows the recipe's original units, with an option to view them in the household's system (PROPOSED).
- **R-UNIT-6:** Numbers, fractions and unit names are formatted through the locale helpers. US shows fractions for cups and spoons, and metric shows decimals.

### 5.3 Servings and portions

- **R-SERV-1:** **Default servings** for a new plan entry are the sum of household people's default portions:

  | Age band                    | Default portion |
  | --------------------------- | --------------- |
  | Adult                       | 1               |
  | Older child                 | 1               |
  | Preschool                   | ½               |
  | Toddler                     | ½               |
  | 6 to 12 months              | ¼ (baby plate)  |
  | 0 to 6 months and expecting | 0               |

  These values are PROPOSED. The total is rounded up to the nearest ½.

- **R-SERV-2:** An entry's quantity factor is `entry servings ÷ recipe servings`. If portions per person are set, entry servings are the sum of those portions.
- **R-SERV-3:** **Leftovers:** if entry B is "leftovers of" entry A, then A's effective servings are A's servings plus B's servings, and B contributes nothing. Chains are allowed, but a link can't point at a later entry (no cycles).
- **R-SERV-4:** Free-text entries contribute nothing to the list.

### 5.4 Grocery list generation and merging

- **R-LIST-1:** **Input:**
  - Plan entries dated within the list's week.
  - Recipe lines scaled by R-SERV-2 and R-SERV-3.
  - The pantry: staples, and "have" items for that week.
  - The current list items.
- **R-LIST-2:** **Grouping:** lines are grouped by (ingredient ID, dimension group). Each group becomes at most one _generated_ list item, plus any separate unmergeable parts per R-UNIT-2.
- **R-LIST-3:** **Exclusion:** a group is left off if the ingredient is a staple (and appears in "assumed at home") or marked "have" this week.
- **R-LIST-4:** **Recalculation** (on any plan, recipe or pantry change, or "regenerate"). For each group:
  - **No existing generated item:** create one.
  - **An existing generated item that isn't user-modified and isn't checked:** update its quantity and sources.
  - **An existing checked item, where the needed quantity is now higher than the checked quantity:** add a new unchecked item for the difference. The checked item isn't changed.
  - **An existing user-modified item:** don't change the quantity. Update the sources, and show a "plan changed" hint on the item (PROPOSED).
  - **The group is no longer needed** (all its entries removed): delete the generated item if it's unchecked and not user-modified. Otherwise keep it.
  - **Deleted by a member this week:** don't recreate it unless the needed quantity has risen since the deletion.
- **R-LIST-5:** **Manual items:** never changed by recalculation.
  - **Catalog ingredient that's already a generated item:** the manual quantity is added to that item, and the item is marked user-modified.
  - **Free-text item:** stays its own row.
  - **Two manual rows for the same catalog ingredient, added offline on two devices:** merged on sync into one row, summing quantities (PROPOSED).
- **R-LIST-6:** **Sections:** an item's section comes from the ingredient. Household and free-text items use the section the member chose, defaulting to "other".
- **R-LIST-7:** **Where it runs:** generation runs on the device that made the change, and writes ordinary rows that sync. It must be deterministic for the same inputs (architecture section 3.2).
- **R-LIST-8:** **Allergen marker:** an item gets the marker if its ingredient has allergen codes matching any household person's allergies.

### 5.5 Pantry de-selection

- **R-PAN-1:** Staples are household-level and persistent until removed.
- **R-PAN-2:** **"Have" is per list week.** A "have" record stores the ingredient and the week start, and it doesn't apply to other weeks (PROPOSED).
- **R-PAN-3:** **Order of precedence:**
  1. The user explicitly adds an "assumed at home" staple this week, which overrides the staple.
  2. Then "have".
  3. Then generation.

### 5.6 Purchase memory

- **R-MEM-1:** **One event per item per list:** created by a check-off or "finish shopping". Unchecking within 10 minutes deletes it (PROPOSED).
- **R-MEM-2:** **Frequently bought rank:** the event count in the last 56 days, with ties broken by the most recent purchase. Only items bought at least twice qualify, and at most 8 are shown (PROPOSED).
- **R-MEM-3:** **Exclusions:** items already unchecked on the current list, items hidden through "don't suggest" (for 90 days), and staples are left out.

### 5.7 Free-tier limits and numbers

| Limit                                                            | Free                               | Premium                         | Source                |
| ---------------------------------------------------------------- | ---------------------------------- | ------------------------------- | --------------------- |
| Parents                                                          | 2                                  | 2                               | Vision                |
| Family and caregiver seats                                       | 0                                  | 6 in total                      | PROPOSED              |
| Household people (no account)                                    | 12                                 | 12                              | PROPOSED              |
| Manual recipes                                                   | Unlimited                          | Unlimited                       | Vision                |
| Starter library                                                  | Full                               | Full                            | Vision                |
| AI imports per month (household)                                 | 5                                  | 100                             | PROPOSED; D-9         |
| AI imports per member per hour                                   | 10                                 | 10                              | PROPOSED              |
| Link imports read from embedded recipe data                      | Not counted                        | Not counted                     | PROPOSED              |
| Images per import                                                | 1                                  | 1                               | PROPOSED              |
| Saved week templates                                             | 0                                  | 50                              | PROPOSED              |
| Grocery lists                                                    | 1 per week                         | 1 per week (more after the MVP) | Vision, MVP scope     |
| History of plans and lists                                       | Current week plus the last 4 weeks | All                             | PROPOSED; D-9         |
| Pending invitations                                              | 5                                  | 5                               | PROPOSED              |
| Invitation validity                                              | 7 days, single use                 | 7 days, single use              | Architecture          |
| Recipe size                                                      | 100 ingredient lines, 50 steps     | Same                            | PROPOSED              |
| Exports, allergy profiles, deletion, offline, core notifications | Unlimited                          | Unlimited                       | Vision, "Always free" |
| Free trial                                                       | Not applicable                     | 14 days                         | PROPOSED; D-10        |

## 6. Non-functional requirements

**Reference devices (PROPOSED):**

- **Mid-range Android:** a phone from 2023 or later with 4 GB of RAM, running Android 13.
- **iPhone:** an iPhone 13 running iOS 26.

Percentile targets are measured in beta through Sentry performance monitoring.

### 6.1 Performance

- **NFR-PERF-1:** **Cold start** to an interactive Plan tab, using cached data: at most 2.5 seconds (p75) on the mid-range Android device, and at most 1.5 seconds on the iPhone (PROPOSED).
- **NFR-PERF-2:** **Local actions** (checking off an item, adding a plan entry, editing a line) update the screen within 100 ms (p95), whether online or offline.
- **NFR-PERF-3:** **Sync between online members:** a change appears on another member's device within 2 seconds (p95).
- **NFR-PERF-4:** **List generation** for a week of 21 entries with 15 lines each finishes within 100 ms (p95) on the mid-range Android device.
- **NFR-PERF-5:** **Local search** over 500 recipes returns results within 200 ms (p95).
- **NFR-PERF-6:** **Scrolling** the List and Plan tabs with 200 items runs at 60 frames per second, with at most 1% dropped frames, on the reference devices.
- **NFR-PERF-7:** **AI import:**
  - **Link:** a review screen within 20 seconds (p95).
  - **Image:** within 30 seconds (p95).
  - **Hard timeout:** 45 seconds.
- **NFR-PERF-8:** **App download size:** at most 40 MB on both stores (PROPOSED).

### 6.2 Offline behavior

- **NFR-OFF-1:** **Works fully offline:** reading and editing the plan, recipes, pantry, people and the list; checking off; manual items; and print, Reminders and Copy or Share export. Every household's working data is stored on the device (architecture section 5).
- **NFR-OFF-2:** **Needs a network connection:** sign-in, creating a household, invitations, AI import, purchases and restore, data export and account deletion. These are disabled offline, with the offline message. Nothing fails silently.
- **NFR-OFF-3:** **Pending changes:** offline changes are queued in order and survive app restarts and the device rebooting. A pending-changes indicator is visible until they sync.
- **NFR-OFF-4:** **Sync time after reconnecting:** within 10 seconds for up to 500 queued changes (p95, PROPOSED).
- **NFR-OFF-5:** **Conflict rules:** the rules in architecture section 5 apply. A two-device offline test (backlog H-06) must pass: no lost check-offs, no deleted rows coming back, and no duplicate generated items.
- **NFR-OFF-6:** **Stale cache:** if a device has been offline for more than 30 days, the app syncs fully when it reconnects. If its pending changes conflict with a deleted household or a removed membership, they're discarded, and the user is told (PROPOSED).

### 6.3 Security and privacy (household and children's data)

- **NFR-SEC-1:** **Encryption:** all traffic uses TLS 1.2 or later. Data at rest is encrypted by the hosting provider. The session on the device is encrypted (FR-AUTH-5).
- **NFR-SEC-2:** **Household isolation:** every household table enforces isolation with RLS, proved by automated database tests for every table and role (architecture section 4). A failing isolation test blocks merging.
- **NFR-SEC-3:** **Secrets:** the app contains only the publishable key. Secret keys exist only on the server (`CLAUDE.md` human gates).
- **NFR-SEC-4:** **Data minimization:**
  - Children are stored as a display name (a nickname is fine), an age band, and optional dietary codes.
  - No birth dates. The due month only, for expecting parents (D-6).
  - No photos of people.
  - No precise location.
- **NFR-SEC-5:** **Health-related data** (allergies, diets, pregnancy status) is used only to show warnings and default portions. It's never sent to analytics, crash reports, AI prompts or notifications.
- **NFR-SEC-6:** **No personal data in analytics or crash reports:**
  - Analytics events and crash reports contain no names, emails, free text, recipe or list content, or children's details.
  - Sentry is configured to drop request bodies and personal data (architecture section 9).
  - A unit test enforces the analytics schema.
- **NFR-SEC-7:** **Third-party data sharing:** limited to the processors in the architecture: Supabase, Expo, Sentry, PostHog, RevenueCat, Resend and the AI provider. Each is listed in the privacy policy and the store disclosures. No advertising SDKs are included.
- **NFR-SEC-8:** **Invitation tokens:** stored hashed, single use, and expiring after 7 days. Invite codes are rate-limited to 10 wrong attempts an hour per user (PROPOSED).
- **NFR-SEC-9:** **Retention:** AI import images are deleted within 24 hours, and AI job records within 30 days. Deleted accounts follow FR-PRIV-4.
- **NFR-SEC-10:** **Children's privacy laws:** the app is aimed at adults and doesn't knowingly collect data _from_ children. Data _about_ children is treated as sensitive. Legal review (D-11) covers COPPA, US state health-data laws and, before the UK launch, UK GDPR and the Children's Code (ASSUMPTION about which laws apply, to be confirmed by counsel).

### 6.4 Accessibility and one-handed use

- **NFR-A11Y-1:** **Contrast:** meets WCAG 2.2 AA in light and dark mode.
- **NFR-A11Y-2:** **Dynamic type:** every screen works at the largest accessibility text size on both platforms, without clipping or overlapping. Content scrolls instead.
- **NFR-A11Y-3:** **Screen readers:** every interactive element has a localized label and role for VoiceOver and TalkBack. The order is logical, and state is announced (for example "checked, by Alex").
- **NFR-A11Y-4:** **Tap targets:** at least 48 by 48 points, and list rows at least 56 points tall.
- **NFR-A11Y-5:** **One-handed reach:** the main action of every main screen (add a meal, add an item, check off, save) can be reached in the bottom 40% of the screen on a 6.1-inch phone (PROPOSED).
- **NFR-A11Y-6:** **No meaning by color alone:** allergen markers, checked state and errors also use an icon or text.
- **NFR-A11Y-7:** **Motion and haptics:** animations respect Reduce Motion. No sounds, and haptics off by default (FR-NOT-6).
- **NFR-A11Y-8:** **Interruptions:** any in-progress form (a recipe edit, an import review, onboarding) survives the app going to the background and being killed by the operating system, and is restored on return.

### 6.5 Localization

- **NFR-L10N-1:** **No hard-coded strings:** all user-facing strings, including accessibility labels, notifications, emails, print and export text, and errors, come from locale files. CI fails on text written directly in JSX (backlog F-05).
- **NFR-L10N-2:** **Phase 1 locales:** `en-US` ships complete. `en-GB` and `en-AU` contain at least the vocabulary differences (for example nappies, courgette) and are testable in builds. They don't ship to stores until Phase 2.
- **NFR-L10N-3:** **Locale-aware formatting:** dates, times, numbers, currency, plurals and units are formatted through the `Intl`-based helpers. Units follow the household region (section 5.2).
- **NFR-L10N-4:** **Layout:** works with text 100% longer than English (checked with a pseudo-locale) and mirrors correctly in a right-to-left pseudo-locale.
- **NFR-L10N-5:** **Language-neutral data:** ingredients, units, tags, allergens, sections and age bands are stored as language-neutral identifiers.

### 6.6 Reliability

- **NFR-REL-1:** **Crash-free sessions:** at least 99.5% during beta, and at least 99.8% at launch (PROPOSED).
- **NFR-REL-2:** **Backend availability:** 99.9% monthly, which depends on the Supabase plan (D-1). The app keeps working offline during an outage.
- **NFR-REL-3:** **Webhooks and scheduled jobs:**
  - The RevenueCat webhook and notification jobs are idempotent and retried.
  - A nightly reconciliation fixes any entitlement drift within 24 hours.
- **NFR-REL-4:** **Kill switches:**
  - A minimum-version check can force an update.
  - Kill switches can turn off AI import and individual export targets without a release (backlog F-09).
- **NFR-REL-5:** **Data safety:** no user action loses data except explicit deletion. Deletions of plan entries and list items have an undo option within 5 seconds (PROPOSED).

### 6.7 Observability

- **NFR-OBS-1:** **Sentry:** captures crashes and errors with readable stack traces for every build, and performance traces for the NFR-PERF targets.
- **NFR-OBS-2:** **PostHog:**
  - Receives the events in section 3, following the conventions in 3.0.
  - Dashboards cover activation, partner join rate, weekly active households, weeks planned per household, and retention at 4 and 8 weeks (vision metrics).
- **NFR-OBS-3:** **Server-side alerts** fire on:
  - Edge Function error rate over 2%.
  - RevenueCat webhook failures.
  - AI cost per day over a set budget (PROPOSED; the owner sets the budget).
  - Push delivery failures over 5%.
- **NFR-OBS-4:** **Personal data:** none in logs (NFR-SEC-6). Logs are kept for at most 30 days (PROPOSED).

## 7. AI behavior specification

### 7.1 What the AI may do (Phase 1)

- **AI-1:** Turn a web page, pasted text or one image into a draft recipe: title, servings, times, ingredient lines (quantity, unit, ingredient and note), steps, suggested tags from the fixed list, and possible allergens from the fixed codes.
- **AI-2:** Choose units only from the given list of unit IDs, using the household's region to decide ambiguous units. For example, "1 cup" is `unit.cup_us` in the US and `unit.cup_metric` in AU, and "1 tbsp" is `unit.tbsp_au` (20 ml) in AU.
- **AI-3:** Suggest an ingredient name for each line, which our code then matches to the catalog (architecture section 6).
- **AI-4:** Give a confidence score from 0 to 1 for each line.

### 7.2 What the AI must not do

- **AI-5:** Save anything. Every result is a draft until a member confirms on the review screen (the **review-before-save rule**). There's no "auto-save" or "skip review" option.
- **AI-6:** Invent ingredients, quantities or steps that aren't in the source. Missing quantities stay empty and are marked low-confidence. Ingredients it infers (for example "oil for frying") are marked low-confidence.
- **AI-7:** Give medical, nutritional or allergy safety advice, or claim a recipe is safe or allergen-free.
- **AI-8:** Receive household data. Prompts contain only the source content, the locale, the region and the allowed unit and tag lists. No names, people, allergies or plans are sent.
- **AI-9:** Follow instructions found inside imported content. Page and image text is treated as data. A source that tries to change the AI's behavior is parsed as a recipe or rejected.
- **AI-10:** Fetch further links, or act beyond parsing.

### 7.3 Allergen handling and disclaimers

- **AI-11:** **Allergen detection is mainly deterministic:** an ingredient line is flagged when its matched ingredient's catalog allergen codes match a household person's allergy codes. AI flags (for example "may contain nuts" in the source) add to the deterministic flags, and never replace or remove them.
- **AI-12:** **Where flags appear:** on the review screen (FR-AI-7), the recipe detail screen (FR-REC-9), plan entries (FR-PLAN-11) and list items (R-LIST-8), each with the not-medical-advice disclaimer.
- **AI-13:** **Unmatched or low-confidence ingredients** can't be checked for allergens. The review screen says so on those lines, so the absence of a warning is never shown as "safe".
- **AI-14:** **The disclaimer** is shown wherever allergy information appears: the app can miss allergens, packaged products vary, and the user must check labels. The exact text is set by legal review (D-11).

### 7.4 Locale input

- **AI-15:** Every request includes `locale` (such as `en-US`) and `region` (such as `US`). The model is told to keep the original language of titles and steps, read decimal and date formats per the source's locale, and use the region to interpret ambiguous units.
- **AI-16:** A language isn't enabled for import until the evaluation set (7.6) has been passed for it. Phase 1 supports English sources only (ASSUMPTION).

### 7.5 Fallbacks

- **AI-17:** **Link imports** try schema.org recipe data embedded in the page first. If it's present and complete, the AI isn't called. Ingredient lines are still matched to the catalog.
- **AI-18:** **When the model fails**, times out or returns invalid JSON, the request is retried once, with backoff. If it still fails, the user gets the error state with "enter manually instead" (FR-AI-13), and the allowance isn't used.
- **AI-19:** **A partial result** (for example ingredients without steps) is shown as a draft, with the missing parts empty and highlighted.
- **AI-20:** **When the kill switch is on** (NFR-REL-4), the import entry points are hidden, and manual entry remains.

### 7.6 Quality evaluation

- **AI-21:** **Evaluation set:** at least 60 recipes, made up of 20 US, 20 UK and 20 AU sources, mixing links, text, photos and screenshots. Each has a hand-made "gold" parse: ingredient ID, unit ID, base quantity, and allergen codes.
- **AI-22:** **Release thresholds** (PROPOSED):

  | Measure                                    | Threshold                            |
  | ------------------------------------------ | ------------------------------------ |
  | Ingredient matched to the correct ID       | 90% or more of lines                 |
  | Correct unit and base quantity (within 2%) | 95% or more of lines with a quantity |
  | Recall of catalog-mapped allergens         | 100%                                 |
  | Hallucinated lines (not in the source)     | 1% or fewer                          |
  | Median link import latency                 | 8 seconds or less                    |

- **AI-23:** **When the evaluation runs:** in CI on any change to the prompt, model, schema or matching code, and monthly against the live configuration. Results are kept for comparison.
- **AI-24:** **Signals from production:** the share of lines users edit before saving (`ai_import_saved.lines_edited_count`) and the discard rate are tracked per input type. A rise of more than 20% week on week triggers a review (PROPOSED).

## 8. Release and quality

### 8.1 Phase 1 definition of done

Phase 1 is done when all of the following are true:

1. **Every Phase 1 backlog item is merged** with its acceptance criteria met, CI passing, and every `FR-` in this spec covered by a test or a manual test case.
2. **Real use:** two partners can plan a week, share the list and shop from it on iOS and Android in beta (vision).
3. **Quality targets met:** NFR-PERF-1 to 7, NFR-OFF-5, NFR-A11Y-1 to 8 and NFR-REL-1 (beta target), measured in the beta.
4. **AI evaluation thresholds** (AI-22) pass on the release configuration.
5. **The launch gates** in the vision pass: automated tests, privacy and store disclosures updated, internal and beta testing on both platforms, and a staged rollout with a rollback plan.

### 8.2 Beta test plan

- **Phases:**
  1. **Internal:** the team and friends, about 5 households, 1 week.
  2. **Closed beta:** 15 to 25 two-parent households in the US, at least a third on Android, including at least 5 households with a child under 12 months and 3 expecting households, for 4 weeks (PROPOSED).
- **Channels:** TestFlight external testing on iOS, and a Google Play closed testing track. For a personal Play account, at least 12 testers for 14 days is required before production access (D-5).
- **What testers do:** onboard, invite their partner, plan at least 3 weeks, import at least 3 recipes, shop from the list at least twice, including once offline (airplane mode), and export at least once.
- **What we measure:**
  - **Activation:** the share of households that plan a first week and export or shop from the list within 7 days.
  - **Partner join rate.**
  - **Weeks planned per household.**
  - **Retention** at 4 weeks.
  - **Import edit rate.**
  - **Crash-free sessions.**
  - **Sync conflicts reported.**
  - **Accessibility issues found.**
- **Feedback:** an in-app feedback link (an email form, PROPOSED), a weekly 3-question survey, and 5 follow-up interviews.
- **Exit criteria:**
  - Activation of at least 60% and partner join of at least 50% (PROPOSED baselines; the vision sets targets after beta).
  - No open severity-1 bugs (data loss, a privacy leak, a wrong allergen warning, or a crash in a core flow).
  - Crash-free sessions of at least 99.5%.

### 8.3 Launch checklist (US)

Each line needs the product owner's sign-off.

- **Store listings** for `en-US`: name, subtitle, description, keywords, screenshots (with no text baked into images), category, support URL and marketing URL.
- **Apple App Privacy answers and Google Play Data safety form,** matching the data inventory (backlog L-01) and NFR-SEC-7.
- **Age rating questionnaires** completed. The app isn't aimed at children.
- **Privacy policy and terms:** legal review complete (D-11), linked in the app and in the stores, covering health-related data, deletion timing and processors.
- **The not-medical-advice disclaimer text** approved by legal.
- **Account deletion** is reachable in the app and works (an Apple requirement).
- **Sign in with Apple** is present (an Apple requirement when other social sign-in is offered).
- **Subscriptions:** products, prices and trial configured by the owner (D-10). Restore works. Subscription terms are shown on the Premium sheet, as the stores require.
- **Production backend:** the Supabase project, backups and monitoring alerts are live (D-1, NFR-OBS-3).
- **Rollout:**
  - **Staged rollout:** iOS phased release and Android at 10%, 50% and 100%.
  - **Rollback plan:** an OTA revert, the kill switches, and halting the rollout.
- **Submission:** done by the owner or with explicit approval (`CLAUDE.md` human gates).

## 9. Assumptions, open questions and risks

### 9.1 Assumptions

| ID   | Assumption                                                                                                           | If wrong                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| AS-1 | An account belongs to one household in Phase 1.                                                                      | Profiles need a household switcher, and RLS and sync need an "active household" model. |
| AS-2 | Only the US, GB and AU regions, and English sources for AI import.                                                   | The region list and AI evaluation need extending.                                      |
| AS-3 | Deferred deep linking (an invite opened before installing the app) isn't guaranteed, so a code fallback is required. | The flow could be simpler.                                                             |
| AS-4 | Reminders sections can't be set through the public API, so the section goes in the title or notes.                   | Use real sections (backlog G-06 spike).                                                |
| AS-5 | Crash reports may stay on when analytics is turned off.                                                              | Add a crash-reporting opt-out (legal review).                                          |
| AS-6 | COPPA, US state health-data laws, and later UK GDPR and the Children's Code are the relevant laws.                   | Requirements change after legal review (D-11).                                         |
| AS-7 | Local notifications follow the device's timezone, and server notifications follow the household's timezone.          | Adjust FR-NOT-5.                                                                       |
| AS-8 | Starter library recipes can be licensed or written in time (D-8).                                                    | The launch has a thinner library; import must carry the empty-app risk.                |

### 9.2 Open questions needing the product owner's decision

1. **Free-tier numbers (D-9):** 5 free and 100 Premium AI imports a month; 4 weeks of free history; 6 Premium seats; 50 templates; 14-day trial (D-10). All PROPOSED.
2. **Onboarding (D-6):** ask "expecting, or how old is your youngest?" with age bands and the due month only? Age range pregnancy to 5 (vision) or narrower?
3. **"Have" scope (R-PAN-2):** should "I already have this" last only for the current week (PROPOSED), or until the user removes it?
4. **"List is ready" trigger (FR-NOT-4):** an explicit button, an automatic trigger when the week is planned, or both (PROPOSED: both, at most once a day)?
5. **Deleting a household with two parents (FR-PRIV-7):** require the other parent's confirmation (PROPOSED), or let either parent delete?
6. **Embedded-data link imports free (FR-AI-8):** don't count imports that need no AI call (PROPOSED)?
7. **No ads (FR-PAY-11):** confirm, as the vision proposes (D-11).
8. **Product name and domain (D-2):** blocks invite links, email sign-in and store listings.

### 9.3 Conflicts and gaps found with the other docs

- **C-1, purchase memory phase.** The vision's Phase 1 section and the free table include purchase memory ("frequently bought items" free; recommendations Premium). The roadmap table puts "purchase memory and recommendations" in Phase 2.
  - **This spec:** puts the foundation and frequently bought suggestions in Phase 1, and recommendations in Phase 2.
  - **Backlog:** has no item for frequently bought suggestions (G-04 only records events).
  - **Proposed fix:** add backlog item **G-09 frequently bought suggestions (S)**. Owner to confirm the split, and whether the vision's roadmap should say "recommendations" only.
- **C-2, Phase 1 extras in the vision.** The vision's Phase 1 section lists voice import, barcode scanning, widgets and lock-screen shortcuts, pantry expiry and running-low flags, while its MVP row and the backlog leave them out. This spec follows the MVP row (section 1.3). Owner to confirm.
- **C-3, notifications.** The brief for this spec mentions running-low alerts. They depend on pantry quantities, which are out of scope, so Phase 1 has only the four types in FR-NOT-1.
- **C-4, a "defrost" tag.** FR-REC-7 adds a `needs-defrosting` tag to the vision's tag list, so the "defrost tonight" nudge from the vision can work. The catalog and backlog R-03 need this tag added.
- **C-5, history window.** The backlog's G-08 says "last 4 weeks (number to confirm)". This spec uses the same number and marks it PROPOSED.
- **C-6, the spec file itself.** PR #2 deleted the empty `docs/spec.md` template, and this real spec replaces it. `docs/README.md`, `CLAUDE.md` and `architecture.md` now link to it.
- **C-7, pushing to `main`.** The brief asks for a direct push to `main`, but branch protection (PR and CI required, admins included) blocks it. This spec ships in PR #2 with the other planning docs.

### 9.4 Risks

| Risk                                                                              | Impact                                | Mitigation                                                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Offline sync conflicts are more complex than row-level last-write-wins can handle | Lost or reappearing items erode trust | The H-06 spike with two-device tests before building features. The PowerSync fallback.                                             |
| A missed allergen in an import or a household ingredient                          | Safety and legal                      | Deterministic catalog flags, no "safe" claims (AI-13), disclaimers, an evaluation set with 100% allergen recall, and legal review. |
| Unit merging errors (for example an AU tablespoon treated as a US one)            | Wrong shopping quantities             | Regional unit IDs, the region in AI prompts, and unit tests per region.                                                            |
| Free tier too generous or too stingy                                              | Revenue or word of mouth              | PROPOSED numbers tuned from beta data. Limits are set on the server and configurable without a release.                            |
| AI cost spikes                                                                    | Margin                                | Embedded-data parsing first, quotas, rate limits, cost alerts and the kill switch.                                                 |
| Google Play's closed-test requirement delays the Android launch                   | Schedule                              | Start closed testing early (D-5).                                                                                                  |
| Children's and health data rules                                                  | Legal and store rejection             | Data minimization, no ads or tracking SDKs, legal review before external beta.                                                     |
| The partner never joins                                                           | Weak core value                       | Invite prompts in the empty states, a code fallback, and measuring partner join rate in beta.                                      |
