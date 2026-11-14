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
| `invite_attempts`        | `user_id`, `attempted_at`                                                                                                                                 | Wrong invite codes and tokens, for the limit of 10 an hour per user (NFR-SEC-8). No client access.                      |
| `household_people`       | `id`, `household_id`, `display_name`, `kind` (`adult` or `child`), `age_band`, `due_month` (expecting only), `linked_user_id` (optional)                  | The people being fed, including children without accounts. Age bands, not birth dates (see section 3.3).                |
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

How the catalog is built (R-01.1):

- **Reference rows are read-only.** Anyone, including the anonymous role, can read `units`, `store_sections` and catalog rows of `ingredients` and `ingredient_names` (where `household_id` is null). Only migrations write them.
- **Units.** `to_base` matches `src/i18n/units.ts`. `regions` says which size a plain word such as "tbsp" means in each region (`unit.tbsp_au` in AU). `unit.pinch` and `unit.dash` have no `to_base` (R-ING-5). `unit.floz_imperial` (28.41 ml) is there for UK and AU recipes.
- **Household ingredients** have IDs of the form `ingredient.h.<uuid as 32 hex digits>`, made on the device so they work offline, and can't be default staples. Parents and family members write them; caregivers read them. Removing one is a soft delete.
- **`ingredient_names` carries `household_id` too,** kept equal to its ingredient's by a trigger, so its policies need no join.
- **Seed data (R-01.2).** `supabase/catalog/ingredients.json` is the source of truth for catalog ingredients: section, default dimension, density, allergen codes, staple flag, and per-locale name, plural and synonyms. Each locale lists the other regions' names as synonyms where that word means nothing else locally, so a UK recipe's "courgette" resolves in a US household. `node scripts/catalog-seed.js --new` turns it into a new seed migration that upserts every row and soft-deletes dropped ones. `pnpm run catalog:check` (in CI) validates the JSON, including that no word names two ingredients in a locale, and fails if the newest seed migration is out of date.
- **Matching on the device (R-01.3).** `src/features/ingredients/matching` is pure TypeScript. `buildNameIndex` folds a locale's names, plurals and synonyms (catalog and household) into an index of IDs. `searchIngredients` serves pickers and typed list items. `parseIngredientLine` reads "1½ cups whole milk, warm" into a quantity, a unit for the household's region and an ingredient ID, with a match quality for review. Unit words, number words and plural endings are in the locale files under `ingredientParser`. Display text is only ever matched through the index; everything after it compares IDs.
- **Allergen codes** are a fixed list checked by the database and mirrored in `src/features/ingredients/catalog-ids.ts`, with section IDs.

#### Recipes

| Table                | Key columns                                                                                                                                                                                                                                                         | Notes                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `recipes`            | `id`, `household_id`, `title`, `servings`, `prep_minutes`, `cook_minutes`, `tags[]`, `notes`, `source_type` (`manual`, `url`, `photo`, `screenshot`, `text`, `voice` or `library`), `source_url`, `library_recipe_id`, `content_locale`, `created_by`, `updated_by` | Titles and steps are user content and are never translated. Tags are fixed IDs such as `tag.no_cook`. |
| `recipe_ingredients` | `id`, `household_id`, `recipe_id`, `position`, `ingredient_id`, `quantity`, `unit_id`, `quantity_base`, `raw_text`, `note`, `optional`                                                                                                                              | `raw_text` keeps the original line ("2 cups whole milk, warm") for review and future re-parsing.      |
| `recipe_steps`       | `id`, `household_id`, `recipe_id`, `position`, `text`                                                                                                                                                                                                               |                                                                                                       |

How recipes are stored (R-02.1):

- **Synced.** All three tables use `private.enable_sync()` (section 5), and the app registers them in `src/features/recipes/tables.ts`. Each line and step is its own row. Deleting a recipe tombstones its lines and steps on the server, so they sync too.
- **Server-set values.** The server records `created_by` and `updated_by`, and works out `quantity_base` (R-ING-3): quantity times the unit's `to_base`; a count ingredient with no unit counts each; anything else (no quantity, "a pinch", "salt to taste") is null. `src/features/recipes/quantity.ts` does the same on the device, so offline lines show the same.
- **Checks.** Lines and steps must belong to a recipe of their own household, and a line's ingredient must be the catalog's or the household's own. A line or step added offline to a recipe deleted meanwhile arrives deleted. A recipe has at most 100 lines and 50 steps (FR-REC-4).
- **Writes.** Parents and family members write recipes; caregivers read them.
- **The starter library isn't in these tables.** It ships with the app as versioned seed data per locale (R-04.1), so it works offline and is read-only by construction. "Save a copy" writes an ordinary household recipe with `source_type` `library` and the starter's ID in `library_recipe_id` (FR-REC-3).

