# Parent Manager: architecture

Status: proposal for review, 2026-11-07. [vision.md](vision.md) is the source of truth for scope, and [spec.md](spec.md) defines how Phase 1 behaves. This document describes how we build it, and [backlog.md](backlog.md) breaks the work into Phase 1 items. Decisions that need the product owner are marked **Decision** and collected in [decisions-needed.md](decisions-needed.md).

## 1. Where we start

PR #1 already delivered:

- **App:** an Expo SDK 58 app with TypeScript and Expo Router, building for iOS and Android.
- **Bundle ID:** `com.myparentmanager` on both platforms. The first choice, `com.parentmanager.app`, was already registered with Apple by someone else.
- **Supabase:** a client and the CLI project folder, linked to the hosted project `parent-manager` in us-east-1.
- **EAS:** the project `@abhinav08/parent-manager`, with development, preview and production build profiles.
- **Tooling:** ESLint and Prettier, Jest, a Maestro smoke test, and GitHub Actions running CI on every PR and E2E on `main`.
- **Protection:** `main` requires a PR and passing CI, for admins too.

Gaps against the fixed stack:

- **Environments:** one Supabase project serves every environment (F-03).
- **Monitoring and payments:** Sentry, PostHog, RevenueCat and Resend aren't added yet.
- **Session storage:** the session is stored unencrypted (F-08).

### Challenges to the fixed stack

The stack holds up. Three gaps need an addition or a decision, not a replacement:

1. **Offline sync.** The stack has no piece for offline data with conflict handling. Supabase Realtime pushes live changes but doesn't keep an offline copy, so we add a sync library (section 5).
2. **An AI provider.** Recipe import needs a large language model (LLM) that can read images. It isn't in the stack, so it's a **Decision** (section 6).
3. **pnpm.** It works with Expo, and new Expo projects use pnpm's `hoisted` mode. pnpm's stricter default mode can break native module resolution in React Native, so F-02 keeps `hoisted`. No reason to change the choice.

## 2. Repo structure and navigation

```
src/
  app/                      Expo Router routes only
    (auth)/                 sign-in, verify code
    (onboarding)/           create or join a household, region, people
    (tabs)/                 main app
      plan/                 weekly planner (default tab)
      list/                 grocery list
      recipes/              library, detail, edit
      household/            members, settings, subscription, privacy
    import/                 recipe import flow (modal stack)
    invite/[token].tsx      invitation deep link
    paywall.tsx             modal
  features/<module>/        components, hooks and data access per module
  components/               shared UI kit (design system)
  i18n/                     i18next setup, locale files, Intl formatters
  lib/                      supabase, sync, analytics, sentry, purchases, notifications
supabase/
  migrations/               SQL migrations
  functions/                Edge Functions (Deno): import-recipe, revenuecat-webhook, notify, invite, account
  tests/                    pgTAP database tests (RLS isolation)
  seed/                     ingredient, unit, section and starter-recipe seed data
```

### Navigation

- **Bottom tabs,** in the order Plan, List, Recipes, Household. Bottom tabs keep the main actions in thumb reach.
- **One main action per screen,** placed at the bottom: add a meal, add an item or import.
- **Bottom sheets for secondary flows** instead of full-screen pushes, so a parent who gets interrupted keeps their place.
- **Tab shell:** `src/app/(tabs)/_layout.tsx` uses Expo Router's headless tabs (`expo-router/ui`) with the design system's `FloatingTabBar`, so the bar is drawn from tokens rather than styled on top of a native tab bar. Each tab is a folder (`plan/`, `list/`, `recipes/`, `household/`), so a feature can add its own stack later. Tab screens use `Screen`, which pads scrolling content by `layout.tabBarClearance` plus the bottom safe area. `/` redirects to `/plan`.
- **Component gallery:** `/gallery` shows every shared component, with switches for light, dark and the largest text size. It's a protected route that exists only in development builds, opened from the Household tab.

### Deep links

