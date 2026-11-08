# Parent Manager

An Expo (TypeScript) mobile app for iOS and Android with a Supabase backend. See [docs/vision.md](docs/vision.md) for the product vision, [docs/architecture.md](docs/architecture.md) for how it is built, and [CLAUDE.md](CLAUDE.md) for our conventions.

## Getting started

You need Node 22 (see `.nvmrc`) and pnpm 12 (pinned in `package.json`; run `corepack enable` or install pnpm), plus Xcode 26.4 or later for iOS (Expo SDK 58 doesn't build on older versions; tested with Xcode 27.2) or Android Studio for Android. Xcode 26.4 and later need macOS Tahoe 26.2 or later. CocoaPods also needs a UTF-8 locale, so set `LANG=en_US.UTF-8` if `pod install` complains.

```bash
pnpm install
cp .env.example .env.local   # then add your Supabase URL and publishable key
pnpm run ios                  # or: pnpm run android
```

The app still starts without Supabase values, and the home screen shows "Supabase: not configured".

## Testing

```bash
pnpm run check   # lint, format check, typecheck and unit tests (same as CI)
pnpm test        # unit tests only
pnpm run test:db # pgTAP database tests in supabase/tests (needs `pnpm supabase start`)
pnpm run test:functions # Deno tests for supabase/functions (needs Deno 2)
```

Database tests run against the local stack, which needs Docker. Every new table needs a test there proving that another household's members can't read or write it.

Maestro flows in `.maestro/` run against a release build, which needs no Metro server. To run them on iOS, with a simulator booted and [Maestro](https://docs.maestro.dev) installed:

```bash
pnpm expo run:ios --configuration Release --no-bundler
pnpm run test:e2e
```

On Android, use `pnpm expo run:android --variant release` in place of the first command.

## Localization

All user-facing text lives in `src/i18n/locales`. `en-US` is the base, and `en-GB` and `en-AU` override only the words that differ, such as nappies instead of diapers. Lint fails on text written directly in JSX.

- **Formatting:** use the helpers exported from `@/i18n` (`formatNumber`, `formatDate`, `formatCurrency`, `formatQuantity` and `displayQuantity`). They use `Intl` and the spec's unit rules, so quantities follow the household's unit system.
- **Pseudo-locale:** to check that layouts stretch and nothing is hard-coded, start a development build with `EXPO_PUBLIC_PSEUDO_LOCALE=1`. Every translated string then shows accented and twice as long, so any plain English is text that skipped translation.

## Backend

`supabase/` holds the project config and SQL migrations. The hosted project is `parent-manager` (ref `qwjvwwqsqhnvmdyjiylm`, region `us-east-1`). Its URL and publishable key are on the dashboard under Project Settings → API Keys. Local Supabase needs Docker.

Use the Supabase CLI pinned in this repo (`pnpm supabase`, version 3), not a global install. In version 3, database commands target your local stack unless you pass `--remote`.

```bash
pnpm supabase link --project-ref qwjvwwqsqhnvmdyjiylm   # once per checkout
pnpm supabase migration new <name>                      # create a migration
pnpm supabase start                                     # run the local stack (Docker)
pnpm supabase migration up                              # apply migrations locally
pnpm supabase migration list --remote                   # compare with the hosted project
pnpm supabase migration up --remote                     # apply migrations to the hosted project
```

Remote commands may prompt for the database password. Set `SUPABASE_DB_PASSWORD` in your shell for that command only, and never commit it.

Auth sessions are stored with `expo-sqlite`'s `localStorage`, as in Supabase's Expo quickstart. That storage isn't encrypted, so review this before shipping if the spec calls for stronger protection.

## Builds

`eas.json` defines these build profiles:

| Profile                 | Use                                        |
| ----------------------- | ------------------------------------------ |
| `development`           | Development client for physical devices    |
| `development-simulator` | Development client for the iOS simulator   |
| `preview`               | Internal testing builds                    |
| `production`            | Store builds, with auto-incremented builds |

```bash
pnpm dlx eas-cli@latest build --profile preview --platform all
```

The project is [@abhinav08/parent-manager](https://expo.dev/accounts/abhinav08/projects/parent-manager) on Expo. EAS builds don't use `.env.local`. They get the Supabase values from EAS environment variables, which are set in the development, preview and production environments. To see them, run `pnpm dlx eas-cli@latest env:list --environment <name>`. To copy them into `.env.local`, run `pnpm dlx eas-cli@latest env:pull --environment development`.

## CI

- `.github/workflows/ci.yml` runs `pnpm run check` and an Expo dependency check on every PR and on pushes to `main`. Its "Database tests" job starts local Supabase, applies the migrations and runs the pgTAP tests in `supabase/tests`, and its "Edge Function tests" job runs the Deno tests in `supabase/functions`.
- `.github/workflows/e2e.yml` builds an Android release and runs Maestro on an emulator. It runs on pushes to `main`, or on demand with `gh workflow run e2e.yml --ref <branch>`.