#### Planner

| Table                                     | Key columns                                                                                                                                               | Notes                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `plan_entries`                            | `id`, `household_id`, `date`, `slot` (`breakfast`, `lunch`, `dinner`, `snack` or `drink`), `recipe_id` or `free_text`, `servings`, `leftover_of_entry_id` | A week is a date range, so it needs no separate week table. |
| `plan_entry_portions`                     | `entry_id`, `person_id`, `portions`, `variant` (`standard` or `baby_plate`)                                                                               |                                                             |
| `plan_templates`, `plan_template_entries` | `weekday`, `slot`, `recipe_id`, `servings`                                                                                                                | Premium feature.                                            |

#### Grocery and pantry

| Table                  | Key columns                                                                                                                                                                                                                        | Notes                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grocery_lists`        | `id`, `household_id`, `name`, `is_default`, `week_start`                                                                                                                                                                           | Free households have one default list. Premium can have more.                                                                                                                                        |
| `grocery_items`        | `id`, `list_id`, `household_id`, `ingredient_id` or `custom_name`, `dimension`, `quantity_base`, `display_unit_id`, `section_id`, `origin` (`plan` or `manual`), `user_modified`, `checked`, `checked_at`, `checked_by`, `version` |                                                                                                                                                                                                      |
| `grocery_item_sources` | `item_id`, `plan_entry_id`, `recipe_ingredient_id`                                                                                                                                                                                 | Explains "why is this on my list".                                                                                                                                                                   |
| `pantry_items`         | `household_id`, `ingredient_id`, `status` (`staple`, `have` or `hidden_staple`), `have_week_start` (for `have` only)                                                                                                               | No quantities or expiry in Phase 1 (FR-PAN-7). `quantity_base` and `expires_on` come in Phase 2, with expiry as Premium. New households get the catalog's default staples from a trigger (FR-PAN-1). |
| `purchase_events`      | `household_id`, `ingredient_id` or `item_key`, `quantity_base`, `occurred_at`, `source` (`checked_off`, `confirmed` or `receipt`)                                                                                                  | Collected from the MVP so purchase memory in Phase 2 has history.                                                                                                                                    |

#### AI, notifications and devices

| Table                | Key columns                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_import_jobs`     | `id`, `household_id`, `user_id`, `input_type`, `locale`, `region`, `status`, `source`, `reserved_period`, `draft` (JSON), `model`, `cost_units`, `error_code` |
| `ai_usage`           | `household_id`, `period` (month), `imports_used`                                                                                                              |
| `push_tokens`        | `user_id`, `token`, `platform`, `last_seen_at`                                                                                                                |
| `notification_prefs` | `user_id`, `type`, `enabled`, `quiet_start`, `quiet_end`                                                                                                      |
| `notifications`      | `user_id`, `household_id`, `type`, `payload`, `read_at` (the in-app inbox)                                                                                    |

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
- **Due month only (D-6).** Onboarding asks "Expecting, or how old is your youngest?". An expecting person has `due_month` as `YYYY-MM` text, which can't hold a day, and the database refuses it for any other age band. Nobody not yet born gets allergies or diets.
- **Fixed codes.** `person_dietary` accepts only the allergen codes in `catalog-ids.ts` and the diet codes in `src/features/people/codes.ts`. Removing a person soft-deletes their codes with them.
- **Onboarding is one transaction.** `complete_onboarding()` creates the household, its people and their codes together, so an interrupted onboarding never leaves a household without its answers. Until then the answers stay in the on-device draft (FR-ONB-7).
- **Allergies and pregnancy status are health-related data.** UK GDPR and some US state laws, such as Washington's My Health My Data Act, treat this kind of data strictly, so legal review must cover it before launch.

### 3.4 Data export and account deletion coverage

Export (A-04.2) and deletion must cover every table that holds household data. Add a row here with each new table.

