# Parent Manager: Phase 1 (MVP) backlog

Status: draft for the product owner's review. No GitHub issues exist yet. Once approved, each item becomes one issue, one branch and one PR (see [CLAUDE.md](../CLAUDE.md)).

**Scope.** This covers Phase 1 plus the household foundation, as described in the MVP row of [vision.md](vision.md):

- Accounts and a household with partner sharing
- Recipes, manual and imported
- The weekly planner
- An auto-built grocery list with pantry de-selection, shared and usable offline
- Print and native list export
- A weekly reminder
- A localization-ready US English build
- The free tier and the first Premium features: caregiver seats, a larger AI import allowance, saved templates and history

The design behind these items is in [architecture.md](architecture.md).

**Done when** two partners can plan a week, share the list and shop from it on both platforms in beta testing.

**Sizes:**

| Size | Effort                         |
| ---- | ------------------------------ |
| S    | Up to 1 day                    |
| M    | 2 to 3 days                    |
| L    | About a week                   |
| XL   | Too big; split before starting |

**Order:** items are grouped by area, starting with the foundation, and are roughly in build order. The dependencies decide what can start: an item can start once its dependencies are done, even if it appears earlier in the list. P-05, for example, waits for M-03. Each item's acceptance criteria include the standing rules in `CLAUDE.md`: no hard-coded strings, RLS with database tests, CI passing, and tests for new logic.

## Foundation

### F-01 Project setup (done)

The Expo SDK 58 TypeScript app, Expo Router, ESLint and Prettier, Jest, the Maestro smoke test, CI and E2E workflows, the linked Supabase and EAS projects, and branch protection. Delivered in PR #1.

- **Acceptance:** met.
- **Depends on:** none.
- **Size:** done.

### F-02 Move to pnpm

Replace npm with pnpm, keeping Expo's `hoisted` mode, and update CI, the E2E workflow, the README and `CLAUDE.md`.

- **Acceptance:**
  - `pnpm install` and `pnpm run check` pass locally and in CI.
  - `package-lock.json` is removed and `pnpm-lock.yaml` is committed.
  - Android E2E passes on `main`.
  - `expo-doctor` passes.
- **Depends on:** F-01.
- **Size:** S.

### F-03 Separate environments

Set up development (local Supabase), staging (the existing project) and production (a new project):

- `app.config.ts` gives each environment its own bundle ID, app name and icon badge.
- EAS environment variables point each build profile at the right Supabase project.
- `expo-updates` is installed with update channels and fingerprint-based runtime versions.

**Acceptance:**

- All three variants install side by side.
- Each variant reaches only its own backend.
- An OTA update published to `preview` reaches only preview builds.
- The README documents the environments.

**Depends on:** F-02, and the decision on a Supabase production project (D-1).

**Size:** M.

### F-04 CI for the backend and iOS

Add CI jobs for the backend and for iOS:

- **Database tests:** start a local Supabase stack, apply the migrations and run the pgTAP tests.
- **Edge Functions:** run their Deno tests.
- **iOS E2E:** add iOS E2E on a macOS runner.
- **Staging migrations:** apply them automatically after a merge, using a token the product owner adds as a GitHub secret.
- **Production migrations:** a manually approved workflow behind a protected "production" environment.

**Acceptance:**

- A PR with a failing RLS test is blocked.
- iOS and Android E2E both pass on `main`.
- Staging receives migrations after a merge.
- Production needs approval.

**Depends on:** F-03.

**Size:** M.

### F-05 Localization foundation

Set up the localization framework:

- `i18next` and `react-i18next` with `expo-localization`.
- Locale files for `en-US`, `en-GB` and `en-AU`, with fallback to `en-US`.
- `Intl` helpers for dates, numbers, currency and quantities with units.
- A pseudo-locale for development builds.
- A lint rule that blocks text written directly in JSX.
- All existing UI copy moved into the locale files.

**Acceptance:**

- The lint fails on a hard-coded string.
- The pseudo-locale shows no unwrapped text.
- Unit tests format quantities correctly for the US (cups and oz) and AU (ml and g, with a 20 ml tablespoon).

**Depends on:** F-01.

**Size:** M.

### F-06 Design system foundation

Turn the chosen design direction, Calm Kitchen with Village touches (`docs/design-directions.md`, board `docs/design/direction-ac.html`), into the app's design system:

