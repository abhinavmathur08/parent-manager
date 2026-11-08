<!-- One issue, one branch, one PR. Keep it small (about 400 changed lines at most, not counting lockfiles and generated code). -->

Closes #<!-- issue number -->

## What changed

<!-- One or two sentences on what this PR does and why. Cite spec requirement IDs (FR-, NFR-, R-, AI-) where relevant. -->

## How it was tested

- [ ] `pnpm run check` passes (lint, lint rules, formatting, types, unit tests)
- [ ] New logic has unit tests, and a bug fix has a test that fails without the fix
- [ ] Database changes have pgTAP tests, including cross-household isolation for every new table
- [ ] Changed user flows have a Maestro flow, and `pnpm run test:e2e` passes
- [ ] Checked on iOS and Android (simulator or device)
- [ ] Anything not tested is listed here, with the reason:

## Localization

- [ ] No hard-coded user-facing text: all copy, accessibility labels, notifications and emails come from `src/i18n/locales`
- [ ] Dates, numbers, money and quantities use the `@/i18n` formatters
- [ ] Ingredients, units, tags and sections are stored as IDs, never matched on display text
- [ ] Layout checked with the pseudo-locale (`EXPO_PUBLIC_PSEUDO_LOCALE=1`) and at the largest text size

## Privacy and security

- [ ] No personal data (names, children's details, allergies, emails, recipe or list text) in analytics, logs, crash reports or AI prompts
- [ ] Every new household table has `household_id`, RLS policies and isolation tests in the same migration
- [ ] New tables are covered by data export and account deletion
- [ ] No secrets, keys or tokens in the code, config or this PR
- [ ] Safety, privacy and export features are not behind the paywall

## Design and accessibility

- [ ] Uses design-system tokens only (no raw colors or sizes)
- [ ] Tap targets are at least 48 pt, and text meets WCAG AA in light and dark mode
- [ ] Screen-reader labels and states are set

## Human gates

- [ ] This PR doesn't change billing, store submissions, production OTA updates, or repository settings, or the product owner approved it here:

🤖 If Claude wrote this PR, the description ends with the attribution line from CLAUDE.md.
