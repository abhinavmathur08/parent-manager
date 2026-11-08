@AGENTS.md

# Parent Manager

One app that runs a new family's household logistics, starting with meals and groceries, so busy parents can spend their time on their children. Two partners share one household in real time, and caregivers can join on a Premium subscription. It launches in the US, then the UK and Australia, in English, built for more languages later.

- **[docs/vision.md](docs/vision.md)** is the source of truth for the product. If a request conflicts with it, ask.
- [docs/spec.md](docs/spec.md) says exactly how Phase 1 must behave. Build to its numbered requirements (`FR-`, `NFR-`, `R-` and `AI-`), and cite them in PRs.
- [docs/design-system.md](docs/design-system.md) defines the UI tokens and components. Screens use its tokens only, never raw colors or sizes.
- [docs/architecture.md](docs/architecture.md) describes how the app is built, and [docs/backlog.md](docs/backlog.md) lists the Phase 1 work, in order.

## Stack

Expo SDK 58 with React Native, TypeScript and Expo Router, built for iOS and Android. EAS handles builds, submissions and over-the-air updates. Supabase provides auth, Postgres, storage, row-level security (RLS) and Edge Functions. Sentry reports crashes, PostHog handles analytics and feature flags, RevenueCat handles subscriptions and Resend sends email. Jest runs unit tests, Maestro runs end-to-end (E2E) tests, and GitHub Actions runs CI.

**Package manager:** pnpm, with the version pinned in `package.json` (`packageManager`). Never use npm or yarn. pnpm blocks dependency install scripts unless they're approved in `allowBuilds` in `pnpm-workspace.yaml`, so approving a new one needs a reason in the PR.

Don't add a library or service for something the stack already covers. Any new dependency needs a reason in the PR description.

## Repo layout

- `src/app/`: Expo Router routes only. Every file here becomes a screen.
- `src/features/<module>/`: screens' components, hooks and data access, one folder per module (`recipes`, `planner`, `grocery`, and so on).
- `src/components/`, `src/hooks/`, `src/lib/`, `src/constants/`: code shared across modules. Import it with the `@/` alias.
- `src/i18n/`: locale files and formatting helpers.
- `supabase/migrations/`, `supabase/functions/`, `supabase/tests/`: the database schema, Edge Functions and database tests.
- `__tests__/`: Jest tests. `.maestro/`: E2E flows. `docs/`: product and engineering docs.

## Commands

```bash
pnpm install            # install dependencies
pnpm run ios            # build and run on the iOS simulator (Xcode 26.4+)
pnpm run android        # build and run on an Android emulator
pnpm start              # start Metro for an installed development build
pnpm run lint           # ESLint, no warnings allowed
pnpm run typecheck      # TypeScript
pnpm test               # Jest unit tests
pnpm run test:db        # pgTAP database tests (needs `pnpm supabase start` and Docker)
pnpm run check          # lint, format check, typecheck and unit tests, the same as CI
pnpm run test:e2e       # Maestro flows against an installed release build (see README)
```

Add dependencies with `pnpm expo install <package>`, never with a bare `pnpm add <package>`.

## Workflow rules

- **One GitHub issue, one branch, one PR.** Name the branch `<type>/<issue-number>-<short-slug>`, for example `feat/12-invite-partner`. The PR must say `Closes #<issue>`.
- **Never push to `main`.** Every change reaches `main` through a PR. Branch protection enforces this, and you must never weaken it.
- **CI must pass.** Run `pnpm run check` before opening a PR, plus `pnpm run test:e2e` if a user flow changed. Never skip, disable or loosen a check (`--no-verify`, `.skip`, lint-disable comments, lower thresholds) to get a pass.
- **Keep PRs small.** Each PR does one thing. If a change passes about 400 lines, not counting lockfiles and generated code, split it.
- **Keep the docs current.** If a change alters the architecture, update `docs/architecture.md` in the same PR. Never edit `docs/vision.md` without the product owner's approval.

## Localization rules

- **No hard-coded user-facing strings.** All copy comes from `t('key')` and the locale files, including accessibility labels, error messages, notifications, emails and print output.
- **Format through the locale helpers.** Dates, times, numbers, currency and quantities go through the helpers in `src/i18n`, which use `Intl`. Never build them by joining strings or calling `toFixed()`.
- **Store language-neutral identifiers.** Ingredients, units, tags, allergens and store sections are saved as stable IDs such as `ingredient.milk` or `unit.cup_us`, and their names come from translations. Never match, merge or sort on display text.
- **Units follow the household's region,** not the device's. Store quantities in base units (grams, millilitres or a count) and convert only for display. Regional units differ: an Australian tablespoon is 20 ml, not 15.
- **Layouts must stretch.** Screens must cope with text up to twice as long, large dynamic type and right-to-left scripts. Use `start`/`end` rather than `left`/`right`, and never put text inside images.
- **Every AI request includes the locale and region.**

## Privacy rules for family and children's data

- **Treat all household data as sensitive,** and children's data most of all.
- **Isolate every household.** Every table holding household data has a `household_id` column, and the migration that creates it also enables RLS with explicit policies. Each new table needs a database test proving another household's members can't read or write it.
- **Collect as little as possible.** Don't add a field about a child or a health detail (allergies, due date, age) unless `docs/vision.md` or an approved issue requires it. Prefer age bands to exact birth dates.
- **Keep personal data out of side channels.** Names, children's details, allergies, dates, emails, recipe text and list contents must never reach PostHog, Sentry, logs or AI prompts unless the feature needs them. Analytics events carry only IDs, counts and fixed values.
- **The `service_role` key and every other secret stay server-side,** in Edge Function secrets or CI secrets. Only the publishable key belongs in the app.
- **Deletion and export cover everything.** Account deletion and data export must include any new table.
- **Safety, privacy and exit features are always free:** allergy warnings, export, account deletion and privacy controls.

## Human gates: stop and ask the product owner

- **Secrets:** never create, commit, print or paste a secret, API key, token or password. Ask the product owner to add it to EAS, Supabase or GitHub secrets.
- **Payments and billing:** never change RevenueCat products, entitlements or offerings, store pricing, or any vendor plan or billing setting.
- **Store releases:** never submit to the App Store or Google Play, promote a release, or publish an OTA update to the production channel without explicit approval.
- **Other actions to ask about first:** creating accounts or paid resources, changing repo or branch-protection settings, deleting data in a hosted Supabase project, and sending email or push notifications to real users.

## Supabase and testing

- Get the client only from `getSupabase()` in `src/lib/supabase.ts`. Use the CLI pinned in this repo (`pnpm supabase`). Database commands target the local stack unless you pass `--remote`.
- Every schema change is a new migration. Never edit a migration that has already been applied, and never change the schema in the dashboard.
- New logic gets Jest tests. Bug fixes get a test that fails without the fix. RLS changes get database tests. New or changed user flows get a Maestro flow that selects elements by `testID`.