- **Tokens:** color, type, spacing and radius, in light and dark.
- **Core components:** button, list row with a large tap target, bottom sheet, text field, checkbox row, empty state, toast and section header.
- **Accessibility:** dynamic type support and accessibility props on every component.
- **Navigation:** the floating bottom tab bar.
- **Village touches:** the member avatar component, the progress bar, the usual-items grid and the completion screen.

**Acceptance:**

- Components render correctly at the largest dynamic type size and in dark mode.
- Tap targets are at least 48 points.
- Contrast meets WCAG AA.
- A component gallery screen exists in development builds.

**Depends on:** F-05. The design-direction decision (D-3) is made.

**Size:** L.

### F-07 Observability

Add Sentry (with the Expo plugin and source maps from EAS builds) and PostHog (with session replay off). Both scrub personal data. Add an analytics wrapper that only accepts typed events, carrying IDs and fixed values. Define the activation events from the vision's metrics.

- **Acceptance:**
  - A test crash appears in Sentry with readable stack traces and no user content.
  - Activation events appear in PostHog.
  - A unit test proves the wrapper rejects free-text properties.
- **Depends on:** F-03, and the Sentry and PostHog accounts (D-4).
- **Size:** M.

### F-08 Encrypted session storage

Store the Supabase session encrypted: an AES key in `expo-secure-store`, and the encrypted session in local storage.

- **Acceptance:**
  - The session survives an app restart.
  - The stored value isn't readable as plain text.
  - Signing out clears both the key and the session.
- **Depends on:** F-01.
- **Size:** S.

### F-09 Remote config, forced update and kill switches

Add an `app_config` table, readable by everyone. The app checks it at launch: below the minimum version it shows a blocking "please update" screen with a store link. Kill switches can turn off AI import and export.

- **Acceptance:**
  - Setting a minimum version above the installed build shows the update screen, and lowering it removes it.
  - The check fails open when offline.
- **Depends on:** F-03.
- **Size:** S.

## Accounts and household

### H-01 Household schema and RLS

Create the database tables for households:

- **Tables:** `profiles`, `households`, `household_members`, `invitations`, `household_people`, `person_dietary`, `household_entitlements` and `app_config`.
- **Access checks:** the `private.household_role()` helper and RLS policies on every table.
- **Tests:** pgTAP tests for two households across all three roles.

**Acceptance:**

- Cross-household reads and writes fail for every table.
- Caregivers can't manage members.
- Clients can't insert into `household_members` or `household_entitlements` directly.

**Depends on:** F-04.

**Size:** M.

### A-01 Email sign-in

Add sign-in and sign-up by email, through Supabase Auth with Resend sending over SMTP from the product domain:

- **Methods:** a one-time code, plus a magic link.
- **Profile:** created on first sign-in.
- **Sign-out:** included.

**Acceptance:**

- A new user can sign up and sign in on both platforms with a code.
- Email copy comes from translations.
- Maestro covers sign-in using local Supabase's test inbox.

**Depends on:** F-05, F-06, F-08, H-01, and the product domain and Resend account (D-2, D-4).

**Size:** M.

### A-02 Sign in with Apple and Google

Add native Apple and Google sign-in through `signInWithIdToken`. If an account already exists with the same verified email, it's linked rather than duplicated.

- **Acceptance:**
  - Both methods work on real devices.
  - Apple's button follows Apple's guidelines.
  - Cancelling returns cleanly to sign-in.
- **Depends on:** A-01, and the Apple and Google developer accounts (D-5).
- **Size:** M.

### H-02 Onboarding: create a household

Onboarding asks for:

1. A household name.
2. The region (US, GB or AU), which sets units, locale and timezone.
3. The people being fed (adults and children by age band).

Smart defaults throughout, and it can be finished in under a minute one-handed.

- **Acceptance:**
  - A new user lands on the Plan tab with a household after at most four screens.
  - The region changes how units are displayed.
  - No exact birth dates are collected.
- **Depends on:** A-01, H-01, and the decision on due date versus age (D-6).
- **Size:** M.

### H-03 Invite a partner

A parent creates an invitation as a link (universal or App Link) or a 6-character code. The partner accepts through the `accept_invitation` RPC:

- **Tokens:** hashed, expiring after 7 days and single-use.
- **Management:** an invitation can be revoked, and the inviter sees pending invitations.

**Acceptance:**