- **Links:** the app's link scheme for development, plus universal links (iOS) and App Links (Android) on the product domain. These handle invitations and, later, meal-train links.
- **Domain:** this needs a domain. **Decision:** the product name and domain.

## 3. Data model

All tables live in Postgres. Every table holding household data has `household_id`, `created_at`, `updated_at` (set by the server) and `deleted_at` (a soft-delete marker, which sync needs). Primary keys are UUIDs that the client can generate, so a row can be created offline.

### 3.1 Shared household layer

| Table                    | Key columns                                                                                                                                               | Notes                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `profiles`               | `id` (= `auth.users.id`), `display_name`, `locale`, `active_household_id`                                                                                 | One per account.                                                                                                        |
| `households`             | `id`, `name`, `region` (`US`, `GB` or `AU`), `locale` (`en-US`, `en-GB` or `en-AU`), `unit_system` (`us_customary` or `metric`), `timezone`, `week_start` | Region sets the default units, store sections and later holidays.                                                       |
| `household_members`      | `household_id`, `user_id`, `role` (`parent`, `family` or `caregiver`), `status`, `joined_at`                                                              | Unique on `(household_id, user_id)`. The free tier allows at most 2 members with the `parent` role.                     |
| `invitations`            | `id`, `household_id`, `role`, `invited_by`, `token_hash`, `email` (optional), `expires_at`, `accepted_by`, `revoked_at`                                   | Accepted by link or short code. Only the token's hash is stored, and a token works once.                                |
| `household_people`       | `id`, `household_id`, `display_name`, `kind` (`adult` or `child`), `age_band`, `linked_user_id` (optional)                                                | The people being fed, including children without accounts. Age bands, not birth dates (see section 3.3).                |
| `person_dietary`         | `person_id`, `type` (`allergy`, `diet` or `avoid`), `code`                                                                                                | Codes are fixed identifiers: allergens such as `allergen.peanut`, diets such as `diet.vegetarian`, or an ingredient ID. |
| `household_entitlements` | `household_id`, `tier` (`free` or `premium`), `status`, `period_ends_at`, `purchaser_user_id`, `rc_app_user_id`, `updated_at`                             | Written only by the RevenueCat webhook (section 8).                                                                     |
| `app_config`             | `key`, `value`                                                                                                                                            | Minimum supported app version, kill switches. Anyone can read it.                                                       |

### Roles

|                                  | Parent         | Family member  | Caregiver            |
| -------------------------------- | -------------- | -------------- | -------------------- |
| Plans, recipes, lists and pantry | Read and write | Read and write | Read; write the list |
| Members, invitations, settings   | Manage         | No             | No                   |
| Subscription                     | Manage         | No             | No                   |

Family members and caregivers are Premium seats.

### 3.2 Phase 1 entities

#### Catalog

These tables are global and read-only, filled from versioned seed data:

