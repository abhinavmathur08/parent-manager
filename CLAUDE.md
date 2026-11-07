@AGENTS.md

# Parent Manager

Expo (TypeScript) mobile app for iOS and Android with a Supabase backend. The product spec lives in [docs/spec.md](docs/spec.md): read it before building a feature, and update it when requirements change.

## Git workflow

- **Never push to `main`.** All changes reach `main` through a pull request.
- Work on a branch, named `<type>/<short-description>` (for example `feat/add-login`, `fix/session-refresh`, `chore/bump-expo`).
- Open a PR for every change, and include what changed and how it was tested.
- **Run the tests before finishing.** Before calling work done or opening a PR, run `npm run check` and make sure it passes. If you changed a user flow, also run `npm run test:e2e`. If you couldn't run something, say so in the PR.
- Never skip or weaken a check to get it passing (`--no-verify`, `.skip`, lint-disable comments) without saying why in the PR.

## Commands

```bash
npm run ios            # build and run on the iOS simulator
npm run android        # build and run on an Android emulator
npm start              # start Metro for an existing development build
npm run check          # lint, format check, typecheck and unit tests (same as CI)
npm test               # unit tests only
npm run format         # apply Prettier
npm run test:e2e       # Maestro flows, needs a release build installed (see README)
```

Add dependencies with `npx expo install <package>`, not `npm install`, so versions match the Expo SDK.

## Project layout

- `src/app/`: Expo Router routes only. Every file here becomes a screen.
- `src/components/`, `src/hooks/`, `src/constants/`, `src/lib/`: everything else. Import with the `@/` alias.
- `__tests__/`: Jest tests. Keep them out of `src/app/`, or they become routes.
- `.maestro/`: end-to-end flows. Find elements by `testID`.
- `supabase/`: backend config and SQL migrations.
- `docs/`: spec and other project documentation.

## Supabase

- Always get the client from `getSupabase()` in `src/lib/supabase.ts`.
- Every schema change is a new migration (`npx supabase migration new <name>`). Never change a migration that has already been applied, and don't edit the schema from the dashboard.
- Enable Row Level Security on every new table, with explicit policies, in the same migration that creates it.
- Only the publishable key may appear in the app. `EXPO_PUBLIC_*` values are compiled into the app and readable by anyone, so secret and `service_role` keys must never use that prefix or be committed.
- Real values go in `.env.local` (git-ignored). When adding a variable, also add it to `.env.example`.

## Testing

- New logic gets Jest tests, and bug fixes get a test that fails without the fix.
- New or changed user flows get a Maestro flow in `.maestro/`.
- CI runs `npm run check` on every PR. The slower Maestro workflow (`e2e.yml`) runs on merges to `main` or on demand.
