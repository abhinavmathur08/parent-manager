# Parent Manager: Phase 1 (MVP) backlog

Status: reconciled with [spec.md](spec.md) on 2026-11-07. Each item is one GitHub issue, one branch and one PR (see [CLAUDE.md](../CLAUDE.md)), and is sized for about a day or less.

**Scope:** Phase 1 plus the household foundation, as in the MVP row of [vision.md](vision.md). Design follows [design-system.md](design-system.md). Architecture is in [architecture.md](architecture.md).

**Done when** two partners can plan a week, share the list and shop from it on both platforms in beta testing.

**Sizes:** XS is half a day or less. S is about one day. Anything bigger is split before it starts.

**Order:** items are numbered in a valid build order, foundation first. Every item comes after the items it depends on. Decision IDs (`D-1` and so on) refer to [decisions-needed.md](decisions-needed.md), and an item with an open decision can't start until it's made.

**IDs:** items keep their original backlog ID, and split items add a suffix (F-03 became F-03.1 to F-03.3), so references in other docs still point at the right group.

**Already done:** F-01 Project setup (PR #1), F-02 pnpm (PR #4, issue #7) and F-05 localization foundation (PR #107, issue #8). Every other item has a GitHub issue in the Phase 1 MVP milestone, with the same ID in its title.

## Coverage

Every functional requirement in the spec (`FR-` IDs, 129 in total) is covered by at least one item; the generator checks this. Non-functional requirements (`NFR-`) are cited where an item delivers them. The rest are standing rules in `CLAUDE.md` and the definition of done (spec section 8.1).

## Gaps and conflicts found while reconciling

- **Missing items, now added:**
  - **G-09 frequently bought suggestions:** FR-MEM-3 to FR-MEM-5, conflict C-1 in the spec.
  - **A-01.3 first load on a new device:** FR-AUTH-8.
  - **P-06 week planned:** FR-PLAN-12.
  - **H-04.2 household settings and leaving:** FR-HH-14, FR-HH-15.
  - **A-04.3 delete household with two-parent confirmation:** FR-PRIV-7.
  - **A-04.1 analytics opt-out and policy links:** FR-PRIV-5, FR-PRIV-6.
  - **G-02.3 item sources:** FR-LIST-12.
  - **G-04.1 partner activity banner:** FR-LIST-9.
  - **R-03.2 import source on the recipe:** FR-AI-15.
  - **N-01.3 notification inbox:** FR-NOT-8.
- **The "needs-defrosting" tag** (spec C-4) is in R-02.3, and N-02.2 depends on it.
- **Sizes:** the old backlog had items sized M and L (up to a week). Each is split into steps of about a day. H-06 became a spike and three build steps.
- **Tap targets:** the request for this backlog said 44 pt, while spec NFR-A11Y-4 says 48 pt. design-system.md treats 44 pt as the floor and 48 pt as the product standard, so the spec stands.
- **Content work:** R-01.2 (ingredient seed) and R-04.2 (starter recipes) are content work, not code, and carry the `content` area. R-04.2 needs decision D-8.
- **Owner decisions block 7 items:** D-1, D-2, D-7, D-8, D-10, D-11. Each issue names the decision it waits on. Decisions made so far are recorded in decisions-needed.md.
- **Phase 1 items without an FR:** a few cite only NFRs or none (tooling, CI, the AI evaluation set). They exist because the spec's definition of done and launch gates need them.

## Items

### 1. F-02 Move from npm to pnpm (Done: PR #4, issue #7)

Replace npm with pnpm 12 (pinned in packageManager), keeping Expo's hoisted nodeLinker, and update CI, the E2E workflow and the docs.

- **Area:** Infrastructure
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** none
- **Acceptance:**
  - `pnpm install --frozen-lockfile` and `pnpm run check` pass locally and in CI
  - `package-lock.json` removed and `pnpm-lock.yaml` committed, with versions unchanged
  - Android E2E passes
  - `expo-doctor` passes

### 2. F-05 Localization foundation (Done: PR #107, issue #8)

i18next and react-i18next with expo-localization, en-US/en-GB/en-AU locale files with fallback, Intl-based formatters and unit display rules, a pseudo-locale, and lint rules against hard-coded text. Done in a single PR.

- **Area:** Localization
- **Size:** S
- **Spec:** NFR-L10N-1, NFR-L10N-2, NFR-L10N-3, NFR-L10N-4, NFR-L10N-5
- **Depends on:** F-02
- **Acceptance:**
  - Lint fails on text written directly in JSX and on untranslated accessibility labels
  - Pseudo-locale (`EXPO_PUBLIC_PSEUDO_LOCALE=1`) shows no unwrapped text
  - Unit tests format US (cups, oz) and AU (ml, g, 20 ml tablespoon) quantities

### 3. F-03.1 App variants per environment

Add `app.config.ts` so development, preview and production builds get their own bundle ID suffix, app name and icon badge.

- **Area:** Infrastructure
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** F-02
- **Acceptance:**
  - Development, preview and production builds install side by side on one device
  - Each variant shows its environment in the app name or icon badge (not in production)
  - README documents the variants

### 4. F-03.2 Point each EAS environment at its own Supabase project

Until D-1, every EAS environment (development, preview and production) uses the hosted `parent-manager` project, with its URL and publishable key set as EAS environment variables (decided 2026-11-12). This item gives production its own project once D-1 is made: a new project, its migrations, and production's EAS variables.

- **Area:** Infrastructure
- **Size:** XS
- **Spec:** none (tooling or content)
- **Depends on:** F-03.1; decisions D-1
- **Acceptance:**
  - Each variant reaches only its own backend (verified by the home screen status and a request log)
  - No secret keys in the app or the repo

### 5. F-03.3 Over-the-air updates with channels

Install `expo-updates`, use fingerprint-based runtime versions, and map preview and production build profiles to their update channels.

- **Area:** Infrastructure
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** F-03.1
- **Acceptance:**
  - An update published to `preview` reaches preview builds only
  - A native change produces a new runtime version, so old binaries never receive incompatible updates
  - Publishing to `production` is documented as needing product owner approval

### 6. F-04.1 CI: database tests against local Supabase

A CI job starts the local Supabase stack, applies migrations and runs pgTAP tests in `supabase/tests`.

- **Area:** Infrastructure
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** F-02
- **Acceptance:**
  - A PR with a failing RLS test is blocked
  - The job runs on every PR in under 10 minutes

### 7. F-04.2 CI: Edge Function tests

Run Deno tests for `supabase/functions` in CI.

- **Area:** Infrastructure
- **Size:** XS
- **Spec:** none (tooling or content)
- **Depends on:** F-04.1
- **Acceptance:**
  - A failing function test blocks the PR

### 8. F-04.3 CI: iOS end-to-end tests on macOS

Build a release iOS app on a macOS runner and run the Maestro flows, alongside the existing Android job.

- **Area:** Infrastructure
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** F-02
- **Acceptance:**
  - iOS and Android E2E both pass on `main`
  - The job uses Xcode 26.4 or later

### 9. F-04.4 Migration deploys: staging automatic, production approved

After a merge, apply migrations to staging. Production migrations run only from a manually approved workflow behind a protected environment.

- **Area:** Infrastructure
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** F-04.1, F-03.2; decisions D-1
- **Acceptance:**
  - Staging receives migrations within 10 minutes of a merge
  - Production requires the product owner's approval
  - The Supabase access token is a GitHub secret added by the product owner

### 10. F-06.1 Theme tokens and fonts

Create `src/constants/theme.ts` from docs/design-system.md (colors, type, spacing, radii, elevation, motion) for light and dark, and load Fraunces.

- **Area:** Design system
- **Size:** S
- **Spec:** NFR-A11Y-1
- **Depends on:** F-05
- **Acceptance:**
  - Every token in design-system.md exists in the theme file with the same name
  - Light and dark switch with the system setting
  - Unit test checks AA contrast for the allowed text pairs

### 11. F-06.2 Core controls

Button, IconButton, TextField, Stepper, Switch, SegmentedControl and RadioOption, per design-system.md section 8.

- **Area:** Design system
- **Size:** S
- **Spec:** NFR-A11Y-2, NFR-A11Y-3, NFR-A11Y-4
- **Depends on:** F-06.1
- **Acceptance:**
  - Each control has every listed state, a `testID` and translated accessibility props
  - Targets are at least 48 pt; controls work at the largest dynamic type size
  - Component tests cover states and accessibility labels

### 12. F-06.3 List and content components

ListRow, CheckboxRow, Checkbox, Card, Chip, Tag, Avatar and AvatarGroup, SectionHeader and ProgressBar.

- **Area:** Design system
- **Size:** S
- **Spec:** NFR-A11Y-4, NFR-A11Y-6
- **Depends on:** F-06.1
- **Acceptance:**
  - Rows are at least 56 pt and the whole row is the target
  - Checked state is shown by more than color
  - Avatars use initials only, with a ring in light mode

### 13. F-06.4 Overlays and feedback components

BottomSheet, Toast and UndoBar, Banner, EmptyState, Skeleton, AllergenNotice and CodeInput.

- **Area:** Design system
- **Size:** S
- **Spec:** NFR-A11Y-7, NFR-A11Y-8
- **Depends on:** F-06.2
- **Acceptance:**
  - Sheets keep their state when the app is backgrounded
  - Animations respect Reduce Motion
  - AllergenNotice always shows the disclaimer

### 14. F-06.5 Navigation shell and component gallery

The floating tab bar with Plan, List, Recipes and Household tabs (placeholder screens), the TopBar, and a component gallery screen in development builds.

- **Area:** Design system
- **Size:** S
- **Spec:** NFR-A11Y-5
- **Depends on:** F-06.3, F-06.4
- **Acceptance:**
  - Tabs are 52 pt tall and content never sits under the bar
  - Gallery shows every component in light and dark at default and largest text
  - Maestro smoke flow updated to the new shell

### 15. F-07.1 Crash reporting with Sentry

Add `@sentry/react-native` with the Expo plugin and source maps from EAS builds, with personal data scrubbed.

- **Area:** Infrastructure
- **Size:** S
- **Spec:** NFR-OBS-1, NFR-SEC-6
- **Depends on:** F-03.1
- **Acceptance:**
  - A test crash appears with readable stack traces
  - `sendDefaultPii` is off and `beforeSend` strips user content (unit test)

### 16. F-07.2 Product analytics wrapper with PostHog

A typed analytics wrapper that only accepts IDs, counts and fixed values, sends to PostHog with session replay off, and supports the per-device opt-out.

- **Area:** Infrastructure
- **Size:** S
- **Spec:** NFR-OBS-2, NFR-SEC-6, FR-PRIV-5
- **Depends on:** F-03.1
- **Acceptance:**
  - Unit test proves free-text properties are rejected
  - Opt-out stops all events on that device
  - Events queue offline and send later

### 17. F-08 Encrypted session storage

Store the Supabase session encrypted, with the key in `expo-secure-store`.

- **Area:** Accounts and auth
- **Size:** S
- **Spec:** FR-AUTH-5, NFR-SEC-1
- **Depends on:** F-02
- **Acceptance:**
  - Session survives restart
  - The stored value isn't readable as plain text
  - Sign-out clears key and session

### 18. F-09 Remote config, forced update and kill switches

An `app_config` table read at launch: a minimum version shows the blocking update screen (S-01), and kill switches can hide AI import and export targets.

- **Area:** Infrastructure
- **Size:** S
- **Spec:** NFR-REL-4
- **Depends on:** F-03.1, F-06.5
- **Acceptance:**
  - Raising the minimum version shows the update screen; lowering it removes it
  - The check fails open offline
  - Turning off the AI-import switch hides import entry points

### 19. H-01.1 Household schema and RLS: households, members, invitations

Tables `profiles`, `households`, `household_members` and `invitations`, the `private.household_role()` helper, and RLS policies per architecture section 4.

- **Area:** Households
- **Size:** S
- **Spec:** NFR-SEC-2
- **Depends on:** F-04.1
- **Acceptance:**
  - pgTAP: cross-household reads and writes fail for every table and role
  - Clients can't insert into `household_members` directly

### 20. H-01.2 Household schema and RLS: people, dietary, entitlements, app config

Tables `household_people`, `person_dietary`, `household_entitlements` and `app_config` with RLS. Entitlements are writable by the service role only.

- **Area:** Households
- **Size:** S
- **Spec:** NFR-SEC-2, NFR-SEC-4
- **Depends on:** H-01.1
- **Acceptance:**
  - pgTAP: isolation for every table and role
  - Clients can't write `household_entitlements`
  - Only age bands are stored for children, no birth dates

### 21. H-06.1 Sync spike: two devices offline

Time-boxed spike with Legend-State's Supabase sync on a throwaway table. If it fails, write up PowerSync for a product owner decision.

- **Area:** Sync
- **Size:** S
- **Spec:** NFR-OFF-5
- **Depends on:** H-01.1
- **Acceptance:**
  - Offline edits on two devices merge per architecture section 5
  - Check-offs never go backwards; deletes don't come back
  - An online change reaches the other device within 2 seconds
  - Written result with a recommendation

### 22. H-06.2 Sync layer: local persistence

Local SQLite copy of the household's working data in `src/lib/sync`, read on start so the app shows cached data offline.

- **Area:** Sync
- **Size:** S
- **Spec:** NFR-OFF-1, NFR-PERF-1
- **Depends on:** H-06.1
- **Acceptance:**
  - App starts and shows cached data in airplane mode
  - Data survives restarts

### 23. H-06.3 Sync layer: outbox and server timestamps

Queued writes in order, server-set `updated_at` and `version`, soft deletes, and a pending-changes indicator.

- **Area:** Sync
- **Size:** S
- **Spec:** NFR-OFF-3, NFR-OFF-4, NFR-OFF-5, NFR-OFF-6
- **Depends on:** H-06.2
- **Acceptance:**
  - Queued changes survive restarts and reboots
  - Pending indicator visible until synced
  - Two-client test harness passes the conflict rules

### 24. H-06.4 Sync layer: realtime by household

Supabase Realtime subscriptions filtered by household, applying remote changes to the local copy.

- **Area:** Sync
- **Size:** S
- **Spec:** FR-HH-13, NFR-PERF-3
- **Depends on:** H-06.3
- **Acceptance:**
  - A change on one online device appears on another within 2 seconds (p95)
  - Removed members stop receiving changes

### 25. A-01.1 Email code sign-in: backend and email

Supabase email OTP (6 digits, 10 minutes) with magic link, sent through Resend from the product domain, with localized templates.

- **Area:** Accounts and auth
- **Size:** S
- **Spec:** FR-AUTH-2
- **Depends on:** H-01.1
- **Acceptance:**
  - Codes expire after 10 minutes and lock after 5 wrong attempts
  - Emails come from the product domain and use translated copy

### 26. A-01.2 Sign-in and code screens

S-02 and S-03: email entry, code entry with resend timer, profile creation on first sign-in, sign-out, and policy links.

- **Area:** Accounts and auth
- **Size:** S
- **Spec:** FR-AUTH-1, FR-AUTH-2, FR-AUTH-4, FR-AUTH-5, FR-AUTH-7, FR-PRIV-6
- **Depends on:** A-01.1, F-06.5, F-08
- **Acceptance:**
  - A new user can sign up and sign in with a code on both platforms
  - Offline shows the offline message
  - Signing out clears the local session, local data and the push token
  - Maestro covers sign-in with the local test inbox

### 27. A-01.3 First load on a new device

After sign-in on a new device, download household data with a loading state, then show the Plan tab.

- **Area:** Accounts and auth
- **Size:** XS
- **Spec:** FR-AUTH-8
- **Depends on:** A-01.2, H-06.2
- **Acceptance:**
  - A household with 200 recipes loads within 5 seconds on 4G

### 28. A-02.1 Sign in with Apple

Native Sign in with Apple on both platforms through `signInWithIdToken`.

- **Area:** Accounts and auth
- **Size:** S
- **Spec:** FR-AUTH-1, FR-AUTH-3
- **Depends on:** A-01.2
- **Acceptance:**
  - Works on real iOS and Android devices
  - Button follows Apple's guidelines
  - Cancelling returns to sign-in with no error

### 29. A-02.2 Google sign-in and account linking

Native Google sign-in, and linking to an existing account with the same verified email.

- **Area:** Accounts and auth
- **Size:** S
- **Spec:** FR-AUTH-1, FR-AUTH-3
- **Depends on:** A-01.2
- **Acceptance:**
  - Signing in with Google for an email that already has an account reaches that account, with no duplicate

### 30. A-03 Biometric unlock

Optional Face ID, Touch ID or fingerprint lock with a timeout (S-04), off by default, with passcode fallback.

- **Area:** Accounts and auth
- **Size:** S
- **Spec:** FR-AUTH-6
- **Depends on:** A-01.2
- **Acceptance:**
  - With the lock on, opening after the timeout requires biometrics before any data shows
  - With it off, there's no prompt
  - If biometrics are unavailable, it falls back or turns off with a notice

### 31. H-02.1 Onboarding: create or join, name and region

S-05 and S-06: the create-or-join choice, household name, and region, which sets locale, units, week start, timezone and currency.

- **Area:** Households
- **Size:** S
- **Spec:** FR-ONB-1, FR-ONB-2, FR-ONB-3, FR-ONB-7
- **Depends on:** A-01.2, H-01.2
- **Acceptance:**
  - No birth dates or extra data collected
  - Region changes unit display
  - Interrupted onboarding resumes at the same step

### 32. H-03.1 Invitations backend

RPCs to create (link and 6-character code), accept (validity, expiry, revocation, seats, other household) and revoke invitations. Tokens hashed, single use, 7 days.

- **Area:** Households
- **Size:** S
- **Spec:** FR-HH-1, FR-HH-2, FR-HH-7, FR-HH-9, NFR-SEC-8
- **Depends on:** H-01.2
- **Acceptance:**
  - pgTAP covers each acceptance check
  - Codes avoid 0, O, 1 and I
  - A third parent is rejected on the server
  - Wrong codes are rate-limited

### 33. H-03.2 Invite sheet

S-27: choose a role, show the code and link, share through the share sheet or copy. Premium roles show the upgrade prompt on free households.

- **Area:** Households
- **Size:** S
- **Spec:** FR-HH-1, FR-HH-3
- **Depends on:** H-03.1, F-06.5
- **Acceptance:**
  - Share text contains the link and code
  - Parent role disabled when 2 parents exist, with the reason

### 34. H-03.3 Join a household by code or link

S-09: code entry in any case, invite links (universal and App Links), a preview of household, inviter and role, and the leave-current-household step.

- **Area:** Households
- **Size:** S
- **Spec:** FR-HH-4, FR-HH-5, FR-HH-6, FR-HH-8
- **Depends on:** H-03.1, H-02.1
- **Acceptance:**
  - A second account joins as a parent from a link or a code on either platform
  - Expired, revoked or used invites show clear messages
  - Maestro covers joining by code

### 35. H-04.1 Members and pending invitations screen

S-26: members with roles and joined dates, pending invites with expiry and revoke, change role and remove member.

- **Area:** Households
- **Size:** S
- **Spec:** FR-HH-9, FR-HH-10
- **Depends on:** H-03.1, F-06.5
- **Acceptance:**
  - A removed member loses access on the server immediately and their device clears household data on next sync
  - Role changes respect seat rules

### 36. H-04.2 Leave household, settings and access-paused screen

Leaving with the last-parent rule, household settings (name, region, units, timezone, week start) for parents, and S-35 for removed or paused members.

- **Area:** Households
- **Size:** S
- **Spec:** FR-HH-8, FR-HH-14, FR-HH-15
- **Depends on:** H-04.1
- **Acceptance:**
  - The last parent can't leave without promoting someone or deleting the household
  - Changing region re-displays units without changing stored data
  - Only parents can edit settings

### 37. R-01.1 Units, sections and ingredient schema

Catalog tables `units`, `store_sections`, `ingredients` and `ingredient_names` per architecture section 3.2, readable by all, with household-owned ingredients.

- **Area:** Recipes
- **Size:** S
- **Spec:** FR-REC-5, FR-REC-6
- **Depends on:** H-01.1, F-05
- **Acceptance:**
  - Regional units are separate IDs with spec R-ING-2 factors
  - Household ingredients are isolated by RLS

### 38. R-01.2 Ingredient seed data

About 400 common ingredients with en-US, en-GB and en-AU names, synonyms, sections, allergen codes, default staples and densities for common items.

- **Area:** Content
- **Size:** S
- **Spec:** FR-PAN-1
- **Depends on:** R-01.1
- **Acceptance:**
  - "courgette" and "zucchini" resolve to the same ID
  - Every ingredient has a section
  - The seed loads in CI

### 39. R-01.3 Ingredient matching on the device

Search catalog and household ingredients by name and synonym in the household's locale, for pickers and typed list items.

- **Area:** Recipes
- **Size:** S
- **Spec:** FR-REC-5, FR-LIST-6
- **Depends on:** R-01.2
- **Acceptance:**
  - Matching never merges by display text, only by ID
  - Results within 200 ms for the full catalog

### 40. R-02.1 Recipe schema and sync

Tables `recipes`, `recipe_ingredients` and `recipe_steps` with RLS, `quantity_base` calculation and sync.

- **Area:** Recipes
- **Size:** S
- **Spec:** FR-REC-12, FR-REC-4
- **Depends on:** R-01.1, H-06.3
- **Acceptance:**
  - pgTAP isolation tests
  - An edit made offline appears on the partner's device after reconnecting

### 41. R-02.2 Recipe editor

S-18: title, servings, times, tags, ingredient lines with quantity, unit and ingredient pickers (household units first), steps and notes.

- **Area:** Recipes
- **Size:** S
- **Spec:** FR-REC-4, FR-REC-5, FR-REC-6
- **Depends on:** R-02.1, R-01.3, F-06.5
- **Acceptance:**
  - A 10-ingredient recipe can be entered one-handed
  - Fractions like 1/2 and 1 1/2 are accepted
  - Unknown ingredients become household ingredients
  - Maestro covers creating a recipe

### 42. R-03.1 Recipes tab

S-16: household recipes (recent first) and the starter library, offline search across titles, ingredient names and tags, and tag filters.

- **Area:** Recipes
- **Size:** S
- **Spec:** FR-REC-1, FR-REC-7, FR-REC-10, NFR-PERF-5
- **Depends on:** R-02.2
- **Acceptance:**
  - Search works offline and returns within 200 ms for 500 recipes
  - Empty state offers add and import

### 43. R-04.1 Starter library: read-only recipes and save a copy

Load starter recipes from versioned seed data. They're read-only, and "save a copy" creates an editable household recipe linked to the original.

- **Area:** Recipes
- **Size:** S
- **Spec:** FR-REC-2, FR-REC-3
- **Depends on:** R-03.1
- **Acceptance:**
  - Starter recipes appear for every household
  - Saved copies are editable and independent

### 44. R-04.2 Starter library content

Write or license 40 to 60 starter meals weighted to new-parent tags, using catalog IDs, with rights recorded.

- **Area:** Content
- **Size:** S
- **Spec:** FR-REC-2
- **Depends on:** R-04.1; decisions D-8
- **Acceptance:**
  - Every recipe uses catalog ingredient and unit IDs
  - Every recipe has at least one new-parent tag
  - Content rights recorded

### 45. R-05.1 Import function: auth, quotas and jobs

The `import-recipe` Edge Function skeleton: session and role check (no caregivers), atomic monthly allowance reserve and release, hourly rate limit, job records purged after 30 days.

- **Area:** AI recipe import
- **Size:** S
- **Spec:** FR-AI-8, FR-AI-9, FR-AI-16, NFR-SEC-9
- **Depends on:** F-04.2, H-01.2
- **Acceptance:**
  - Concurrent requests can't exceed the allowance (test)
  - Failed imports don't count
  - Caregivers are rejected on the server

### 46. R-05.2 Import: link and text extraction

Fetch links with SSRF guards, parse schema.org recipe data first, otherwise extract readable text. Pasted text is used as given.

- **Area:** AI recipe import
- **Size:** S
- **Spec:** FR-AI-1, FR-AI-8
- **Depends on:** R-05.1
- **Acceptance:**
  - Private IP addresses and non-http schemes are refused
  - Pages with schema.org data parse without an AI call and don't count

### 47. R-05.3 Import: AI parsing and normalization

Call the chosen model with structured output, the locale and region, and the allowed unit and tag lists. Normalize units and ingredients to the catalog with a confidence per line. Retry once, 45-second limit.

- **Area:** AI recipe import
- **Size:** S
- **Spec:** FR-AI-6, FR-AI-11, FR-AI-14
- **Depends on:** R-05.2, R-01.3; decisions D-7
- **Acceptance:**
  - No household data is sent to the provider
  - Invalid model output is retried once, then fails cleanly
  - Each line has a confidence score

### 48. R-05.4 AI evaluation set and CI check

At least 60 gold-labelled recipes (20 US, 20 UK, 20 AU) and a script that scores ingredient, unit and allergen accuracy, run on prompt or model changes.

- **Area:** AI recipe import
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** R-05.3
- **Acceptance:**
  - Thresholds from spec AI-22 enforced
  - Results stored for comparison

### 49. R-06.1 Import: choose input and progress screens

S-19 and S-20: link, text, photo or screenshot, the allowance remaining, offline disabled state, progress that continues on the server, and the allowance-reached state.

- **Area:** AI recipe import
- **Size:** S
- **Spec:** FR-AI-1, FR-AI-2, FR-AI-3, FR-AI-10, FR-AI-11
- **Depends on:** R-05.3, F-06.5
- **Acceptance:**
  - Import is disabled offline with the offline message
  - Leaving and returning shows the result
  - Allowance reached shows the reset date and the upgrade prompt

### 50. P-01.1 Plan schema and sync

Tables `plan_entries` and `plan_entry_portions` with RLS and sync.

- **Area:** Planner
- **Size:** S
- **Spec:** FR-PLAN-11
- **Depends on:** R-02.1, H-06.4
- **Acceptance:**
  - pgTAP isolation tests
  - Plan changes reach other members within 2 seconds online

### 51. R-02.3 Recipe tags and deletion

The fixed tag set (including needs-defrosting) and deleting a recipe used in plans, which keeps a title snapshot in those entries.

- **Area:** Recipes
- **Size:** XS
- **Spec:** FR-REC-7, FR-REC-11
- **Depends on:** R-02.2, P-01.1
- **Acceptance:**
  - Deleting shows how many plan entries use the recipe
  - Plan entries keep the title as free text

### 52. P-01.2 Week view

S-10: the week from the household's week start, 7 days by 5 slots, previous and next, today, the empty state, and allergen markers on entries.

- **Area:** Planner
- **Size:** S
- **Spec:** FR-PLAN-1, FR-PLAN-2, FR-PLAN-11, FR-ONB-5
- **Depends on:** P-01.1, F-06.5
- **Acceptance:**
  - Dates follow the household timezone through daylight-saving changes
  - Empty week offers add, copy last week and templates
  - Allergen marker shows when a planned recipe affects someone eating

### 53. P-01.3 Add to a slot

S-11: recent recipes, search across household and starter recipes, free text, servings, and more than one entry per slot.

- **Area:** Planner
- **Size:** S
- **Spec:** FR-PLAN-3, FR-PLAN-4, FR-PLAN-5
- **Depends on:** P-01.2, R-03.1
- **Acceptance:**
  - Adding takes at most 2 taps after a search result appears
  - Both partners adding to the same slot offline keeps both entries
  - Maestro covers planning a week

### 54. P-01.4 Move, duplicate and remove entries

Long-press actions with a 5-second undo for removal.

- **Area:** Planner
- **Size:** XS
- **Spec:** FR-PLAN-7
- **Depends on:** P-01.3
- **Acceptance:**
  - Removal can be undone within 5 seconds
  - A delete by one partner wins over a move by the other

### 55. P-02 Copy last week

Copy all entries to the same weekday and slot, with "add" or "replace" when the week has entries, and undo for replace.

- **Area:** Planner
- **Size:** XS
- **Spec:** FR-PLAN-9
- **Depends on:** P-01.3
- **Acceptance:**
  - Dates shift correctly across month boundaries and daylight-saving changes

### 56. P-06 Week planned: progress and event

The "6 of 7 dinners planned" progress bar and the week-planned event at 5 dinners.

- **Area:** Planner
- **Size:** XS
- **Spec:** FR-PLAN-12
- **Depends on:** P-01.2, F-07.2
- **Acceptance:**
  - `week_planned` fires once per week
  - Progress text matches the bar

### 57. G-03.1 Pantry schema and default staples

Table `pantry_items` with RLS. New households get the region's default staples. No quantities or expiry in Phase 1.

- **Area:** Pantry
- **Size:** XS
- **Spec:** FR-PAN-1, FR-PAN-7, FR-ONB-6
- **Depends on:** R-01.2, H-01.2
- **Acceptance:**
  - A new household has default staples
  - pgTAP isolation tests

### 58. H-02.2 Onboarding: people, allergies and default staples

S-07 and S-08: people by age band (due month for expecting), allergies and diets with the disclaimer, region staples added, then the Plan tab empty state.

- **Area:** Households
- **Size:** S
- **Spec:** FR-ONB-2, FR-ONB-4, FR-ONB-5, FR-ONB-6, FR-ONB-7
- **Depends on:** H-02.1, G-03.1
- **Acceptance:**
  - A new user lands on the Plan tab with a household after at most 4 screens
  - Only the due month is stored for expecting
  - Default staples exist without a setup screen

### 59. H-05 People and allergy profiles

S-28: add, edit and remove people with age bands, diets and allergies from fixed codes, with the disclaimer. Always free.

- **Area:** Households
- **Size:** S
- **Spec:** FR-HH-11, FR-HH-12, FR-PAY-10
- **Depends on:** H-02.2
- **Acceptance:**
  - Allergies are stored as codes
  - Disclaimer is visible
  - Deleting a person removes their dietary rows
  - Simultaneous edits by two parents keep both codes

### 60. R-03.2 Recipe detail with scaling and allergen notice

S-17: ingredients at recipe servings with a stepper that rescales on screen, steps, source, and the allergen notice when a household person is allergic.

- **Area:** Recipes
- **Size:** S
- **Spec:** FR-REC-8, FR-REC-9, FR-AI-15
- **Depends on:** R-03.1, H-05
- **Acceptance:**
  - Scaling 4 to 6 servings converts correctly in both unit systems
  - Allergen notice and disclaimer appear for a matching allergy
  - Imported recipes show their source

### 61. R-06.2 Import review screen

S-21: the editable draft, highlighted low-confidence and unmatched lines, the allergen notice, save, discard and "enter manually instead".

- **Area:** AI recipe import
- **Size:** S
- **Spec:** FR-AI-4, FR-AI-5, FR-AI-6, FR-AI-7, FR-AI-13, FR-AI-15
- **Depends on:** R-06.1, R-02.2, H-05
- **Acceptance:**
  - Nothing is saved without confirmation
  - An allergen matching a household profile is flagged with the disclaimer
  - Maestro covers a link import with a mocked model

### 62. R-07 Photo and screenshot import

Camera and photo library input, on-device compression to 1600 px, upload to the temporary bucket, and deletion within 24 hours.

- **Area:** AI recipe import
- **Size:** S
- **Spec:** FR-AI-1, FR-AI-12
- **Depends on:** R-06.2
- **Acceptance:**
  - A cookbook photo and a screenshot both produce drafts
  - The bucket is empty again within 24 hours
  - Permissions are requested only when first needed

### 63. P-03 Portions and baby plates

S-12: portions per person (0, ½, 1, 2), baby plate at ¼ for 6 to 12 months, defaults by age band, and servings from portions.

- **Area:** Planner
- **Size:** S
- **Spec:** FR-PLAN-5, FR-PLAN-6
- **Depends on:** P-01.3, H-05
- **Acceptance:**
  - Defaults follow spec R-SERV-1
  - Changing portions changes list quantities (unit tests)

### 64. G-01.1 List engine: merge, scale and display

Pure TypeScript functions that turn plan entries, recipes and portions into list items: group by ingredient and dimension, sum base quantities, exclude staples and "have", display per unit system.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-LIST-1, FR-PAN-3, NFR-PERF-4
- **Depends on:** R-01.1, P-03, F-05
- **Acceptance:**
  - Unit tests: "1 cup" plus "2 cups" milk becomes 3 cups (US)
  - Mixed dimensions stay separate unless a density exists
  - A 7-day plan builds in under 100 ms on a mid-range Android phone

### 65. G-01.2 List engine: keep user edits on recalculation

Recalculation rules from spec section 5.4: never change checked, user-modified or manual items, add a new line when more is needed after checking, and respect deletions.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-LIST-3, FR-LIST-7
- **Depends on:** G-01.1
- **Acceptance:**
  - Unit tests cover every rule in spec R-LIST-4 and R-LIST-5

### 66. P-04 Leftover links

Link an entry as leftovers of an earlier one. The linked entry adds nothing to the list, and the original covers its servings.

- **Area:** Planner
- **Size:** XS
- **Spec:** FR-PLAN-8
- **Depends on:** P-03, G-01.2
- **Acceptance:**
  - Linking and unlinking updates the list correctly
  - Links can't point to a later entry

### 67. G-01.3 Grocery schema and the weekly list

Tables `grocery_lists`, `grocery_items`, `grocery_item_sources` and `purchase_events` with RLS. The current week's list is created automatically.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-LIST-1, FR-LIST-2
- **Depends on:** P-01.1, G-03.1
- **Acceptance:**
  - pgTAP isolation tests
  - Opening the List tab or adding the first plan entry creates the week's list

### 68. G-02.1 Grocery list screen

S-13: items by store section with large checkbox rows, quantities in household units, source hints, allergen markers and the "in the cart" group. Updates when the plan changes, with a change summary.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-LIST-3, FR-LIST-4, FR-LIST-5, FR-LIST-11
- **Depends on:** G-01.2, G-01.3, F-06.5
- **Acceptance:**
  - Rows are at least 56 pt and check off with one thumb
  - Works fully offline
  - Plan changes update the list with a summary

### 69. G-02.2 Add an item

S-14: typed items with catalog suggestions and an optional quantity and unit. A catalog item already on the list merges into it.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-LIST-6
- **Depends on:** G-02.1, R-01.3
- **Acceptance:**
  - A manual catalog item merges into the generated item and marks it user-modified
  - Free-text items stay their own rows

### 70. G-02.3 Item detail

S-15: edit quantity, unit or name, see sources, "I already have this" and delete.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-LIST-7, FR-LIST-12
- **Depends on:** G-02.1
- **Acceptance:**
  - Editing marks the item user-modified
  - Sources list the plan entries and recipe lines

### 71. G-03.2 Pantry screen and "I already have this"

S-22: staples by section with add and remove, "have this week" with undo, and the "assumed at home" row on the list.

- **Area:** Pantry
- **Size:** S
- **Spec:** FR-PAN-2, FR-PAN-3, FR-PAN-4, FR-PAN-5, FR-PAN-6
- **Depends on:** G-02.3, G-03.1
- **Acceptance:**
  - Staples never appear on the list unless added this week
  - "Have" lasts for the list week and syncs to partners
  - Caregivers can mark "have" but not change staples

### 72. G-04.1 Shopping together

Check-offs record who and when, "checked by" on items, a "someone else is updating" banner, and the rule that a later check is never undone by a stale offline uncheck.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-LIST-8, FR-LIST-9, FR-LIST-11
- **Depends on:** G-02.1, H-06.4
- **Acceptance:**
  - Two devices shopping offline and reconnecting end with a consistent list (two-device test)
  - Partner sees a check-off within 2 seconds online

### 73. G-04.2 Finish shopping and purchase events

Record a purchase event per check-off (removed if unchecked within 10 minutes) and at "finish shopping", from in-app actions only.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-LIST-10, FR-MEM-1, FR-MEM-2
- **Depends on:** G-04.1
- **Acceptance:**
  - At most one event per item per list
  - Finish shopping keeps unchecked items on the list

### 74. G-09 Frequently bought suggestions

Up to 8 suggestions when adding items, from items bought at least twice in the last 8 weeks, with "don't suggest" for 90 days.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-MEM-3, FR-MEM-4, FR-MEM-5
- **Depends on:** G-04.2, G-02.2
- **Acceptance:**
  - Suggestions exclude items already on the list and staples
  - "Don't suggest" hides an item for 90 days
  - Events are included in data export

### 75. G-05 Export sheet, shared formatter, and print or PDF

S-23 and one formatter that produces sections and items for every target. Print and PDF use a localized HTML template through `expo-print`.

- **Area:** List export
- **Size:** S
- **Spec:** FR-EXP-1, FR-EXP-2, FR-EXP-6, FR-PAY-10
- **Depends on:** G-02.1
- **Acceptance:**
  - Print matches in-app sections and quantities
  - Works offline
  - Export is available to every role and always free

### 76. G-06.1 Spike: Reminders sections

Check how sections and repeat exports can be represented through the public Reminders API, and choose the format.

- **Area:** List export
- **Size:** XS
- **Spec:** none (tooling or content)
- **Depends on:** G-05
- **Acceptance:**
  - A written decision on the title and notes format

### 77. G-06.2 Apple Reminders export

Request the reminders permission when first used, create or update a list for the week, and fall back to share or copy if permission is refused.

- **Area:** List export
- **Size:** S
- **Spec:** FR-EXP-3, FR-EXP-5
- **Depends on:** G-06.1
- **Acceptance:**
  - Re-exporting adds new items and completes removed or checked ones, with no duplicates
  - Refusing permission explains how to enable it and offers share or copy

### 78. G-07 Share and copy as text

Plain checklist text grouped by section, through the share sheet or copied to the clipboard.

- **Area:** List export
- **Size:** XS
- **Spec:** FR-EXP-4
- **Depends on:** G-05
- **Acceptance:**
  - Text pastes cleanly into Google Keep, Messages and Gmail
  - Format is localized

### 79. N-01.1 Push registration and permission in context

Register push tokens with `expo-notifications`. Ask for permission only after the first planned week or when turning on a type.

- **Area:** Notifications
- **Size:** S
- **Spec:** FR-NOT-2, FR-ONB-8
- **Depends on:** A-01.2, P-06
- **Acceptance:**
  - Permission is never requested during onboarding
  - Denied permission shows "off in system settings" with a link

### 80. N-01.2 Notification settings and quiet hours

S-29: per-type toggles, day and time for "plan your week", and quiet hours (default 21:00 to 07:00), stored on the server.

- **Area:** Notifications
- **Size:** S
- **Spec:** FR-NOT-6, FR-NOT-7
- **Depends on:** N-01.1
- **Acceptance:**
  - Turning a type off stops it
  - Quiet hours hold pushes until they end
  - No sound by default

### 81. N-01.3 Sending service and in-app inbox

An Edge Function that sends through Expo push after checking preferences and quiet hours, with copy localized on the server. The inbox (S-24) shows the last 50 with read state.

- **Area:** Notifications
- **Size:** S
- **Spec:** FR-NOT-1, FR-NOT-8, FR-NOT-9
- **Depends on:** N-01.2
- **Acceptance:**
  - Notifications contain no children's names or allergy details
  - A test notification reaches both platforms
  - Tapping an inbox item opens the related screen

### 82. N-02.1 "Plan your week" schedule

A `pg_cron` schedule sends the reminder the day before the week starts at 18:00 in the household's timezone, unless the week is already planned.

- **Area:** Notifications
- **Size:** S
- **Spec:** FR-NOT-3
- **Depends on:** N-01.3, P-06
- **Acceptance:**
  - Sent at the right local time for US time zones
  - Skipped when the coming week is planned

### 83. N-02.2 "List is ready" and "defrost tonight"

"List is ready" to other members (explicit button or week planned, at most once a day) and a local "defrost tonight" at 08:00 for tagged dinners.

- **Area:** Notifications
- **Size:** S
- **Spec:** FR-NOT-4, FR-NOT-5
- **Depends on:** N-01.3, G-02.1, R-02.3
- **Acceptance:**
  - "List is ready" is sent at most once per list per day
  - Defrost notifications move or cancel with the entry

### 84. A-04.1 Household tab, account and privacy screens

S-25, S-30 and S-31: the household hub, account (profile, biometric lock, sign out) and privacy and data (exports, analytics opt-out, policy links).

- **Area:** Settings and privacy
- **Size:** S
- **Spec:** FR-PRIV-1, FR-PRIV-5, FR-PRIV-6
- **Depends on:** F-06.5, F-07.2, A-03
- **Acceptance:**
  - Delete account is reachable within 3 taps of the Household tab
  - Analytics opt-out works per device

### 85. A-04.2 Data export

Household export for parents and account export for anyone: a ZIP with JSON for every table and CSV for recipes, plans and lists, through the share sheet. Always free.

- **Area:** Settings and privacy
- **Size:** S
- **Spec:** FR-PRIV-2, FR-MEM-4, FR-PAY-10
- **Depends on:** A-04.1, G-04.2
- **Acceptance:**
  - Export is ready within 30 seconds for a typical household
  - A test fails if a new table isn't covered by the export

### 86. A-04.3 Account and household deletion

Delete account with re-authentication: sole members delete the household, others leave it. Delete household with the other parent's confirmation. Warn about store subscriptions.

- **Area:** Settings and privacy
- **Size:** S
- **Spec:** FR-PRIV-3, FR-PRIV-4, FR-PRIV-7
- **Depends on:** A-04.1, H-04.2
- **Acceptance:**
  - After deletion the user can't sign in and no personal rows remain
  - The partner keeps the household
  - Backups purge within 30 days (documented)

### 87. M-01.1 RevenueCat in the app

Add `react-native-purchases` with the Supabase user ID and the household attribute: offerings, purchase and restore, using sandbox accounts. Products and prices are set by the product owner.

- **Area:** Subscriptions
- **Size:** S
- **Spec:** FR-PAY-7
- **Depends on:** H-04.1, F-03.1; decisions D-10
- **Acceptance:**
  - Sandbox purchase and restore work on both platforms
  - No billing configuration is changed by code or Claude

### 88. M-01.2 Entitlement webhook and reconciliation

A webhook Edge Function upserts `household_entitlements` (idempotent), plus a nightly reconciliation with RevenueCat.

- **Area:** Subscriptions
- **Size:** S
- **Spec:** FR-PAY-1, FR-PAY-8, FR-PAY-9
- **Depends on:** M-01.1, F-04.2
- **Acceptance:**
  - Every member sees Premium within 60 seconds of a purchase
  - A replayed webhook is harmless
  - Expiry or refund reverts the household to Free

### 89. M-03 Premium gates and lapse behavior

Server-enforced gates for family and caregiver seats, AI allowance tiers, templates and history. On lapse, caregivers pause and data stays.

- **Area:** Subscriptions
- **Size:** S
- **Spec:** FR-PAY-2, FR-PAY-3, FR-PAY-9, FR-PAY-10, FR-HH-1, FR-AI-9
- **Depends on:** M-01.2, R-05.1, H-04.1
- **Acceptance:**
  - pgTAP tests seat limits with and without an entitlement
  - After a lapse everything is still exportable
  - Safety, privacy and export features are never gated

### 90. P-05 Saved week templates (Premium)

Save a week as a named template and apply it with add or replace. Free households see the upgrade prompt.

- **Area:** Planner
- **Size:** S
- **Spec:** FR-PLAN-10
- **Depends on:** P-02, M-03
- **Acceptance:**
  - Applying a template matches the saved slots
  - Free households can't save or apply (server enforced)

### 91. G-08 History of plans and lists

S-34: past weeks' plans and lists. Free sees the current week and the last 4, enforced on the server. Older weeks are kept and show the Premium prompt.

- **Area:** Grocery list
- **Size:** S
- **Spec:** FR-LIST-13, FR-PAY-6
- **Depends on:** G-04.2, M-03
- **Acceptance:**
  - The free window is enforced on the server
  - Lapsed Premium hides older weeks without deleting them

### 92. M-02.1 Premium sheet at the moment of need

S-32: a sheet that names the triggering benefit, lists the others, shows store prices and the trial, and offers trial, not now and restore. Wired to every Phase 1 trigger.

- **Area:** Subscriptions
- **Size:** S
- **Spec:** FR-PAY-4, FR-PAY-5
- **Depends on:** M-03, F-06.4
- **Acceptance:**
  - Every Premium trigger opens the sheet with its benefit first
  - Only parents can buy; others see "ask a parent"
  - No full-screen paywall anywhere

### 93. M-02.2 Subscription status and restore

S-33: tier, renewal date, who bought it, manage in the store and restore, with the "activating" state and the both-parents guard.

- **Area:** Subscriptions
- **Size:** XS
- **Spec:** FR-PAY-8
- **Depends on:** M-02.1
- **Acceptance:**
  - Restore works after a reinstall
  - A second parent can't buy while the household is Premium

### 94. L-01.1 Data inventory and store privacy answers

List every table and third party with purpose and retention, and draft Apple's App Privacy answers and Google Play's Data safety form. Confirm no ad SDKs.

- **Area:** Release
- **Size:** S
- **Spec:** FR-PAY-11, NFR-SEC-7
- **Depends on:** F-07.2
- **Acceptance:**
  - Every table and processor in the architecture is in the inventory
  - No advertising or tracking SDKs are present

### 95. L-01.2 Privacy policy, terms and legal sign-off

Add the reviewed policy and terms and link them from sign-in and settings, in the user's locale. The text comes from legal review.

- **Area:** Release
- **Size:** XS
- **Spec:** FR-PRIV-6
- **Depends on:** L-01.1, A-04.1; decisions D-11
- **Acceptance:**
  - Legal review signed off before the external beta
  - Links work from sign-in and settings

### 96. L-02 Accessibility and one-handed audit

Audit core flows with VoiceOver and TalkBack, the largest text size, dark mode, reachability and interrupted use, and fix blockers.

- **Area:** Release
- **Size:** S
- **Spec:** NFR-A11Y-2, NFR-A11Y-3, NFR-A11Y-5, NFR-A11Y-8
- **Depends on:** G-07, P-05, G-04.1
- **Acceptance:**
  - No blocking issues in core flows
  - Screen-reader labels covered by component tests

### 97. L-03.1 Internal beta builds

Production-profile builds to TestFlight internal testing and the Play internal track. Each submission needs the product owner's approval.

- **Area:** Release
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** L-01.2, L-02, M-02.2
- **Acceptance:**
  - Both builds install from the stores' internal tracks
  - Crash reporting and analytics confirmed working

### 98. L-03.2 External beta and staged rollout plan

TestFlight external and Play closed testing with real partner households (at least 12 testers for 14 days on a personal Play account), plus a staged rollout and rollback plan.

- **Area:** Release
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** L-03.1
- **Acceptance:**
  - 10 or more two-parent households complete a planned week and a shared list on both platforms
  - Rollback plan documented: OTA revert, kill switches, halting the rollout

### 99. L-04 US store listings

Name, subtitle, description, keywords, screenshots, age rating and category for en-US.

- **Area:** Release
- **Size:** S
- **Spec:** none (tooling or content)
- **Depends on:** L-01.1, F-06.5; decisions D-2
- **Acceptance:**
  - Listings ready for review
  - Screenshots contain no text baked into images that can't be localized

## Deliberately after the MVP

These are in the vision, but outside its MVP row:

- Voice recipe import and voice capture
- Widgets and lock-screen shortcuts
- Siri and Google Assistant shortcuts
- The share extension
- Barcode and receipt scanning
- Pantry quantities and expiry
- Purchase recommendations
- "Fill my week" suggestions
- Multiple lists and custom aisle order
- Price and budget estimates
- Email digests