- A second account joins as a parent from a link or code on either platform.
- A third parent is rejected on the free tier, enforced on the server.
- Expired and revoked tokens fail with clear copy.
- There's a pgTAP test for the RPC.
- Maestro covers joining by code.

**Depends on:** H-02, and the domain for universal links (D-2). The code fallback works without the domain.

**Size:** L.

### H-04 Members and roles

The Household tab lists members and their roles:

- **Parents** can remove members, change roles, leave the household, and transfer the last-parent role before leaving.
- **Caregiver and family invitations** are available only with Premium (see M-03).

**Acceptance:**

- Role limits match the roles table in architecture section 3.1, with tests.
- The last parent can't leave without transferring or deleting the household.

**Depends on:** H-03.

**Size:** M.

### H-05 People and allergy profiles

Add, edit and remove household people, with diets and allergies chosen from fixed allergen and diet codes (the US top 9 at launch, and the UK and EU 14 included in the data). A "not medical advice" disclaimer appears where profiles are edited and where warnings are shown.

- **Acceptance:**
  - Allergies are stored as codes.
  - The disclaimer is visible.
  - Profiles are always free.
  - Deleting a person removes their dietary rows.
- **Depends on:** H-02.
- **Size:** M.

### H-06 Sync foundation: spike, then build

**Spike (S):** test Legend-State's Supabase sync on a throwaway list table across two devices. It passes if:

- Edits made offline on both devices merge according to the rules in architecture section 5.
- Check-offs never go backwards.
- Deletes don't come back.
- A change on one online device reaches the other within 2 seconds.

If it fails, write up PowerSync as the alternative for the product owner's decision.

**Build (L):** the sync layer in `src/lib/sync`: local SQLite persistence, an outbox, Realtime subscriptions scoped by household, `updated_at` and `version` set by the server, soft deletes, and an indicator of pending sync.

**Acceptance:**

- The spike passes.
- A test harness simulates two offline clients.
- The app starts and shows cached data in airplane mode.

**Depends on:** H-01.

**Size:** S spike plus L build.

### A-03 Biometric unlock

An optional Face ID, Touch ID or fingerprint lock when the app opens, set up in Household settings. It requires the existing session and falls back to the device passcode.

- **Acceptance:**
  - With the lock on, a cold start needs biometrics.
  - With it off, there's no prompt.
  - It's never required to use the app.
- **Depends on:** A-01.
- **Size:** S.

### A-04 Account deletion and data export

**Deletion:** deleting an account in the app removes the user. Households where they're the only member are deleted after confirmation, and other households carry on.

**Export:** produces a JSON and CSV archive of the household's data through the share sheet. Both are always free.

**Acceptance:**

- After deletion the user can't sign in, and none of their personal rows remain.
- The export contains every household table listed in the architecture.
- A test fails if a new table isn't covered by the export.

**Depends on:** H-04, R-02.

**Size:** M.

## Recipes

### R-01 Ingredient and unit catalog

Create the catalog tables and versioned seed data:

- **Units:** US customary, metric and regional sizes, with conversion factors.
- **Store sections.**
- **Ingredients:** about 400 common ones, with `en-US`, `en-GB` and `en-AU` names, synonyms, allergen codes, default staples and densities for common items.
- **Client lookup:** a matching helper the client can use.

**Acceptance:**

- "1 cup milk" and "2 cups milk" merge to 3 cups (US).
- 2 Australian tablespoons are 40 ml.
- "courgette" and "zucchini" resolve to the same ID.
- The seed loads in CI.

**Depends on:** H-01, F-05.

**Size:** L.

### R-02 Manual recipes

Create and edit a recipe:

- **Details:** a title, servings, times and tags.
- **Ingredients:** each line has a quantity, a unit picker and an ingredient picker that searches the catalog and allows a custom ingredient.
- **Steps.**
- **Saving:** works offline through sync.

**Acceptance:**

- A recipe with 10 ingredients can be entered with one thumb.
- It appears on the partner's device.
- `quantity_base` is calculated correctly.
- Maestro covers creating a recipe.

**Depends on:** R-01, H-06, F-06.

**Size:** L.

### R-03 Recipe library, search and scaling

Add the recipe screens:

- **Recipes tab:** the household's recipes and the starter library, a local search, and tag filters (no-cook, one-handed, freezer-friendly, batch-prep, quick, kid-friendly, toddler, baby-led weaning).
- **Detail screen:** scales quantities by servings.