| Table                    | Export                               | Deletion                                                                                  |
| ------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `profiles`               | The user's own row                   | With the account                                                                          |
| `households`             | The household                        | When its only member deletes their account                                                |
| `household_members`      | All members' roles and join dates    | Cascades from the household                                                               |
| `invitations`            | Open invitations, without token hash | Cascades from the household                                                               |
| `invite_attempts`        | Not exported (security record)       | Cascades from the account                                                                 |
| `household_people`       | All people, with the due month       | Cascades from the household                                                               |
| `person_dietary`         | All diets and allergies              | Cascades from the household                                                               |
| `household_entitlements` | Tier and status                      | Cascades from the household                                                               |
| `ingredients`            | Rows with the household's ID only    | Household rows cascade; catalog rows are never touched                                    |
| `ingredient_names`       | Rows with the household's ID only    | Household rows cascade; catalog rows are never touched                                    |
| `recipes`                | All rows, with lines and steps       | Cascades from the household; `created_by` and `updated_by` are set null with the account  |
| `recipe_ingredients`     | With their recipe                    | Cascades from the household                                                               |
| `recipe_steps`           | With their recipe                    | Cascades from the household                                                               |
| `pantry_items`           | All rows                             | Cascades from the household                                                               |
| `ai_import_jobs`         | The user's own jobs, with drafts     | Cascades from the household; `user_id` is set null with the account; purged after 30 days |
| `ai_usage`               | Monthly counts                       | Cascades from the household                                                               |

## 4. Row-level security and household isolation

- **RLS on every table,** with no exceptions. The anonymous role gets no access except to `app_config` and catalog reads.
- **Membership checks.** A `SECURITY DEFINER` helper function, `private.household_role(household_id)`, returns the caller's role or null (also null for family members and caregivers while the household is on Free, so a lapse pauses their access), and runs with a fixed search path. Policies use it as `using (private.household_role(household_id) is not null)` for reads, and test the role for writes. Membership rows are cached per statement through `(select auth.uid())`, the pattern Supabase recommends for performance.
- **Child tables carry `household_id` too.** For example `recipe_ingredients` and `grocery_items` have their own copy, so policies avoid joins, and a trigger checks it matches the parent row.
- **Privileged actions go through RPCs.** Creating a household (`create_household`, which makes the caller its first parent), accepting an invitation, removing a member, transferring ownership and deleting an account run as Postgres RPCs or Edge Functions that check the role explicitly. Clients can never insert into `household_members` or `household_entitlements` directly.
- **Premium limits are enforced on the server too.** A trigger, or the invite RPC, rejects a third adult or a caregiver seat without an active entitlement. The app's gating is only for the user experience.
- **Invitations.** `create_invitation` returns a 6-character code and a link token once; only their SHA-256 hashes are stored (`code_hash`, `token_hash`), and clients can't select either column. `preview_invitation` and `accept_invitation` take a code or a token and return a `status` (`ok`, `invalid`, `rate_limited`, `revoked`, `used`, `expired`, `premium_required`, `already_member`, `in_other_household` or `seat_limit`) instead of raising, so a wrong attempt is recorded in `invite_attempts` rather than rolled back. Accepting locks the household row and re-checks the seats, so two acceptances can't both take the last seat. The Premium seat cap is `app_config` key `household.premium_seats` (6 if unset). `revoke_invitation` is for parents.
- **Members.** `change_member_role` and `remove_member` are for parents. Role changes keep the seat rules (2 parents; family and caregiver seats need Premium and fit the cap) and never leave the household without a parent (FR-HH-14). Removing sets the member's `status` to `removed`, so `household_role()` refuses them at once; leaving yourself is `leave_household`, which sets `left`. The last parent can't leave while anyone else is a member, even a paused one (FR-HH-14); the only member's leaving deletes the household and everything that cascades from it (FR-HH-8). `membership_status()` tells a signed-in user whether they're a `member`, `paused` (a family member or caregiver while the household is on Free), `removed` or have `none`, which RLS alone can't, so the app can show S-35.
- **Storage.** Private buckets use paths of the form `<household_id>/...`, with storage policies that check membership of the first path segment. Uploads for recipe import go to a separate bucket and are deleted after 24 hours.
- **Tests.** pgTAP tests in `supabase/tests` create two households and assert that every table is invisible and unwritable across them, for each role. They run in CI against a local Supabase stack (F-04).

## 5. Real-time sharing, offline sync and conflicts

**Goal:** the grocery list, the weekly plan (and later the calendar) work fully offline, and changes appear on a partner's phone within a couple of seconds when both are online.

**Approach:** keep a local SQLite copy of the household's working data, run all reads and writes against it, queue writes in an outbox, and sync both ways.

**Decided (D-13, 2026-11-08): we build our own.** There's no sync vendor. The pieces:

