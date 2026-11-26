# Data inventory and store privacy answers

Backlog L-01.1 (#101) for Phase 1 and the inventory half of L-07 (#266) for Phase 2. Spec requirements: `FR-PAY-11`, `NFR-SEC-7`, `NFR-SEC-9`, `NFR2-SEC-2`.

This is a draft for the product owner and the privacy lawyer (D-11). It is not legal advice. Anything marked **PROPOSED** depends on an open decision in [decisions-needed.md](../decisions-needed.md) and must be confirmed before the store forms are submitted.

Sources: every `create table` in `supabase/migrations/` (49 tables, up to migration `20261124180000`), the export and deletion registry (architecture section 3.4), the processors in architecture sections 6 to 9, and `package.json` with `pnpm-lock.yaml`.

## 1. Summary

- **Who the data is about:** the parents and other members who sign in, and the people a household feeds, including children who have no account. Children are recorded by first name or nickname and an age band, never a birth date; an expecting household may store a due month (architecture 3.3).
- **Sensitive data:** allergies and diets (health; `diet.halal` and `diet.kosher` can also reveal religion), age bands, the due month, and, in Phase 2, documents in the vault (identity, insurance and medical papers are expected).
- **Where it lives:** Supabase (Postgres, Auth and Storage) in AWS `us-east-1`, and an encrypted copy on each member's device. Nothing is sold, and nothing is shared for advertising.
- **No advertising or tracking SDKs** (section 5). No ads in either tier (`FR-PAY-11`, PROPOSED until D-11 confirms it).
- **Deletion and export:** every table below is in the export and deletion registries (`private.export_registry`, `private.deletion_registry`), which database tests (`supabase/tests/data_export.test.sql`, `data_deletion.test.sql`) check for completeness. Deleting an account or household removes the rows from the live database at once (FR-PRIV-4). Backups follow the Supabase plan: **PROPOSED** within 30 days, once D-1 picks the production plan. The hosted test project has no backups.

## 2. Retention rules used below

| Rule               | Meaning                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Household**      | Kept while the household exists. Removed when the household is deleted (`erase_household`), or with the last member who could keep it.                                                                                             |
| **Account**        | Kept while the account exists. Removed, or its user ID set to null, when the account is deleted (`erase_user`).                                                                                                                    |
| **Tombstone**      | Synced tables never hard-delete a row: a delete sets `deleted_at` and blanks nothing else. Tombstones stay until the household is deleted. **Open question for D-11:** whether deleted content should be blanked or purged sooner. |
| **History window** | On Free, plans and lists older than the current week and the 4 before it are hidden, not deleted (G-08).                                                                                                                           |

## 3. Tables

All tables are in Supabase Postgres (`us-east-1`) with row-level security. "Device" means the table also syncs to members' devices, where the copy is encrypted (architecture 5 and F-08) and removed at sign-out.

### 3.1 Accounts, households and members

| Table                                                            | Purpose                                                   | Personal data                                                       | Device       | Retention                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- | ------------ | --------------------------------------------------------------- |
| `auth.users`, `auth.identities`, `auth.sessions` (Supabase Auth) | Sign-in by email code, Apple or Google                    | Email, Apple or Google subject ID, sign-in times, refresh tokens    | Session only | Account. Auth logs follow the Supabase plan (1 day on Free).    |
| `profiles`                                                       | Display name, language, active household                  | Display name, locale                                                | Yes          | Account                                                         |
| `households`                                                     | Name, region, units, timezone, week start                 | Household name                                                      | Yes          | Household                                                       |
| `household_members`                                              | Who belongs, with which role                              | User ID, role                                                       | Yes          | Household; own row with the account                             |
| `invitations`                                                    | Invite links and codes                                    | Hash of the token, inviter, role                                    | No           | Expires after 7 days; row kept with the household               |
| `invite_attempts`                                                | Rate limit on wrong codes (NFR-SEC-8)                     | User ID, time                                                       | No           | Account. **PROPOSED:** purge rows older than 1 day (not built). |
| `household_people`                                               | The people the household feeds                            | Name or nickname, age band, due month (expecting only), linked user | Yes          | Household                                                       |
| `person_dietary`                                                 | Allergies and diets per person                            | Allergen and diet codes (health)                                    | Yes          | Household                                                       |
| `household_deletion_requests`                                    | Two-parent household deletion (FR-PRIV-7)                 | Requesting parent                                                   | Yes          | 7 days, or with the household or account                        |
| `household_entitlements`                                         | Free or Premium, from the server                          | Purchaser user ID                                                   | Yes          | Household; purchaser cleared with the account                   |
| `subscription_events`                                            | Store events applied to the entitlement                   | Purchaser user ID, product, dates                                   | No           | Household; purchaser cleared with the account                   |
| `mock_store_subscriptions`                                       | Interim test store (D-10). Never on a production project. | Store account (user ID), dates                                      | No           | Household and account                                           |

### 3.2 Recipes, catalog and AI import

| Table                                                                                      | Purpose                                | Personal data                           | Device                      | Retention                                                                                   |
| ------------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------- |
| `units`, `store_sections`, `ingredients` (catalog rows), `ingredient_names` (catalog rows) | Shared catalog                         | None                                    | Bundled                     | App lifetime                                                                                |
| `ingredients`, `ingredient_names` (household rows), `household_ingredients`                | Ingredients a household adds           | Free text names                         | Yes                         | Household                                                                                   |
| `recipes`, `recipe_ingredients`, `recipe_steps`                                            | The household's recipes                | Recipe text, source link, author IDs    | Yes                         | Household (tombstones)                                                                      |
| `ai_import_jobs`                                                                           | Import jobs (R-05)                     | Draft recipe JSON, source link, user ID | No                          | **30 days** (pg_cron purge, NFR-SEC-9)                                                      |
| `ai_usage`                                                                                 | Monthly import count                   | None                                    | No                          | Household                                                                                   |
| Import images                                                                              | Sent to the AI provider in the request | Recipe photo or screenshot              | Compressed copy until saved | **Never stored** on the server (architecture 6); deleted on the device when the import ends |

### 3.3 Planner, grocery and pantry

| Table                                                    | Purpose                            | Personal data             | Device | Retention                                       |
| -------------------------------------------------------- | ---------------------------------- | ------------------------- | ------ | ----------------------------------------------- |
| `plan_entries`, `plan_entry_portions`                    | The meal plan, and who eats what   | Meals per person          | Yes    | Household (tombstones, history window)          |
| `week_templates`                                         | Saved weeks (Premium)              | Author ID                 | Yes    | Household                                       |
| `grocery_lists`, `grocery_items`, `grocery_item_sources` | The shopping list                  | Item text, who checked it | Yes    | Household (tombstones, history window)          |
| `purchase_events`                                        | Purchase memory, frequently bought | What was bought and when  | Yes    | Household                                       |
| `frequent_suggestion_hides`                              | Hidden suggestions                 | None                      | Yes    | Hidden for 90 days; row kept with the household |
| `pantry_items`                                           | Staples on hand                    | Item IDs                  | Yes    | Household                                       |
| `list_ready_events`                                      | "List is ready" once a day         | User ID, week             | No     | Household                                       |

### 3.4 Notifications and devices

| Table                | Purpose                             | Personal data             | Device | Retention                                    |
| -------------------- | ----------------------------------- | ------------------------- | ------ | -------------------------------------------- |
| `push_tokens`        | Push delivery                       | Expo push token, platform | No     | Until sign-out; at most 10 per user; account |
| `notification_prefs` | Per-member switches and quiet hours | Times                     | Cached | Account                                      |
| `notifications`      | In-app inbox and push queue         | Type, IDs only (FR-NOT-9) | Yes    | Last 50 per member; account                  |

### 3.5 Phase 2: calendar and busy times

| Table                             | Purpose                                                   | Personal data                                 | Device      | Retention                                                                          |
| --------------------------------- | --------------------------------------------------------- | --------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `events`, `event_exceptions`      | Household calendar                                        | Titles, places, notes, times, who's taking    | Yes         | Household (tombstones)                                                             |
| `event_people`                    | Who an event is for                                       | Person IDs                                    | Yes         | Household                                                                          |
| `event_reminders`                 | Reminder offsets                                          | None                                          | Yes         | Household                                                                          |
| `busy_blocks`                     | A member's busy times from their device calendar (opt-in) | Start and end times only, no text (R2-BUSY-3) | Yes         | Next 14 days are replaced on each sync; with the account or when the member leaves |
| `busy_day_overrides`, `busy_days` | Busy-day marks and the published result                   | Dates and flags                               | Yes         | Household                                                                          |
| Device calendar copies            | Events copied out to the member's own calendar (opt-in)   | As `events`                                   | Device only | Removed when turned off, at sign-out, or when access is lost (SR2-M2)              |

### 3.6 Phase 2: documents

| Table or store             | Purpose                                               | Personal data                                                  | Device                                           | Retention                                                                                                                  |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `documents`                | Vault metadata                                        | Title, category, expiry date, size, page count                 | Yes (metadata only)                              | Household (tombstones)                                                                                                     |
| Storage bucket `documents` | The files: JPEG pages, PNG or PDF, at most 10 MB each | Document images and PDFs (identity, insurance, medical papers) | Viewer cache only, deleted on close and sign-out | Purged through `storage_purge_queue` when the document or its household is deleted; uploads stuck for 24 hours are removed |
| `document_shares`          | Which member a document is shared with                | Member IDs                                                     | Yes                                              | Household; with the member's account                                                                                       |
| `event_documents`          | Attachments                                           | IDs                                                            | Yes                                              | Household                                                                                                                  |

### 3.7 Configuration and internal tables

| Table                                                                                | Purpose                                | Personal data              | Retention    |
| ------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------- | ------------ |
| `app_config`                                                                         | Limits, minimum version, kill switches | None                       | App lifetime |
| `private.export_registry`, `private.deletion_registry`, `private.scoped_sync_tables` | Which tables export, delete and sync   | None                       | App lifetime |
| `private.storage_purge_queue`                                                        | Storage folders waiting to be deleted  | Household and document IDs | Until purged |

### 3.8 On the device only

Not on the server: the encrypted sync copy (F-08), form drafts (`useDraftState`), the biometric lock setting, the analytics opt-out, device calendar settings and copy IDs, Reminders list IDs, the import run in progress, and the viewer's page cache. Android Auto Backup is off (SR2-L1). Sign-out clears all of it except the analytics opt-out, which is kept on purpose.

## 4. Processors

`NFR-SEC-7` limits sharing to these. Each acts for us as a service provider; none may sell the data or use it for advertising.

| Processor                                                                         | What it gets                                                                                                   | Purpose                                     | Region                | Status                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| **Supabase** (on AWS)                                                             | Everything in section 3                                                                                        | Database, auth, storage, Edge Functions     | `us-east-1`           | In use. Production plan and backups: **PROPOSED**, D-1.                               |
| **Expo** (EAS), with Apple Push Notification service and Firebase Cloud Messaging | Push tokens and push text (no personal content, FR-NOT-9); update requests (app and runtime version, platform) | Push delivery, builds, over-the-air updates | US                    | In use                                                                                |
| **Apple**                                                                         | Sign in with Apple; Reminders export; device calendar                                                          | Sign-in; on-device features                 | Apple                 | In use                                                                                |
| **Google**                                                                        | Google sign-in token; ML Kit document scanner on Android (runs on the device)                                  | Sign-in; scanning                           | Google                | In use                                                                                |
| **Sentry**                                                                        | Crashes and 20% of performance traces, user ID only, content stripped, no vault breadcrumbs (NFR2-SEC-2)       | Crash reporting                             | **PROPOSED** US       | **PROPOSED**, D-4: no account yet; the wrapper sends nothing without a DSN            |
| **PostHog**                                                                       | Product events with IDs, counts and fixed values only; GeoIP, autocapture and replay off; opt-out              | Product analytics, feature flags            | **PROPOSED** US Cloud | **PROPOSED**, D-4: no account yet; nothing is sent without a key                      |
| **Resend**                                                                        | Email address and the sign-in code or invite                                                                   | Transactional email                         | **PROPOSED**          | **PROPOSED**, D-4 and D-2: until then Supabase's built-in email sends sign-in codes   |
| **RevenueCat**, App Store, Google Play                                            | User ID, `household_id` attribute, purchases                                                                   | Subscriptions                               | RevenueCat US         | **PROPOSED**, D-10: the mock store is used until then                                 |
| **AI provider** (Anthropic proposed)                                              | Recipe text, link content or a recipe photo, with locale and region. Never names, people, allergies or plans.  | Recipe import                               | **PROPOSED**          | **PROPOSED**, D-7: no key is set; must not train on our data and must keep it briefly |

## 5. No advertising or tracking SDKs

Checked on 2026-11-26 against `package.json` and `pnpm-lock.yaml`:

- **Dependencies with network or data access:** `@supabase/supabase-js`, `@sentry/react-native`, `posthog-react-native`, `@react-native-google-signin/google-signin`, `expo-apple-authentication`, `expo-notifications`, `expo-updates`. Each is a processor in section 4.
- **Not present, in direct or transitive dependencies:** AdMob or Google Mobile Ads, the Facebook SDK, AppsFlyer, Adjust, Branch, Kochava, Singular, Firebase Analytics or Crashlytics, Amplitude, Mixpanel, Segment, OneSignal, Braze, CleverTap, and `expo-tracking-transparency`. A lockfile search for these names finds nothing.
- **Firebase Cloud Messaging only:** on Android, `expo-notifications` delivers pushes through FCM's native library. It carries no analytics, and no Firebase JavaScript SDK is installed.
- **No IDFA or Android advertising ID:** the app never asks for App Tracking Transparency. **To check on the first store build:** that the merged Android manifest has no `com.google.android.gms.permission.AD_ID` (block it in `android.blockedPermissions` if a library adds it), and that each SDK's iOS privacy manifest declares no tracking.
- **Not used for tracking:** PostHog's distinct ID is our user ID, used only in our own analytics.

## 6. Apple App Privacy answers (draft)

"Linked" means linked to the user's identity. **No data type is used for tracking.** Purposes: App Functionality (AF), Analytics (An), Product Personalization (PP).

| Apple data type                           | Collected                            | Linked | Tracking | Purposes | Source                                                                    |
| ----------------------------------------- | ------------------------------------ | ------ | -------- | -------- | ------------------------------------------------------------------------- |
| Contact Info: Name                        | Yes                                  | Yes    | No       | AF       | Display names; names of people the household feeds                        |
| Contact Info: Email Address               | Yes                                  | Yes    | No       | AF       | Sign-in, invites                                                          |
| Health & Fitness: Health                  | Yes                                  | Yes    | No       | AF       | Allergies and diets; the due month; medical papers in the vault (Phase 2) |
| Financial Info                            | No                                   |        |          |          | The stores handle payment                                                 |
| Location                                  | No                                   |        |          |          | Region is chosen, not located; PostHog GeoIP is off                       |
| Sensitive Info                            | Yes (**PROPOSED**, legal to confirm) | Yes    | No       | AF       | `diet.halal` and `diet.kosher` may reveal religion                        |
| Contacts                                  | No                                   |        |          |          | Invites use codes and links; no address book access                       |
| User Content: Photos or Videos            | Yes                                  | Yes    | No       | AF       | Recipe photos (processed, not stored); document scans (Phase 2)           |
| User Content: Other User Content          | Yes                                  | Yes    | No       | AF       | Recipes, plans, lists, events, documents                                  |
| Browsing History, Search History          | No                                   |        |          |          |                                                                           |
| Identifiers: User ID                      | Yes                                  | Yes    | No       | AF, An   | Supabase user ID; also in Sentry and PostHog (**PROPOSED**, D-4)          |
| Identifiers: Device ID                    | Yes                                  | Yes    | No       | AF       | Push token                                                                |
| Purchases: Purchase History               | Yes                                  | Yes    | No       | AF, PP   | Subscription state; grocery purchase memory and "frequently bought"       |
| Usage Data: Product Interaction           | Yes (**PROPOSED**, D-4)              | Yes    | No       | An       | PostHog events                                                            |
| Usage Data: Advertising Data              | No                                   |        |          |          |                                                                           |
| Diagnostics: Crash Data, Performance Data | Yes (**PROPOSED**, D-4)              | Yes    | No       | AF, An   | Sentry                                                                    |
| Other Data                                | Yes                                  | Yes    | No       | AF       | Children's age bands; busy times from the device calendar (Phase 2)       |

**Privacy policy URL:** needed (L-01.2, D-2 for the domain).

## 7. Google Play Data safety answers (draft)

- **Is data collected or shared?** Collected: yes. **Shared with third parties:** no. Every recipient in section 4 is a service provider, which Google doesn't count as sharing.
- **Encrypted in transit:** yes (HTTPS only; plain HTTP is allowed only in the local test build).
- **Can users ask for deletion?** Yes, in the app (A-04.3) and by household (FR-PRIV-7). **Gap:** Google also requires a web link for deletion requests. It needs the domain (D-2) and a page (L-01.2).
- **Independent security review:** not yet (D-20).
- **For children:** the app is for parents, not directed at children. **D-11:** confirm the target age group is 18+ and that no Families policy applies.

| Play category: type                                               | Collected                                                                | Optional                                  | Purposes                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------ |
| Personal info: Name                                               | Yes                                                                      | Partly (names of people fed are optional) | App functionality, Account management                                    |
| Personal info: Email address                                      | Yes                                                                      | No                                        | App functionality, Account management                                    |
| Personal info: User IDs                                           | Yes                                                                      | No                                        | App functionality, Analytics (**PROPOSED**, D-4)                         |
| Personal info: Other info                                         | Yes                                                                      | Yes                                       | App functionality (age bands, due month)                                 |
| Personal info: Race and ethnicity, Political or religious beliefs | **PROPOSED** yes for religious beliefs (halal, kosher), legal to confirm | Yes                                       | App functionality                                                        |
| Financial info: Purchase history                                  | Yes                                                                      | Yes                                       | App functionality, Personalization                                       |
| Health and fitness: Health info                                   | Yes                                                                      | Yes                                       | App functionality                                                        |
| Messages, Contacts, Location, Web browsing, Audio                 | No                                                                       |                                           |                                                                          |
| Photos and videos: Photos                                         | Yes                                                                      | Yes                                       | App functionality (recipe photos, scans)                                 |
| Files and docs                                                    | Yes (Phase 2)                                                            | Yes                                       | App functionality (vault PDFs)                                           |
| Calendar: Calendar events                                         | Yes                                                                      | Yes                                       | App functionality (household events; busy times from the device, opt-in) |
| App activity: App interactions                                    | Yes (**PROPOSED**, D-4)                                                  | Yes (opt-out)                             | Analytics                                                                |
| App activity: Other user-generated content                        | Yes                                                                      | No                                        | App functionality                                                        |
| App info and performance: Crash logs, Diagnostics                 | Yes (**PROPOSED**, D-4)                                                  | No                                        | Analytics, App functionality                                             |
| Device or other IDs                                               | Yes                                                                      | No                                        | App functionality (push token)                                           |

## 8. Open items

- **D-4:** create the Sentry, PostHog and Resend accounts, then confirm their regions and data processing agreements.
- **D-7:** pick the AI provider and confirm no training and its retention period.
- **D-10:** RevenueCat's data processing agreement.
- **D-11:** legal review of this inventory, the sensitive-data answers, the tombstone question in section 2, and the no-ads commitment.
- **D-1:** the production backup period behind FR-PRIV-4's 30 days.
- **`invite_attempts`:** add a purge of old rows (PROPOSED: older than 1 day); today they stay until the account is deleted.
- **#266:** Phase 2 tables and file types are covered here; #266 still needs the privacy policy draft and D-11.