**Acceptance:**

- Search works offline.
- Scaling 4 to 6 servings converts quantities correctly in both unit systems.

**Depends on:** R-02.

**Size:** M.

### R-04 Starter library

Load about 40 to 60 starter meals, weighted toward new-parent tags, with properly licensed content, in US English with metric versions for later. They're read-only, and "save a copy" makes them editable.

- **Acceptance:**
  - A new household sees useful meals on day one.
  - Every recipe's ingredients use catalog IDs.
  - Content rights are recorded.
- **Depends on:** R-03, and the decision on content source and licensing (D-8).
- **Size:** M, plus content work.

### R-05 AI import backend

Add the `import-recipe` Edge Function for links (schema.org data first, then text extraction) and pasted text:

- **LLM parsing:** structured output that includes the locale and region.
- **Normalization:** matching units and ingredients to the catalog.
- **Quotas:** reserved and released atomically, with rate limits and a cost ceiling.
- **Jobs:** job records purged after 30 days.

**Acceptance:**

- The evaluation set of US, UK and AU recipes meets the agreed accuracy on ingredient and unit mapping.
- The quota can't be exceeded under concurrent requests (test).
- Private IP addresses are refused.
- No household data is sent to the provider.

**Depends on:** R-01, the AI provider decision and account (D-7), and the free-tier limits (D-9).

**Size:** L.

### R-06 Import review screen

Add the import flow and the review step:

- **Import flow:** paste a link or text, then a progress state, then a review screen showing the draft.
- **Highlights:** low-confidence lines, unmatched ingredients and allergen matches against household profiles (with the disclaimer).
- **Editing:** every line can be edited before saving. Nothing is saved without confirmation.
- **Quota:** the screen shows the quota remaining, with an upgrade prompt when it runs out.

**Acceptance:**

- Cancelling saves nothing.
- An allergen that matches a profile is visibly flagged.
- Maestro covers importing a link, using a mocked LLM in CI.

**Depends on:** R-05, R-02, H-05.

**Size:** M.

### R-07 Photo and screenshot import

Pick an image from the camera or library, compress it on the device and upload it to the temporary bucket, then run it through the same pipeline and review screen. Uploads are deleted after processing.

- **Acceptance:**
  - A cookbook photo and a screenshot both produce reviewable drafts.
  - The bucket is empty again within 24 hours.
  - Permissions are requested only when first needed.
- **Depends on:** R-06.
- **Size:** M.

## Planner

### P-01 Weekly planner

A week grid with slots for breakfast, lunch, dinner, snacks and drinks:

- **Adding:** tap a slot to add a recipe, from search or recents, or free text such as "takeout". Each entry has servings.
- **Moving:** swipe between weeks, and long-press to move an entry.
- **Offline and sharing:** works offline and syncs live with a partner.

**Acceptance:**

- A week of 7 dinners can be planned in under 2 minutes, one-handed.
- A partner sees changes within 2 seconds.
- Maestro covers planning a week.

**Depends on:** R-03, H-06, F-06.

**Size:** L.

### P-02 Copy last week

One tap copies the previous week's entries into the current week. If the current week already has entries, it asks whether to merge or replace.

- **Acceptance:** dates shift correctly across month boundaries and daylight-saving changes in the household's timezone.
- **Depends on:** P-01.
- **Size:** S.

### P-03 Portions and baby plates

Set portions per person on an entry, defaulting from the household's people, with a separate "baby plate" variant for infants and toddlers. Servings drive the grocery quantities.

- **Acceptance:** list quantities change as expected when portions change (unit tests).
- **Depends on:** P-01, H-05.
- **Size:** M.

### P-04 Leftover links

Mark an entry as leftovers of an earlier meal, for example tomorrow's lunch. The linked entry adds nothing to the list, but the original's servings grow to cover it.

- **Acceptance:** linking and unlinking updates the list correctly.
- **Depends on:** P-03, G-01.
- **Size:** S.

### P-05 Saved week templates (Premium)

Save a week as a template and apply it to any week. Locked behind Premium (see M-03).

- **Acceptance:** applying a template matches the saved slots.
- **Depends on:** P-02, M-03.
- **Size:** M.

## Grocery list

### G-01 List-generation engine