- **Local copy:** `expo-sqlite` in `src/lib/sync` holds the household's working data and is read on start (H-06.2).

#### How the sync layer is built (`src/lib/sync`)

- **Generic over tables.** A feature registers its table with `defineSyncTable({ name, columns })`. The server table needs the system columns (`id`, `household_id`, `version`, `created_at`, `updated_at`, `deleted_at`). The engine has no feature tables of its own.
- **Local copy (H-06.2).** One SQLite table per registered table, with the system columns and the feature's columns, so features can query it with SQL. `sync_meta` records which household the copy belongs to (another household empties it), each table's column list (a change rebuilds that table and pulls it again) and its pull cursor. All access goes through one queue, because expo-sqlite transactions aren't exclusive.
- **Encrypted.** The file is encrypted with SQLCipher (`useSQLCipher` on the `expo-sqlite` plugin), using a random 256-bit key in SecureStore. A build without SQLCipher keeps no local copy rather than storing it in the clear. Sign-out deletes the file and its key (FR-AUTH-7).
- **Reading.** `SyncProvider` (mounted by the tab layout) opens the copy for the member's household. `useSyncedRows(table)` reads live rows from it, so cached data shows offline and after restarts (NFR-OFF-1).
- **Pulling.** A sync runs on start, on reconnecting and when the app returns to the foreground. The first pull lists the household's live rows. Later pulls fetch rows with `updated_at` at or after the newest one seen, less a 60-second overlap so a late commit isn't missed, including tombstones, in `updated_at`, `id` pages. A row replaces the local one only if its `version` is newer, so repeats and late deliveries are harmless. After 30 days away, the device lists everything again and drops rows the server no longer has (NFR-OFF-6).
- **Local writes and the outbox (H-06.3).** `useSyncWriter()` gives `insert`, `update` and `remove`. Each write is applied to the local copy at once and queued in `sync_outbox`, in order, in the same transaction, so it survives restarts and reboots (NFR-OFF-3). Each row keeps the last row the server sent (its base); what the app reads is the base with its queued writes replayed on top. A pull, a Realtime event or a push response therefore never hides a waiting write, and once the queue drains the row is exactly the server's.
- **Pushing.** Writes go in order: runs of creates on one table in one request, and updates and deletes to different rows up to 8 at a time, so 500 queued changes sync well within 10 seconds (NFR-OFF-4). Each update carries the `version` it was based on. A failed write is handled by why it failed:
  - **Waits:** offline, a 401 while the session refreshes, 408, 429 or a 5xx. It's retried with backoff, however long that takes.
  - **Refused:** RLS (`42501`, for example after the member was removed) or a constraint (`22xxx`, `23xxx`). It leaves the queue at once and the row shows the server's copy again. A count of refused writes is shown to the user (NFR-OFF-6).
  - **Anything else:** dropped after 8 attempts.

  So nothing can stall the queue, which was the spike's S6 failure. A create retried after a lost response finds the row already there (`23505`) and completes.

- **Server rules.** `private.enable_sync(table, check_columns)` (migration `20261110100000_sync_rules.sql`) gives a feature table the conflict rules below, through two generic triggers:
  - The server sets `created_at`, `updated_at` and `version`.
  - A tombstone never changes, and a late edit gets the tombstone back.
  - Each check column (such as `checked`) records `<column>_at` and `<column>_by`. A write based on an older `version` can't clear it.

  The function also revokes hard deletes, adds the pull index and publishes the table to Realtime. A feature's migration still writes the table's own RLS policies.

- **First load on a new device (A-01.3).** A device that has never pulled the household (no table has a `pulledAt` mark) reports `firstLoad` until its first sync finishes. A table added by an app update doesn't count. Meanwhile `FirstLoadGate` shows a loading state in place of the tabs, which then open on the Plan tab; offline it asks for a connection and offers to try again. Tables are pulled in parallel, with the local store writing one at a time, so a household with 200 recipes loads within 5 seconds on 4G (FR-AUTH-8; checked in `__tests__/sync/first-load.test.ts` with a simulated 150 ms, 5 Mbit/s link).
- **Pending indicator.** `PendingChangesBanner`, above the tab bar, shows how many changes are waiting until they sync, and how many the server refused.
- **Two-device harness.** `test-utils/sync/harness` runs two devices (two users, two SQLite files and two engines) against a local stack, through offline edits, a restart and reconnection, and checks every conflict rule. It includes the spike's S4 and S6 failures as regression cases. It runs as the "Sync harness" CI job (`pnpm run test:sync`).
- **Outbox:** writes are queued in order and survive restarts. The server sets `updated_at` and `version`, and deletes are soft (H-06.3).
- **Realtime:** Supabase Realtime, filtered by household, applies remote changes to the local copy (H-06.4).