| Table              | Key columns                                                                                                                                                                                                           | Notes                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `units`            | `id` (such as `unit.cup_us`, `unit.cup_metric`, `unit.tbsp_au`, `unit.g` or `unit.each`), `dimension` (`mass`, `volume` or `count`), `to_base` (factor to g, ml or each), `systems`                                   | Each unit with a regional size gets its own ID: US cup 236.6 ml, metric cup 250 ml, Australian tablespoon 20 ml, US pint 473 ml, imperial pint 568 ml. |
| `store_sections`   | `id` (such as `section.produce` or `section.dairy`), `default_order`                                                                                                                                                  |                                                                                                                                                        |
| `ingredients`      | `id` (such as `ingredient.milk`), `household_id` (null for catalog items, set for a household's own items), `default_dimension`, `density_g_per_ml` (optional), `section_id`, `allergen_codes[]`, `is_default_staple` |                                                                                                                                                        |
| `ingredient_names` | `ingredient_id`, `locale`, `name`, `plural`, `synonyms[]`                                                                                                                                                             | `en-US` "zucchini", `en-GB` "courgette", `en-AU` "zucchini".                                                                                           |

Unit, section, tag and allergen names live in the app's locale files. Ingredient names live in the database, because the catalog grows without app releases.

#### Recipes

| Table                | Key columns                                                                                                                                                                                                                                            | Notes                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `recipes`            | `id`, `household_id` (null for the starter library), `title`, `servings`, `prep_minutes`, `cook_minutes`, `tags[]`, `source_type` (`manual`, `url`, `photo`, `screenshot`, `text`, `voice` or `library`), `source_url`, `content_locale`, `created_by` | Titles and steps are user content and are never translated. Tags are fixed IDs such as `tag.no_cook`. |
| `recipe_ingredients` | `id`, `recipe_id`, `position`, `ingredient_id`, `quantity`, `unit_id`, `quantity_base`, `raw_text`, `note`, `optional`                                                                                                                                 | `raw_text` keeps the original line ("2 cups whole milk, warm") for review and future re-parsing.      |
| `recipe_steps`       | `recipe_id`, `position`, `text`                                                                                                                                                                                                                        |                                                                                                       |

#### Planner

| Table                                     | Key columns                                                                                                                                               | Notes                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `plan_entries`                            | `id`, `household_id`, `date`, `slot` (`breakfast`, `lunch`, `dinner`, `snack` or `drink`), `recipe_id` or `free_text`, `servings`, `leftover_of_entry_id` | A week is a date range, so it needs no separate week table. |
| `plan_entry_portions`                     | `entry_id`, `person_id`, `portions`, `variant` (`standard` or `baby_plate`)                                                                               |                                                             |
| `plan_templates`, `plan_template_entries` | `weekday`, `slot`, `recipe_id`, `servings`                                                                                                                | Premium feature.                                            |

#### Grocery and pantry

| Table                  | Key columns                                                                                                                                                                                                                        | Notes                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `grocery_lists`        | `id`, `household_id`, `name`, `is_default`, `week_start`                                                                                                                                                                           | Free households have one default list. Premium can have more.     |
| `grocery_items`        | `id`, `list_id`, `household_id`, `ingredient_id` or `custom_name`, `dimension`, `quantity_base`, `display_unit_id`, `section_id`, `origin` (`plan` or `manual`), `user_modified`, `checked`, `checked_at`, `checked_by`, `version` |                                                                   |
| `grocery_item_sources` | `item_id`, `plan_entry_id`, `recipe_ingredient_id`                                                                                                                                                                                 | Explains "why is this on my list".                                |
| `pantry_items`         | `household_id`, `ingredient_id`, `status` (`staple`, `have` or `hidden_staple`), `quantity_base`, `expires_on`                                                                                                                     | Expiry is Premium and Phase 2.                                    |
| `purchase_events`      | `household_id`, `ingredient_id` or `item_key`, `quantity_base`, `occurred_at`, `source` (`checked_off`, `confirmed` or `receipt`)                                                                                                  | Collected from the MVP so purchase memory in Phase 2 has history. |

#### AI, notifications and devices

| Table                | Key columns                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ai_import_jobs`     | `id`, `household_id`, `user_id`, `input_type`, `locale`, `region`, `status`, `draft` (JSON), `model`, `cost_units`, `error_code` |
| `ai_usage`           | `household_id`, `period` (month), `imports_used`                                                                                 |
| `push_tokens`        | `user_id`, `token`, `platform`, `last_seen_at`                                                                                   |
| `notification_prefs` | `user_id`, `type`, `enabled`, `quiet_start`, `quiet_end`                                                                         |
| `notifications`      | `user_id`, `household_id`, `type`, `payload`, `read_at` (the in-app inbox)                                                       |

### How the grocery list is built

The list is built from plan entries in the chosen date range. For each recipe ingredient:

1. Scale the quantity by servings and portions.
2. Group by ingredient and dimension (mass, volume or count).
3. Sum the base quantities.
4. Pick a friendly display unit for the household's unit system.
5. Remove the item if the pantry marks it `have` or as a staple.

The rules for keeping user edits:

- **Regenerating** replaces items that came from the plan, but never items the user edited or checked.
- **Manual items** are never touched.
- **Different dimensions stay separate.** Volume and mass lines for the same ingredient become separate entries unless the ingredient has a density. Wrong merges are worse than duplicates.

The engine is a set of pure TypeScript functions with no side effects, unit-tested and run on the device, so it works offline.

### 3.3 Data minimization for children

- **Store age bands, not birth dates.** Children are stored as `household_people` with an age band such as `expecting`, `infant_0_6m`, `infant_6_12m`, `toddler`, `preschool` or `older_child`.
- **No photos, health records or full names are required.** A nickname is enough.
- **Due date versus age.** Whether onboarding asks for a due date or the baby's age is a vision open question and a **Decision**. If we store a due date, store the month only.
- **Allergies and pregnancy status are health-related data.** UK GDPR and some US state laws, such as Washington's My Health My Data Act, treat this kind of data strictly, so legal review must cover it before launch.

## 4. Row-level security and household isolation

- **RLS on every table,** with no exceptions. The anonymous role gets no access except to `app_config` and catalog reads.
- **Membership checks.** A `SECURITY DEFINER` helper function, `private.household_role(household_id)`, returns the caller's role or null (also null for family members and caregivers while the household is on Free, so a lapse pauses their access), and runs with a fixed search path. Policies use it as `using (private.household_role(household_id) is not null)` for reads, and test the role for writes. Membership rows are cached per statement through `(select auth.uid())`, the pattern Supabase recommends for performance.
- **Child tables carry `household_id` too.** For example `recipe_ingredients` and `grocery_items` have their own copy, so policies avoid joins, and a trigger checks it matches the parent row.
- **Privileged actions go through RPCs.** Creating a household (`create_household`, which makes the caller its first parent), accepting an invitation, removing a member, transferring ownership and deleting an account run as Postgres RPCs or Edge Functions that check the role explicitly. Clients can never insert into `household_members` or `household_entitlements` directly.
- **Premium limits are enforced on the server too.** A trigger, or the invite RPC, rejects a third adult or a caregiver seat without an active entitlement. The app's gating is only for the user experience.
- **Storage.** Private buckets use paths of the form `<household_id>/...`, with storage policies that check membership of the first path segment. Uploads for recipe import go to a separate bucket and are deleted after 24 hours.
- **Tests.** pgTAP tests in `supabase/tests` create two households and assert that every table is invisible and unwritable across them, for each role. They run in CI against a local Supabase stack (F-04).

## 5. Real-time sharing, offline sync and conflicts

**Goal:** the grocery list, the weekly plan (and later the calendar) work fully offline, and changes appear on a partner's phone within a couple of seconds when both are online.

**Approach:** keep a local SQLite copy of the household's working data, run all reads and writes against it, queue writes in an outbox, and sync both ways.

Options, with my recommendation first:

| Option                                                                    | Pros                                                                                                                                                       | Cons                                                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Legend-State with its Supabase sync plugin** (recommended to try first) | Listed in Expo's local-first guide. No new vendor. Offline persistence, incremental sync on `updated_at`, Realtime subscriptions and retries are built in. | Conflict handling is row-level last-write-wins, which we have to design around. Smaller community than PowerSync. |
| PowerSync (fallback)                                                      | A mature Postgres-to-SQLite sync engine with an official Supabase integration and a well-defined upload queue.                                             | A new vendor and cost. Sync rules are an extra thing to maintain.                                                 |
| Build our own (TanStack Query with an `expo-sqlite` outbox and Realtime)  | Full control.                                                                                                                                              | Most work, and the riskiest.                                                                                      |

Backlog item H-06 starts with a **time-boxed spike** with pass or fail tests: two devices edit the same list offline and reconnect, and the result must follow the rules below. If Legend-State fails, we switch to PowerSync. That would add a vendor, so it becomes a **Decision**.

### Conflict rules

Most edits are small and touch different rows, so simple rules are enough:

- **Row-level last-write-wins.** The server sets `updated_at`, and `version` increments on every write. Client clocks are never trusted.
- **Granular rows.** List items, plan entries and recipe lines are each their own row, so two partners editing different items never conflict.
- **Check-offs are recorded with who and when.** Two partners ticking the same item end up with it ticked, and an "unchecked" from a stale device can't silently override a newer "checked".
- **Deletes are soft (tombstones),** so a deleted item isn't brought back by an offline device.
- **Regeneration respects user edits** (section 3.2). It runs on one device and writes ordinary rows, so it syncs like any other change.
- **Recipe edits** are last-write-wins for the whole recipe. Recipes are rarely edited by two people at once, and the app shows "updated by <partner>" afterwards.

### Realtime

- **What we subscribe to:** Supabase Realtime database-change events on the household's tables, filtered by `household_id`. Realtime enforces RLS on what each client receives.
- **Presence:** "Sam is shopping" is optional polish for later.

## 6. AI recipe import

### Pipeline

1. **Client:** the parent picks the input: a link, pasted text, a screenshot or a camera photo. Images are compressed on the device and uploaded to the temporary import bucket.
2. **Edge Function `import-recipe`:** checks the session and household, then reserves quota with an atomic `ai_usage` increment. A failed import releases the reservation.
3. **Extraction:**
   - **Links:** the server fetches the page with SSRF guards: http and https only, no private IP addresses, a size cap and a timeout. If the page has schema.org `Recipe` data embedded, it's parsed directly with no LLM call, which is cheaper and exact. Otherwise the readable text is extracted.
   - **Text:** used as given.
   - **Images:** passed to the LLM's image input.
4. **LLM parsing** with a strict JSON output schema:
   - **Output:** title, servings, times, steps, and ingredient lines with quantity, unit and ingredient name, plus suggested tags and possible allergens.
   - **Inputs:** the household's `locale` and `region` go into every prompt. The unit ID list is given to the model, so it must pick from known units.
5. **Normalization on the server:**
   - **Units:** mapped to unit IDs.
   - **Ingredients:** matched against the catalog by name and synonyms for the locale, then fuzzy matching, then the LLM's suggestion. Anything unmatched becomes a household ingredient marked "unmatched".
   - **Confidence:** each line gets a confidence score.
6. **Review (always):** the client shows the draft. Nothing is saved before the user confirms.
   - Low-confidence lines and unmatched ingredients are highlighted.
   - Detected allergens that match a household member's profile get a warning with the "not medical advice" disclaimer.
   - The parent can fix any line, then saves.
7. **Cleanup:** the uploaded image is deleted. The job row keeps the draft and metadata for support and quality evaluation for 30 days, then is purged.

### Voice

Voice import is out of the MVP. The vision lists it, but it adds speech-recognition plumbing. Pasted text covers the same need for now.

### Usage limits

- **Monthly allowance per household:** a small number on Free and a large one on Premium. The exact numbers are a **Decision**, which the vision lists as an open question.
- **Rate limits:** a per-user limit (for example 10 per hour) and a hard ceiling on cost per job.
- **What counts:** only successful parses count against the allowance. Embedded schema.org imports that need no LLM call could be free.

### Privacy

- **What the model sees:** only the recipe content. Never household names, people or allergy profiles; allergen matching happens after parsing, in our own code.
- **Provider terms:** the provider must not train on our data and must keep it for a short retention period. **Decision:** which provider.

### Quality

A small evaluation set of real recipes in US, UK and Australian formats runs before each model or prompt change. It measures whether ingredients, units and allergens are parsed correctly.

## 7. Getting the grocery list out of the app

All export formats come from one function that turns a list into localized sections and items, so print, Reminders and text always match.

| Target                 | How                                                                                                                                                                                                       | Notes                                                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Print or PDF           | `expo-print` renders a localized HTML template with grouped sections and checkboxes, using `printAsync` (AirPrint on iOS, the print service on Android) or `printToFileAsync` followed by the share sheet | Works offline.                                                                                                                                                                                                                               |
| Apple Reminders (iOS)  | `expo-calendar`: request the reminders permission when first used, create or reuse a Reminders list such as "Groceries", then `createReminderAsync` for each item                                         | The public API doesn't seem to expose Reminders' sections, so we add the section name to the item's notes or use one list per section. This needs checking in the spike (G-06). A re-export updates the same list instead of duplicating it. |
| Android and other apps | The React Native share sheet with plain checklist text (`☐ 2 l milk`), plus Copy                                                                                                                          | Google Keep and Google Tasks accept shared text as a note, but not as checkable items. Writing directly to Google Tasks needs Google sign-in and an extra API permission, so it's post-MVP.                                                  |
| Share with anyone      | The same text through the share sheet, for messages or email                                                                                                                                              |                                                                                                                                                                                                                                              |

## 8. Free and Premium entitlements (household level)

- **The household is what's entitled,** not the person. `household_entitlements` is the single source of truth, which the app reads through sync, so every member sees Premium the moment it's bought.
- **RevenueCat setup:**
  - **App user ID:** the RevenueCat app user ID is the purchaser's Supabase user ID.
  - **Household attribute:** at purchase, the app sets a RevenueCat attribute `household_id`.
  - **Webhook:** the Edge Function `revenuecat-webhook` checks the shared authorization header, reads the event, and upserts `household_entitlements` for that household. It's idempotent on event ID.
  - **Reconciliation:** a nightly job compares households with RevenueCat's REST API.
- **What the app uses:** the RevenueCat SDK on the device is used only to show offerings, purchase and restore. Feature gates read our database, not the SDK.
- **Lapse or refund:** `tier` returns to `free` and Premium features pause. Caregivers lose access through RLS on their role and the tier, but their membership rows and all data stay. Nothing is deleted, and export keeps working.
- **The purchaser leaves the household:** the subscription stays with the purchaser's Apple or Google account, and the household keeps Premium until the period ends. The app then prompts a remaining parent to subscribe. Moving a subscription between households is out of scope for the MVP.
- **Trials and restore:** free trials are store-level introductory offers configured in RevenueCat, and restore purchases calls RevenueCat. Products, prices and offerings are set up by the product owner, as a human gate in `CLAUDE.md`.
- **Gates enforced on the server:** caregiver and family seats, the AI import allowance, saved templates, and history beyond the free window. Multiple lists are Premium too, but come after the MVP. Allergy warnings, export, deletion and privacy controls are never gated.

## 9. Other cross-cutting pieces

### Authentication

Supabase Auth, with:

- **Email:** a one-time code by default, with a magic link as an alternative. Codes are more reliable than links on mobile, because email apps open links in the wrong browser. Supabase sends these emails through Resend over SMTP, from the product domain.
- **Apple and Google:** Sign in with Apple and Google sign-in on the device, then `signInWithIdToken`. Apple requires Sign in with Apple when other social sign-ins are offered.
- **Biometric unlock:** `expo-local-authentication` locks the app over an existing session. It isn't a sign-in method.
- **Session storage:** encrypted, with an AES key in `expo-secure-store` and the encrypted session in SQLite storage. This replaces today's unencrypted storage (F-08).
- **Account deletion:** in the app, which Apple requires. It removes the user, and either hands their households to a remaining parent or deletes households where they're the only member, after a confirmation.

### Notifications

- **Push:** `expo-notifications` and the Expo push service. Tokens are stored in `push_tokens`.
- **Sending:** Edge Functions send messages, triggered by database events ("list is ready") or by `pg_cron` schedules through `pg_net` (the weekly "plan your week", in the household's timezone).
- **Quiet hours and controls:** quiet hours and per-type settings are enforced on the server before sending.
- **Copy:** notification text is localized on the server, chosen by the recipient's locale.
- **In-app inbox:** the `notifications` table.
- **Email:** sent through Resend, for invitations and, later, digests.
- **"Defrost the chicken tonight":** this is Phase 1 polish. It can be a local notification scheduled when the plan changes.

### Environments

| Environment | Supabase                                       | EAS build profile and environment | Update channel | App ID                        |
| ----------- | ---------------------------------------------- | --------------------------------- | -------------- | ----------------------------- |
| Development | Local stack (Docker)                           | `development`                     | none           | `com.myparentmanager.dev`     |
| Staging     | Hosted `parent-manager` (the existing project) | `preview`                         | `preview`      | `com.myparentmanager.preview` |
| Production  | A new hosted project                           | `production`                      | `production`   | `com.myparentmanager`         |

- **Separate app IDs** let all three install side by side. They come from an `app.config.ts` that reads the environment.
- **Supabase plan:** the Free plan allows two active projects per organization, and the Yakka project already uses one. Free projects also pause after a week of inactivity, which is unacceptable for production. **Decision:** Supabase Pro for production, in a new or upgraded organization.
- **Today's gap:** all three EAS environments currently point at the one hosted project. F-03 fixes that.

### CI/CD

- **On every PR:** lint, formatting, types, unit tests and an Expo dependency check, plus pgTAP database tests against a local Supabase stack ("Database tests", F-04.1) and Deno tests for Edge Functions ("Edge Function tests", F-04.2).
- **On `main`:** Android E2E with Maestro (exists today). F-04 adds iOS E2E on a macOS runner, which is free for a public repo.
- **Database migrations:**
  - **Staging:** applied automatically by a GitHub Action after a merge to `main`. It needs a Supabase access token as a GitHub secret, which the product owner adds.
  - **Production:** applied by a manual GitHub Actions workflow behind a protected "production" environment that needs the product owner's approval.
- **Builds and updates:**
  - **Preview builds:** EAS builds them on demand.
  - **Over-the-air updates:** with `expo-updates`, the runtime version is a fingerprint of the native code. JavaScript-only fixes go out as OTA updates to `preview`, and to `production` only with approval.
  - **Store builds and submissions:** these need approval (a human gate).

### Testing strategy

| Layer          | Tool                                      | Covers                                                                                                         |
| -------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unit           | Jest                                      | Unit conversion, list merging, quota logic, formatters, entitlement gates                                      |
| Component      | Jest with React Native Testing Library    | Key screens, states, accessibility labels and that copy comes from translations                                |
| Database       | pgTAP (`supabase test db`)                | RLS isolation for every table and role, invitation and membership RPCs, Premium seat limits                    |
| Edge Functions | Deno tests                                | Import pipeline (with a mocked LLM), webhook idempotency, notification scheduling                              |
| End-to-end     | Maestro (iOS and Android)                 | Sign in, create a household, invite a partner, add a recipe, plan a week, build, check off and export the list |
| AI quality     | Evaluation set                            | Parsing accuracy per locale, before prompt or model changes                                                    |
| Manual         | TestFlight and Google Play closed testing | Beta with real partners on both platforms                                                                      |

### Observability

- **Sentry** (`@sentry/react-native` with its Expo plugin):
  - **What it captures:** crashes, performance traces and source maps uploaded from EAS builds.
  - **Privacy settings:** `sendDefaultPii: false`, a `beforeSend` that strips user content, and the user ID only.
- **PostHog:**
  - **Events:** carry only IDs, counts and fixed values, never names or content.
  - **Session replay:** off.
  - **Region:** US data region at launch. EU hosting can be reviewed for the UK.
  - **Uses:** activation and retention funnels from the vision's metrics, plus feature flags.
- **Forced updates and kill switches:** these live in `app_config` in Supabase rather than PostHog, so they work even if analytics is blocked.
- **Supabase:** its logs cover the database and Edge Functions, with alerts on webhook failures and AI cost.

### Localization

- **Libraries:** `i18next` with `react-i18next`, which Expo's guide lists, and `expo-localization` for device settings. `Intl` (supported by Hermes) handles plurals, numbers, dates and currency.
- **Locales:** `en-US` is the base, and `en-GB` and `en-AU` override only the words that differ, such as "diapers" and "nappies".
- **Units and sections** follow the household's region. Language follows the device, falling back to the household's locale.
- **Lint rule:** ESLint rejects text written directly in JSX (`react/jsx-no-literals` with an allowlist).
- **Pseudo-locale:** a pseudo-locale in development builds lengthens text and adds accents, to catch layout and hard-coded strings.
- **Server copy:** notifications, emails, store listings, legal documents and the starter library are versioned per locale.

### Design system

- **Tokens:** `src/constants/theme.ts` holds every token in [design-system.md](design-system.md) under the same name, with `light` and `dark` color and elevation sets. Components read them through `useTheme()` (`src/hooks/use-theme.tsx`), which follows the system appearance.
- **Overrides:** `ThemeOverride` forces a scheme or an extra text scale for a subtree. Only the component gallery uses it, to preview dark mode and the largest text size side by side.
- **Text:** all text goes through `Text` in `src/components/text.tsx`, which applies a `type.*` and a `color.*` token and always scales with the system text size.
- **Fonts:** Fraunces 600 comes from `@expo-google-fonts/fraunces` and is embedded at build time by the `expo-font` config plugin, so there's no runtime font loading or splash-screen wait. Everything else uses the system font.
- **Icons:** `expo-symbols` (SF Symbols on iOS, Material Symbols on Android) behind the `Icon` component in `src/components/icon.tsx`, which names each icon once per platform and mirrors directional icons in right-to-left layouts.
- **Interrupted forms:** `useDraftState` (`src/hooks/use-draft-state.ts`) keeps an in-progress form in the `expo-sqlite` key-value store, under a `draft:` prefix, so it survives the app being killed (NFR-A11Y-8). Drafts stay on the device and are never synced. Sign-out and account deletion must call `clearAllDrafts()`.
- **Motion:** `useReduceMotion()` follows the system setting. Sheets, toasts and skeletons fade or stay still when it's on (NFR-A11Y-7).
- **Contrast:** a unit test checks every allowed color pair against WCAG 2.2 AA in both modes (NFR-A11Y-1).

## 10. Trade-offs, risks and decisions

| Topic                      | Trade-off or risk                                                                                                        | Proposal                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Offline sync               | A library could fail our conflict needs late in the project.                                                             | A spike first, with pass or fail tests. PowerSync as the fallback (a **Decision** if needed).                                       |
| Row-level last-write-wins  | A partner's edit to the same field can be lost.                                                                          | Small, granular rows, check-offs recorded with who and when, and "updated by" hints. Revisit with CRDTs only if real users hit it.  |
| Unit merging               | Mass and volume can't merge without a density.                                                                           | Keep them as separate lines rather than guessing. Add densities for common ingredients over time.                                   |
| AI cost and abuse          | Image parsing is the most expensive call.                                                                                | Quotas, rate limits, a cost ceiling per job, and schema.org parsing first.                                                          |
| AI accuracy and allergens  | A missed allergen is a safety issue.                                                                                     | Mandatory review, allergen highlighting, a disclaimer, and an evaluation set.                                                       |
| Apple Reminders            | The API's handling of sections is unclear.                                                                               | A spike in G-06, with a plain-list fallback.                                                                                        |
| Android export             | No native checklist target.                                                                                              | The share sheet and Copy for the MVP. Consider the Google Tasks API later.                                                          |
| Children's and health data | Legal exposure, such as UK GDPR and US state health-data laws.                                                           | Collect the minimum (age bands), no ads, and legal review before beta.                                                              |
| Household entitlement      | Store subscriptions belong to a person, but ours cover a household.                                                      | Webhook-driven `household_entitlements`, with clear rules for when the purchaser leaves.                                            |
| Supabase plan              | Free limits and pausing.                                                                                                 | Pro for production (a **Decision**).                                                                                                |
| Google Play launch         | New personal developer accounts must run a closed test before production access (at last check, 12 testers for 14 days). | Start closed testing early, or register as an organization (a **Decision**).                                                        |
| Scope                      | The MVP already spans many areas.                                                                                        | Voice import, widgets, the share extension, barcode scanning, purchase recommendations and "fill my week" wait until after the MVP. |