Pure TypeScript functions that turn plan entries, recipes, portions, the pantry and existing items into list items, following the merge and keep-edits rules in architecture section 3.2. They return sections in the household's order.

- **Acceptance:**
  - Unit tests cover merging, scaling, mixed dimensions (kept apart), pantry and staple exclusion, and regeneration preserving edited and checked items.
  - A 7-day plan builds in under 100 ms on a mid-range Android phone.
- **Depends on:** R-01, P-03.
- **Size:** L.

### G-02 Grocery list screen

Show the list for the week:

- **Layout:** grouped by store section, with large checkbox rows. Checked items move to a collapsed "done" area.
- **Editing:** add an item by typing, with catalog suggestions, and edit quantities.
- **Sources:** "from: Tuesday's chili" shows where an item came from.
- **Regenerate:** a button with a summary of what changed.

**Acceptance:**

- Items can be checked off with one thumb while holding a basket, with targets of at least 48 points.
- All actions work offline.
- Maestro covers building and checking off a list.

**Depends on:** G-01, F-06.

**Size:** L.

### G-03 Pantry: staples and "I have it"

Add a staples list with defaults from the catalog, editable. Long-press or swipe an item for "I already have this", which removes it now and remembers it for this week. A pantry screen shows what's hidden and why.

- **Acceptance:**
  - Staples never appear on the list unless the user turns them back on.
  - "I have it" syncs to the partner.
- **Depends on:** G-02.
- **Size:** M.

### G-04 Shared offline shopping

Harden the shared list for in-store use:

- **Check-off rules:** apply the rules in architecture section 5, recording who checked an item and when.
- **Status:** a "partner is updating" state and an offline banner.
- **Purchase events:** each check-off writes a `purchase_events` row for Phase 2.

**Acceptance:** two devices shopping offline at the same time and then reconnecting end with a consistent list, with no duplicates or items coming back (two-device test).

**Depends on:** G-02, H-06.

**Size:** M.

### G-05 Print and PDF export

A localized HTML template, grouped by section with checkboxes, printed through `expo-print` or saved as a PDF and shared.

- **Acceptance:**
  - The printout matches the in-app sections.
  - US and AU units render correctly.
  - It works offline.
  - It's free.
- **Depends on:** G-02.
- **Size:** M.

### G-06 Apple Reminders export (iOS)

Request the reminders permission when first used, then create or update a "Groceries" list in Reminders with one item per entry. First, a spike on how to represent sections, since the public API may not support Reminders' own sections. Re-exporting updates the same list instead of duplicating it.

- **Acceptance:**
  - Items appear in the Reminders app.
  - A re-export doesn't duplicate items.
  - Refusing permission falls back to sharing text.
  - It's free.
- **Depends on:** G-05.
- **Size:** M.

### G-07 Share and copy as text (Android and iOS)

Plain checklist text (`☐ 2 l milk`) grouped by section, sent through the share sheet (to Keep, Google Tasks, messages or email), with a Copy action.

- **Acceptance:**
  - The text pastes cleanly into Google Keep, Messages and Gmail.
  - The format is localized.
- **Depends on:** G-05.
- **Size:** S.

### G-08 List and plan history (free window plus Premium)

Show past weeks' plans and lists. Free households see the last 4 weeks (number to confirm), and Premium sees all.

- **Acceptance:**
  - The free window is enforced on the server.
  - Lapsed Premium hides older weeks without deleting them.
- **Depends on:** G-04, M-03, and the free history window (D-9).
- **Size:** M.

## Notifications

### N-01 Push notifications and preferences

Set up push notifications:

- **Device:** `expo-notifications`, push token registration and an in-app inbox.
- **Settings:** per-type preferences and quiet hours.
- **Sending:** an Edge Function sends through the Expo push service and checks preferences and quiet hours on the server.
- **Copy:** localized on the server.

**Acceptance:**

- A test notification reaches both platforms.
- Quiet hours delay delivery.
- Turning a type off stops it.

**Depends on:** H-04, F-03.

**Size:** L.

### N-02 Weekly "plan your week" and "list is ready"

A `pg_cron` schedule sends "plan your week" at a default time in the household's timezone. "List is ready" is sent to the partner when the other parent finishes the list. "Defrost tonight" is an optional local reminder for recipes tagged as needing defrosting.

- **Acceptance:**
  - Sent at the right local time for US time zones.
  - Respects preferences.
  - Can be turned off with one tap from the notification.
