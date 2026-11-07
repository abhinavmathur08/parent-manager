# Parent Manager

An Expo (TypeScript) mobile app for iOS and Android with a Supabase backend. See [docs/spec.md](docs/spec.md) for the product spec and [CLAUDE.md](CLAUDE.md) for our conventions.

## Getting started

You need Node 22 (see `.nvmrc`), plus Xcode 26.4 or later for iOS (Expo SDK 58 doesn't build on older versions; tested with Xcode 27.2) or Android Studio for Android. Xcode 26.4 and later need macOS Tahoe 26.2 or later. CocoaPods also needs a UTF-8 locale, so set `LANG=en_US.UTF-8` if `pod install` complains.

```bash
npm install
cp .env.example .env.local   # then add your Supabase URL and publishable key
npm run ios                  # or: npm run android
```

The app still starts without Supabase values, and the home screen shows "Supabase: not configured".

## Testing

```bash
npm run check   # lint, format check, typecheck and unit tests (same as CI)
npm test        # unit tests only
```

Maestro flows in `.maestro/` run against a release build, which needs no Metro server. To run them on iOS, with a simulator booted and [Maestro](https://docs.maestro.dev) installed:

```bash
npx expo run:ios --configuration Release --no-bundler
npm run test:e2e
```

On Android, use `npx expo run:android --variant release` in place of the first command.

## Backend

`supabase/` holds the project config and SQL migrations. The hosted project is `parent-manager` (ref `qwjvwwqsqhnvmdyjiylm`, region `us-east-1`). Its URL and publishable key are on the dashboard under Project Settings → API Keys. Local Supabase needs Docker.

Use the Supabase CLI pinned in this repo (`npx supabase`, version 3), not a global install. In version 3, database commands target your local stack unless you pass `--remote`.

```bash
npx supabase link --project-ref qwjvwwqsqhnvmdyjiylm   # once per checkout
npx supabase migration new <name>                      # create a migration
npx supabase start                                     # run the local stack (Docker)
npx supabase migration up                              # apply migrations locally
npx supabase migration list --remote                   # compare with the hosted project
npx supabase migration up --remote                     # apply migrations to the hosted project
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
npx eas-cli@latest build --profile preview --platform all
```

## CI

- `.github/workflows/ci.yml` runs `npm run check` and an Expo dependency check on every PR and on pushes to `main`.
- `.github/workflows/e2e.yml` builds an Android release and runs Maestro on an emulator. It runs on pushes to `main`, or on demand with `gh workflow run e2e.yml --ref <branch>`.