How we got here:

| Option                                                   | Result                                                                                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legend-State with its Supabase sync plugin (tried first) | **Failed** the H-06.1 spike (#27, PR #110). On the device, a row deleted elsewhere came back, and a stale uncheck stalled the write queue. Its Supabase plugin is also a beta.                                  |
| PowerSync                                                | Not tried. It would add a vendor holding a copy of children's data, from about USD 49 a month.                                                                                                                  |
| **Build our own** (an `expo-sqlite` outbox and Realtime) | **Chosen.** No new vendor or processor, full control over the conflict rules below. It costs about 2 to 3 more days, and we own any sync bugs. The spike's two-device test harness is H-06.3's acceptance test. |

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
- **How (H-06.4):**
  - The engine joins one channel per household (`sync:<household_id>`), with a `postgres_changes` listener per registered table filtered by `household_id`. `private.enable_sync()` adds each table to the `supabase_realtime` publication.
  - An event is applied like a pulled row: only if its `version` is newer, and with queued writes replayed on top. An event missing a column (a large unchanged value) is fetched whole.
  - Each (re)join pulls once, to catch up on what was missed while disconnected.
  - `SyncProvider` listens only while the app is online and in the foreground.
  - The harness measures delivery between two devices against the 2-second p95 target (FR-HH-13, NFR-PERF-3).
- **Removed members:** Realtime checks RLS for every change, through `private.household_role()`, so a removed member stops receiving changes at once, and the harness checks this. When the app next loads membership and finds the user no longer belongs to the household, it deletes the local copy (`resetSync`).
- **Presence:** "Sam is shopping" is optional polish for later.

## 6. AI recipe import

### Pipeline

1. **Client:** the parent picks the input: a link, pasted text, a screenshot or a camera photo. Images are compressed on the device and uploaded to the temporary import bucket.
2. **Edge Function `import-recipe`:** checks the session, then starts a job with `ai_import_start()`, which refuses caregivers and members over the hourly limit. Right before a parser call it reserves one import with `ai_import_reserve()`, a conditional upsert on the `ai_usage` row, so concurrent requests queue on its lock and can't pass the allowance. `ai_import_finish()` records the outcome, and a failure releases the reservation. These RPCs are callable only by the service role.
3. **Extraction:**
   - **Links:** the server fetches the page with SSRF guards (`fetch_page.ts`): http and https on default ports only, no credentials in the URL, and every resolved address public (no private, loopback, link-local, metadata or IPv6 forms of them). Redirects are followed by hand, at most 3, and each hop is checked again. Pages are HTML only, capped at 2 MB and 10 seconds. The runtime's fetch resolves the host again, so DNS rebinding between check and fetch is a known remaining risk.
   - **Embedded data:** if the page has a complete schema.org `Recipe` (a title, ingredients and steps), it's parsed directly with no LLM call, which is cheaper and exact, and the import doesn't count. Its ingredient lines keep their original text with zero confidence until normalization (R-05.3) matches them to the catalog.
   - **Otherwise** the readable text is extracted (scripts, styles and page furniture removed, capped at 20,000 characters) and goes to the parser like pasted text.
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

- **Monthly allowance per household (D-9):** 5 on Free and 100 on Premium (its fair-use cap), per calendar month in the household's timezone.
- **Rate limits:** 10 import attempts per member per rolling hour, and a hard ceiling on cost per job (R-05.3).
- **Server settings:** all of these live in `app_config` under `ai_import.limits`, read on every request, so they're tuned without a release.
- **What counts:** only successful parses count against the allowance. Embedded schema.org imports that need no LLM call are free, and never reserve.
- **Housekeeping:** a `pg_cron` job every 10 minutes fails jobs stuck processing for over 2 minutes (releasing their reservation) and purges job records older than 30 days (NFR-SEC-9).
- **The app's view:** `ai_import_allowance()` returns used, total and the reset date for the import screen (FR-AI-2, FR-AI-10).

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

- **Email:** a one-time code by default, with a magic link as an alternative. Codes are more reliable than links on mobile, because email apps open links in the wrong browser. Supabase sends these emails through Resend over SMTP, from the product domain. Until the domain (D-2) and Resend account (D-4) exist, development and staging use Supabase's built-in email, which is rate-limited. Codes have 6 digits and last 10 minutes, and a new one can be sent every 30 seconds (`supabase/config.toml`). One email template, `supabase/templates/sign-in-code.html`, serves both new accounts (confirmation) and existing ones (magic link). It's generated from the locale files by `pnpm run email:templates`, with a Go template branch on the `locale` saved in the user's metadata at sign-up for any locale whose copy differs, and `pnpm run email:check` (in CI) fails if it drifts. **Wrong codes:** Supabase Auth doesn't count wrong codes per code, so two limits apply. The app stops accepting a code after 5 wrong tries and asks for a new one, which replaces the old code on the server, and the server allows 10 code checks per IP address every 5 minutes, which keeps guessing a 6-digit code out of reach for a client that ignores the app's limit. The config file sets the local stack only: the hosted project's auth settings and templates are set in the dashboard.
- **Apple and Google:** Sign in with Apple and Google sign-in on the device, then `signInWithIdToken`. Apple requires Sign in with Apple when other social sign-ins are offered. **Apple (A-02.1):** on iOS, `expo-apple-authentication` shows Apple's own button and sheet, and the app passes Apple's ID token and the raw nonce to `signInWithIdToken` (Apple gets the nonce's SHA-256). There's no native Apple SDK for Android, so there the button opens Apple's web sign-in through Supabase OAuth in an `expo-web-browser` auth session, which returns to `auth-callback`. That needs a Services ID and key in the Supabase project, so the Android button is hidden until `EXPO_PUBLIC_APPLE_WEB_SIGN_IN=1`. **Same email, one account (FR-AUTH-3):** Supabase links an Apple or Google identity to an existing user with the same verified email, so no app code merges accounts. **Google (A-02.2):** `@react-native-google-signin/google-signin` shows Google's account picker on both platforms and returns an ID token for `signInWithIdToken`. It needs OAuth client IDs (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` on both platforms, plus `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` on iOS, whose reverse is the iOS URL scheme the config plugin adds). Without them the button is hidden and the plugin is left out. Supabase skips the nonce check for Google, because Google's iOS SDK puts a nonce in the token that the app can't see. Sign-out also signs out of Google on the device. A name from the provider fills an empty profile display name (FR-AUTH-4); otherwise onboarding asks. A cancelled sign-in returns to S-02 with no message.
- **Signed-in state in the app:** `AuthProvider` (`src/features/auth/session.tsx`) follows `onAuthStateChange`, and the root layout keeps the splash screen up until the saved session is read (S-01). The layout's `Stack.Protected` guards show `(auth)` (sign-in and code entry) only while signed out and `(tabs)` only while signed in, so a sign-in or a sign-out (including a revoked refresh token) moves the user without manual redirects. The code screen keeps the pending email in the device's drafts store, so it survives the app being killed, and counts wrong codes (5 at most). The magic link opens `auth-callback`, which reads the tokens from the URL fragment. On first sign-in the profile's locale is set from the device (FR-AUTH-4). Sign-in needs a network connection: offline, the screens show the offline banner and disable their buttons.
- **Onboarding guard:** `HouseholdProvider` (`src/features/household/membership.tsx`) reads the signed-in user's active membership and caches its IDs and settings on the device (removed at sign-out), so a member opens straight into the app offline. The root layout shows `(onboarding)` only to a signed-in user with no household, and `(tabs)` only to a member. A new device offline with no cached membership shows a retry screen. Onboarding answers and the current step are a draft (`useDraftState`), so an interrupted onboarding resumes where it stopped (FR-ONB-7). The household's region sets the app's locale.
- **Sign-out (FR-AUTH-7):** `signOut()` in `src/features/auth/sign-out.ts` runs every cleanup registered with `onSignOut()`, clears all drafts, then deletes the session on the device and asks the server to revoke the refresh token, which works offline. Modules that keep data on the device register a cleanup: the sync layer for its encrypted copy of household data, and notifications for this device's push token.
- **Biometric unlock:** `expo-local-authentication` locks the app over an existing session. It isn't a sign-in method. `BiometricLock` (`src/features/biometric`) wraps the signed-in app. The setting is per device, off by default, with a timeout of immediately, 1, 5 or 15 minutes (default 5). It's saved in the device's key-value store with the time the app last went to the background, and both are cleared at sign-out. When the lock is on, a cold start or a return after the timeout shows S-04 over the app, which hides it from screen readers too, and it also covers the app in the app switcher. The system prompt falls back to the device passcode. If the device has neither biometrics nor a passcode any more, the lock turns itself off with a notice. Until the Account screen (S-31) exists, the switch is on the Household tab.
- **Session storage:** encrypted (F-08). `createEncryptedStorage` in `src/lib/encrypted-storage.ts` gives each storage key a random AES-256 key, stored in `expo-secure-store` and readable after first unlock, and seals the value with AES-GCM from `expo-crypto`. Only the ciphertext goes to SQLite storage (`expo-sqlite/localStorage`), which avoids SecureStore's size limits. Removing the item (sign-out) deletes both the ciphertext and the key. Data without its key, or data that fails authentication, reads as signed out and is cleared. A SecureStore error is passed on rather than treated as a sign-out.
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

| Environment | Supabase                                                                                          | EAS build profile and environment | Update channel | App ID                        |
| ----------- | ------------------------------------------------------------------------------------------------- | --------------------------------- | -------------- | ----------------------------- |
| Development | Hosted `parent-manager` for builds on devices; the local stack (Docker) for sessions and CI tests | `development`                     | `development`  | `com.myparentmanager.dev`     |
| Staging     | Hosted `parent-manager` (the existing project)                                                    | `preview`                         | `preview`      | `com.myparentmanager.preview` |
| Production  | Hosted `parent-manager` until D-1; then a new project, created before the external beta           | `production`                      | `production`   | `com.myparentmanager`         |

- **Separate app IDs** let all three install side by side. `app.config.ts` reads `APP_VARIANT` (`development`, `preview` or `production`), which each build profile sets in `eas.json`; `development-simulator` inherits `development`'s. Without `APP_VARIANT` the config is production's, so EAS commands that don't run a build (submit, credentials) act on the store app, and local scripts (`pnpm run ios`, `android`, `start`) set `development`. Each variant also gets its own name suffix and URL scheme (`parentmanager-dev`, `parentmanager-preview`, `parentmanager`), so deep links open the right install. Maestro flows take the app ID as `APP_ID` and default to production's.
- **Supabase plan:** the Free plan allows two active projects per organization, and the Yakka project already uses one. Free projects also pause after a week of inactivity, which is unacceptable for production. **Decision:** Supabase Pro for production, in a new or upgraded organization.
- **One hosted project until the beta (decided 2026-11-09):** to stay on the Free plan, development and preview builds share the hosted `parent-manager` project, and migrations reach it through the Migrations workflow after each merge. Automated tests (sessions and CI) use the local stack, never the hosted project. It holds test data only: no real family data, no backups, and it pauses after 7 days without activity. Since 2026-11-12 production builds use it too: all three EAS environments set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `parent-manager`, so nothing that needs an EAS environment waits on D-1. Giving production its own project (F-03.2, #10) waits for D-1, and must happen before any real family uses a production build.

### CI/CD

- **On every PR:** lint, formatting, types, unit tests and an Expo dependency check, plus pgTAP database tests against a local Supabase stack ("Database tests", F-04.1), Deno tests for Edge Functions ("Edge Function tests", F-04.2) and the two-device sync harness ("Sync harness", H-06.3).
- **On `main`:** E2E with Maestro on Android (an emulator on Linux) and iOS (a simulator on a macOS runner, which is free for a public repo, with Xcode 26.4 or later, F-04.3). Both jobs live in `.github/workflows/e2e.yml`, build the production variant as a release, and can also be started on any branch with `workflow_dispatch`.
- **Database migrations:**
  - **Staging:** `.github/workflows/migrations.yml` applies them after any merge to `main` that changes `supabase/migrations`, usually within 5 minutes (F-04.4). It prints a dry run, then runs `pnpm supabase db push --remote=<ref> --yes`. The "staging" GitHub environment holds a `SUPABASE_ACCESS_TOKEN` secret (a token scoped to the staging project) and a `SUPABASE_PROJECT_REF` variable, both added by the product owner.
  - **Production:** the same workflow, started by hand with target "production". The "production" GitHub environment requires the product owner's approval before the job runs, and holds that project's token and ref. Until the production project exists (D-1), the job stops with a message saying what's missing.
  - **No hand-applied migrations:** apply to hosted projects only through this workflow, so its history and the repo stay in step.
- **Builds and updates:**
  - **Preview builds:** EAS builds them on demand.
  - **Over-the-air updates:** with `expo-updates`, the runtime version is a fingerprint of the native code. Each build profile in `eas.json` has its own channel (`development`, `preview`, `production`). Because the app config is part of the fingerprint, updates are published with the target builds' `APP_VARIANT` (`pnpm run update:preview`). JavaScript-only fixes go out as OTA updates to `preview`, and to `production` only with the product owner's approval.
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
  - **Wrapper (F-07.1):** `src/lib/crash-reporting.ts`. Without `EXPO_PUBLIC_SENTRY_DSN` it does nothing (D-4), so turning Sentry on needs only EAS environment variables. Events lose request data, extras, unlisted contexts and the device name; messages lose emails, double-quoted text and Postgres key details; URLs lose their query and fragment; console breadcrumbs are dropped. Screenshots, view hierarchy and replays are off, and 20% of sessions send traces.
  - **Turning it on:** set `EXPO_PUBLIC_SENTRY_DSN` (plain text) in each EAS environment. For readable stack traces, also set `SENTRY_ORG` and `SENTRY_PROJECT` (plain text) and `SENTRY_AUTH_TOKEN` (secret), then make new builds; without the org and project the plugin skips the source-map upload (`app.config.ts`). After `pnpm run update:preview`, run `pnpm exec sentry-expo-upload-sourcemaps dist` with `SENTRY_AUTH_TOKEN` set to upload the update's source maps.
- **PostHog:**
  - **Events:** carry only IDs, counts and fixed values, never names or content.
  - **Session replay:** off.
  - **Region:** US data region at launch. EU hosting can be reviewed for the UK.
  - **Uses:** activation and retention funnels from the vision's metrics, plus feature flags.
  - **Wrapper (F-07.2):** `src/lib/analytics`. `track(event, properties)` takes only events in the schema (`schema.ts`, one entry per event in spec section 3), with each property an ID (UUID), a count, a duration, a flag, a value from a fixed set, or a fixed lowercase code. It checks them again at runtime and drops, and reports by name only, anything that doesn't fit. A `before_send` filter drops SDK events we don't send (screens, lifecycle) and properties that could identify someone (`$device_name`, URLs, person properties). GeoIP, autocapture and surveys are off. `AnalyticsIdentity` identifies the user by ID and registers `household_id`, `role`, `tier`, `region` and `locale`; `platform` and `app_version` are always set.
  - **Offline:** the SDK keeps its queue in expo-sqlite's `localStorage` and keeps events after a network error, so they send once the device is back online.
  - **Opt-out (FR-PRIV-5):** `setAnalyticsOptOut` stores the choice on the device (`analytics.opted_out`), even while PostHog is off, and stops every event. It survives sign-out. The setting's screen is A-04.1.
  - **Turning it on:** without `EXPO_PUBLIC_POSTHOG_KEY`, nothing is sent (D-4). Set it, and optionally `EXPO_PUBLIC_POSTHOG_HOST` (default `https://us.i.posthog.com`), as plain-text EAS environment variables. The project key is public by design.
- **Forced updates and kill switches:** these live in `app_config` in Supabase rather than PostHog, so they work even if analytics is blocked.
  - **Keys (F-09):** `app.minimum_version` (`{"ios": "1.2.0", "android": "1.2.0"}`, or one string for both), `app.store_url` (`{"ios": …, "android": …}`; Android falls back to its Play listing) and `app.kill_switches` (`{"ai_import": true, "export.pdf": true}`; true turns that feature off). Switch names are in `KILL_SWITCHES` (`src/lib/remote-config.ts`): `ai_import` and one per export target. Change them with SQL on the hosted project, for example `insert into app_config (key, value) values ('app.kill_switches', '{"ai_import": true}') on conflict (key) do update set value = excluded.value;`.
  - **In the app:** `RemoteConfigProvider` reads the keys at launch, on reconnecting and on returning to the foreground, with a 5-second timeout. A failed read keeps what the app has, so offline it always opens (fails open). Kill switches are cached on the device, so a feature that was off stays off on the next launch; the minimum version isn't. `ForcedUpdateGate` shows S-01's update screen in place of the whole app while `expoConfig.version` is below the minimum. Features wrap entry points in `<FeatureGate feature="ai_import">` or check `useFeatureEnabled()` (AI-20: manual entry stays).
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
| Offline sync               | A library could fail our conflict needs late in the project.                                                             | Our own outbox and Realtime (D-13), held to the conflict rules by the two-device test harness in CI.                                |
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