- **Depends on:** N-01, P-01.
- **Size:** M.

## Subscriptions

### M-01 RevenueCat and household entitlement

Integrate RevenueCat for household subscriptions:

- **App:** `react-native-purchases`, with the app user ID set to the Supabase user ID and the `household_id` attribute.
- **Webhook:** an Edge Function upserts `household_entitlements` and is idempotent.
- **Reconciliation:** a nightly job.
- **Sandbox:** sandbox purchases on both platforms.

Products and prices are configured by the product owner, not by Claude.

**Acceptance:**

- A sandbox purchase gives every member Premium within a minute.
- Expiry or a refund reverts the household to free without deleting data.
- A replayed webhook is harmless.

**Depends on:** H-04, F-03, and the store accounts, RevenueCat account, products and prices (D-5, D-10).

**Size:** L.

### M-02 Paywall prompts, trial and restore

Add upgrade prompts and the purchase flow:

- **Prompts:** specific "unlock this" sheets at the moment of need, such as a caregiver invitation, an exhausted AI allowance, templates or history. No blocking paywall.
- **Purchase:** offerings from RevenueCat, a trial offer, restore purchases, and Household → Subscription status.

**Acceptance:**

- Every Premium gate shows a specific prompt.
- Restore works on a reinstall.
- Copy and prices are localized.

**Depends on:** M-01.

**Size:** M.

### M-03 Premium gates

Enforce the Premium features on the server and in the app:

- **Server:** family and caregiver seats, the AI allowance tiers, saved templates and history beyond the free window. Multiple lists come after the MVP.
- **App:** gates read the household entitlement.
- **Lapse:** caregivers lose access, but their data and memberships remain.

**Acceptance:**

- pgTAP tests cover seat limits with and without an entitlement.
- After a lapse, everything is still exportable.

**Depends on:** M-01, H-04, R-05, and the free-tier limits (D-9).

**Size:** M.

## Release

### L-01 Privacy, legal and store disclosures

Prepare the privacy and legal material:

- **Data inventory:** what we store, where and why.
- **Store disclosures:** Apple's App Privacy answers and Google Play's Data safety form, drafted from the inventory.
- **Legal documents:** a privacy policy and terms (needing legal review) and links to them in the app.
- **Consent:** for analytics where required.
- **Ads:** "no ads" confirmed.

**Acceptance:**

- Every table and third party in the architecture is in the inventory.
- Legal review is signed off before the external beta.

**Depends on:** F-07, and the legal counsel decision (D-11).

**Size:** M, plus legal work.

### L-02 Accessibility and one-handed audit

Audit the core flows: VoiceOver and TalkBack, the largest dynamic type, dark mode, reachability of the main actions, and the interrupted-use test (leaving mid-task and returning).

- **Acceptance:** no blocking issues in the core flows, with screen-reader labels covered by component tests.
- **Depends on:** G-07, P-05.
- **Size:** M.

### L-03 Beta on both platforms

Run the beta on TestFlight internal and external testing, and on Google Play internal and closed testing:

- **Testers:** at least 12 testers for 14 days on Play if the account is a personal one.
- **Users:** real partner pairs.
- **Release plan:** a staged rollout and a rollback plan (an OTA revert, plus a kill switch).

**Acceptance:**

- 10 or more two-parent households complete a planned week and a shared list on both platforms.
- The activation funnel is visible in PostHog.

**Depends on:** L-01, L-02, M-02, and the product owner's approval of each submission.

**Size:** M.

### L-04 US store listings

Write the store name, subtitle, description, keywords, screenshots, the age rating questionnaire and the category, all localized for `en-US`.

- **Acceptance:** the listings are ready for review, and the screenshots show no text baked into imagery that can't be localized later.
- **Depends on:** the product name (D-2), F-06, L-01.
- **Size:** S.

## Deliberately after the MVP

The vision includes these, but they're outside the MVP row and are held back to protect the timeline:

- Voice recipe import and voice capture
- Widgets, lock-screen shortcuts and Siri or Google Assistant shortcuts
- The share extension
- Barcode scanning
- Receipt scanning
- Pantry quantities and expiry
- Purchase-memory recommendations
- "Fill my week" suggestions
- Multiple lists and custom aisle order
- Price and budget estimates
- Email digests

Each can become its own issue after the beta.
