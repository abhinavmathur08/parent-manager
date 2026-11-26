# Phase 2 internal security review (L-05)

Issue #264, NFR2-SEC-4. Reviewed 2026-11-25 against `main` at `3f50f49` (all Phase 2 items merged: #310 export and deletion, #309 sharing, #313 Premium lapse). The threat model is in [phase2-threat-model.md](phase2-threat-model.md). The external review (#265) waits for D-20.

## Result

**No critical or high findings.** 5 medium and 4 low, each with a GitHub issue in the Phase 2 milestone. Two of the mediums need a check on a real device, and one needs the product owner to add secrets before the beta.

| ID     | Severity | Finding                                                                                      | Issue |
| ------ | -------- | -------------------------------------------------------------------------------------------- | ----- |
| SR2-M1 | Medium   | Captured document files can stay in the app cache (**fixed**)                                | #314  |
| SR2-M2 | Medium   | Device calendar copies stay after a member is removed or paused                              | #315  |
| SR2-M3 | Medium   | Viewed pages may persist in the iOS URL cache (needs a device check)                         | #316  |
| SR2-M4 | Medium   | File purging needs secrets in the hosted project before real documents exist (product owner) | #317  |
| SR2-M5 | Medium   | Screen-capture blocking not yet verified on devices (PDF view, scanner, app switcher)        | #318  |
| SR2-L1 | Low      | Android Auto Backup is on by default (**fixed**)                                             | #319  |
| SR2-L2 | Low      | 2 moderate advisories in build-time dependencies (**fixed**)                                 | #320  |
| SR2-L3 | Low      | Stored files' bytes aren't checked against their type (**fixed**)                            | #321  |
| SR2-L4 | Low      | Attachment titles on event detail sit outside the vault lock (needs a product decision)      | #322  |

Severity: **critical** is a cross-household or unauthenticated breach of documents or events; **high** is a member reading or changing what D-16 forbids, or document files reaching a third party, without device access; **medium** needs access to the member's own unlocked device or container, or a configuration step, or is unverified; **low** is defence in depth.

## Scope and method

- **Database:** every Phase 2 migration (`20261121100000` to `20261124180000`), each policy and `SECURITY DEFINER` function, and their pgTAP tests (`events_rls`, `event_exceptions`, `documents_rls`, `document_storage`, `busy_days`, `published_busy_days`, `scoped_sync`, `event_changes`, `who_taking`, `document_expiry`, `premium_lapse_phase2`, `data_export`, `data_deletion`, `00_rls_enabled`). Checked that every Phase 2 private function has its `execute` revoked from `public`.
- **Edge Functions:** `documents` (handler, storage client, config), the shared admin client, `notify`'s message builder, the purge and cron dispatch.
- **App:** `src/features/documents/` (vault gate and lock, viewer and its web view, capture, upload queue, send-out, attachments, sharing), `src/features/calendar/device/` and `src/lib/device-calendar/` (copies, busy times, permission), `src/lib/sync/` (encryption, scoped sync, Realtime), the analytics schema, crash reporting and every `console` call, `app.config.ts`.
- **Dependencies:** `pnpm audit` and `pnpm audit --prod`, the lockfile policy in CI, `deno.lock`, and how the download client caches (expo-file-system's native code).
- Not done here: on-device testing (SR2-M3, SR2-M5), dynamic testing against a hosted project (no hosted data was touched), and the external review.

## OWASP MASVS L1 checklist

MASVS v2 controls that apply to Phase 2. "Partly" points to a finding.

| Control                                                         | Result | Evidence                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MASVS-STORAGE-1: sensitive data stored securely                 | Pass   | Synced copy in SQLCipher with a SecureStore key (`src/lib/sync/database.ts:6-17`); session sealed with AES-GCM (`src/lib/encrypted-storage.ts`); files never sync.                                                                                     |
| MASVS-STORAGE-2: no sensitive data leaks from storage           | Partly | Viewer cache deleted on close, sign-out and launch (`src/features/documents/vault/viewer-cache.ts:22-48`); PDF view `incognito`, no cache (`document-pages.tsx:72-82`). SR2-M1, SR2-M3, SR2-L1.                                                        |
| MASVS-CRYPTO-1/2: strong crypto, keys managed                   | Pass   | Platform TLS; SQLCipher with a raw 256-bit random key; keys in Keychain/Keystore, `AFTER_FIRST_UNLOCK`. Storage encrypts at rest (D-17).                                                                                                               |
| MASVS-AUTH-1: secure authentication and authorization           | Pass   | Every request carries the member's JWT; RLS decides (section "Database"). The `documents` function checks the session with Auth (`supabase/functions/_shared/admin.ts:77-87`) and the role in SQL.                                                     |
| MASVS-AUTH-2: local authentication done safely                  | Pass   | `VaultGate` blocks rendering until `LocalAuthentication` succeeds (`vault-gate.tsx:70-117`); unlock in memory only (`vault-lock-store.ts:17`); no passcode, no vault; turning the lock off needs a check (`vault-lock-settings.tsx:31-37`).            |
| MASVS-AUTH-3: sensitive operations need extra auth              | Pass   | Opening documents needs the vault check; account and household deletion need a recent sign-in (Phase 1).                                                                                                                                               |
| MASVS-NETWORK-1: traffic secured                                | Pass   | HTTPS only; cleartext allowed only for E2E builds against a local stack (`app.config.ts:49-55`). Pinning is L2.                                                                                                                                        |
| MASVS-PLATFORM-1: IPC used safely                               | Pass   | Deep links open screens only; data still comes through RLS. Device calendar copies link back by event ID.                                                                                                                                              |
| MASVS-PLATFORM-2: WebViews used safely                          | Pass   | One web view, for iOS PDFs: JavaScript off, `originWhitelist` and `onShouldStartLoadWithRequest` limited to the Storage origin, no multiple windows, no link previews (`document-pages.tsx:72-82`). SR2-L3 is about content, not the view.             |
| MASVS-PLATFORM-3: UI doesn't leak data                          | Partly | `usePreventScreenCapture`, iOS app-switcher blur, content hidden while inactive (`vault-gate.tsx:57-68,106-117`). SR2-M5 (unverified on devices), SR2-L4.                                                                                              |
| MASVS-CODE-1/2: up-to-date platform, updates enforced           | Pass   | Expo SDK 58; forced updates through `app.minimum_version`.                                                                                                                                                                                             |
| MASVS-CODE-3: no known-vulnerable dependencies                  | Pass   | No high or critical advisories; 2 moderate, build-time only (SR2-L2). `--frozen-lockfile` in CI, `deno test --frozen`.                                                                                                                                 |
| MASVS-CODE-4: untrusted input validated                         | Pass   | `documents` validates every field (UUIDs, dates, categories, types, sizes) before SQL (`handler.ts:121-141`); SQL triggers re-check. SR2-L3.                                                                                                           |
| MASVS-PRIVACY-1: minimal access to sensitive data and resources | Pass   | Calendar permission only when a feature is turned on (`src/lib/device-calendar/permission.ts`); busy times keep ID and times only (`calendars.ts:171-186`); no microphone; no medical fields (D-19).                                                   |
| MASVS-PRIVACY-2: no identifying data to third parties           | Pass   | Analytics schema carries no title, category or person for documents (`src/lib/analytics/schema.ts:166-177`); pushes carry IDs and fixed copy (`supabase/functions/notify/messages.ts`); `doc.medical` dropped from expiry payloads; logs carry counts. |
| MASVS-PRIVACY-3: transparent data collection                    | Pass   | Explain-first sheets for calendar and camera access; store privacy answers are L-07 (#266).                                                                                                                                                            |
| MASVS-PRIVACY-4: user control over their data                   | Partly | Export and deletion cover every Phase 2 table and every file (A-05, registry tests). SR2-M4 (purging needs secrets), SR2-M2.                                                                                                                           |

MASVS-RESILIENCE (tamper and root detection) is outside L1.

## Database, storage and signed links

Nothing found. What was checked, with evidence:

- **Every Phase 2 table** (`events`, `event_people`, `event_reminders`, `event_exceptions`, `busy_blocks`, `busy_day_overrides`, `busy_days`, `documents`, `document_shares`, `event_documents`) has `household_id`, RLS, `revoke all ... from anon`, and select, insert and update policies only; hard deletes are revoked by `private.enable_sync`. `private.storage_purge_queue` and `private.scoped_sync_tables` are in the unexposed `private` schema.
- **D-16 is enforced in SQL, not the app.** Events: `can_read_event` (`20261121100000_calendar_events.sql:114`) and `check_event` (line 156), which keeps family members and caregivers to "taking" on events they didn't create, refuses any change to `shared` by them, and refuses their tombstones. Documents: `can_read_document` (`20261122100000_documents.sql:89`) needs a parent or a live share, while the seat is active, for `ready` rows; `event_documents` needs both the event and the document (line 366, R2-ACC-1). Busy blocks: parents or your own (`20261121140000_busy_days.sql:169`).
- **Server-owned columns:** clients can't insert documents (`documents.sql:340`) or change their files, size, status, household or creator (`check_document`, line 115).
- **Limits** are triggers under advisory locks (`limit_documents`, `limit_event_reminders`), so concurrent writes can't pass them.
- **`SECURITY DEFINER` functions** all set `search_path = ''`. Service-role RPCs (`document_readable`, `document_upload_context`, `claim_storage_purge`, `finish_storage_purge`, `remove_stale_document_uploads`, `claim_pushes`) revoke `public`, `anon` and `authenticated`. Every Phase 2 private function revokes `public`.
- **`visible_ids`** (`20261121130000_scoped_sync.sql:44`) is `security invoker`, resolves the name through `quote_ident` and the registry, so it can't read an unregistered table or bypass RLS.
- **Storage:** the bucket is private with no client policy at all (`20261122140000_document_server_reads.sql:9`), 10 MB per object and three types (`20261122110000_document_storage.sql:32-46`). Only the `documents` function signs links, after `document_readable` (line 16), which evaluates `can_read_document` as the caller and restores the claims. Links last `read_seconds` (60). Upload tokens are per path with `upsert: false`, and `finish` checks the stored names and sizes.
- **The function** checks sessions against Auth, compares the cron secret in constant time (`handler.ts:104-112,280`), answers refusals like a missing document, and logs counts only.
- **Export** is parent-only for the household (`export_household_data`), own rows for the account; busy blocks go in the member's own export.
- **Notifications:** `claim_pushes` re-checks visibility (`member_can_see_event`), role and Premium before sending; payloads hold IDs, kinds and dates; `doc.medical` has no category in expiry payloads (`20261123130000_document_expiry_reminders.sql:141`).

## Findings

### SR2-M1 (medium): captured document files can stay in the app cache, #314

`takePhoto()` (`src/features/documents/capture.ts:139`) converts the camera photo to a JPEG but never deletes the full-size original from the image picker's cache. A failed `scan()` (`capture.ts:115`) leaves the pages it already converted. Drafts live in memory (`add-queue.ts`), so a killed app leaves their files with no sweep at launch. The files are in the app sandbox, not shared storage or backups, so this needs the device. **Fixed (#314):** `takePhoto` deletes the camera original, a failed `scan` deletes the pages it converted, and every capture file is moved into `<cache>/vault-capture/` (`src/features/documents/capture-cache.ts`), which is deleted at launch and at sign-out, as `viewer-cache.ts` does.

### SR2-M2 (medium): device calendar copies stay after removal or a lapse, #315

`DeviceCalendarSync` runs only inside the tabs layout (`src/app/(tabs)/_layout.tsx:69`), and `onHouseholdAccessLost` only resets the synced copy (`src/features/household/membership.tsx:34`). A removed or paused member keeps the copies (title, time, place, kind) in their calendar, including a cloud calendar they picked, against R2-ACC-2. Unsharing an event is handled. **Fix:** `onHouseholdAccessLost(() => removeCopies())`, with a test.

### SR2-M3 (medium, needs a device check): viewed pages may persist in the iOS URL cache, #316

`downloadPages()` (`src/features/documents/read.ts:47`) uses `File.downloadFileAsync`, whose iOS session uses `URLSessionConfiguration.default` and so the shared disk `URLCache` (`node_modules/expo-file-system/ios/FileSystemDownload.swift:51`). Objects are stored with Storage's default `max-age=3600`, because `uploadToSignedUrl` (`upload.ts:122`) sets no `cacheControl`. If iOS caches download-task responses, page images outlive the viewer's folder. Android's client has no cache. **Fix:** inspect `Library/Caches/<bundle id>/` on an iPhone after viewing; if pages are there, store objects with `no-store` or download through a no-cache path.

### SR2-M4 (medium, product owner): purging needs secrets in the hosted project, #317

`private.dispatch_document_purge()` (`20261122110000_document_storage.sql:267`) does nothing until Vault has `documents_function_url` and `documents_cron_secret`, and `purge` refuses without `DOCUMENTS_CRON_SECRET` (`handler.ts:279`). The code is right, but until the product owner adds them (D-21), deleted documents' files stay in storage, against R2-DOC-4 and FR2-PRIV-2. **Fix:** add the secrets before any real document is stored, check `cron.job_run_details`, and add it to the beta checklist (#267). Secrets are a human gate, so this review doesn't touch them.

### SR2-M5 (medium, needs a device check): screen-capture blocking not verified on devices, #318

`VaultGate` blocks capture on every vault screen (`vault-gate.tsx:57-68`), but the PDF web view, the scanner and the app switcher haven't been checked on a real phone (`docs/architecture.md` 3.5 lists both as open; simulator screenshots prove nothing). Android's ML Kit scanner is outside `FLAG_SECURE` by design. **Fix:** test screenshots, recordings and the app switcher on an iPhone and an Android phone and record the results here; cover the PDF view if it leaks.

### SR2-L1 (low): Android Auto Backup is on, #319

`app.config.ts` leaves `android.allowBackup` at Expo's default, `true`. The synced copy and session are encrypted with Keystore keys that aren't backed up, but the plain kv-store (household ID, copy and busy-time state, vault setting) would be. **Fixed (#319):** `android.allowBackup: false` in `app.config.ts`, checked by `__tests__/app-config.test.ts`.

### SR2-L2 (low): build-time dependency advisories, #320

`pnpm audit`: `glob` (GHSA-3g3m-2fjr-6pw4, via `@sentry/bundler-plugins`) and `minimatch` (GHSA-g3hv-75wg-m249, via `@expo/fingerprint`), both moderate and build-time only. No high or critical. **Fixed (#320):** no Sentry, Expo or Jest patch release moves off the vulnerable ranges yet, so `pnpm-workspace.yaml` overrides only those ranges (`glob` 9 to 14.0.1 → 14.0.6, `minimatch` 7 to 11.0.0 → 11.0.9). `pnpm audit` reports no known vulnerabilities. Drop the overrides once the dependents ship patched versions.

### SR2-L3 (low): stored files' bytes aren't checked, #321

The bucket checks the declared content type and `finish` checks sizes (`handler.ts:194-205`), but not the bytes. Only a parent can upload, and the viewers can't run scripts. **Fixed (#321):** `finish` reads each stored file's first 8 bytes as the service role (a ranged download) and refuses with `documents.invalid` unless they start `%PDF-`, `FF D8 FF` or the PNG signature to match the declared type (`supabase/functions/documents/magic.ts`). The app also refuses a picked PDF or PNG whose bytes don't match before uploading it.

### SR2-L4 (low, product decision): attachment titles outside the vault lock, #322

Event detail lists attached documents' titles and categories (`src/features/documents/event-attachments.tsx:46`) outside `VaultGate`, so they aren't behind the lock or capture blocking. Only members who can see both see them. **Fix:** accept and say so in the spec, or show a count that opens through the vault.

### Noted, no action

- **Signed links are bearer tokens for 60 seconds.** Anyone holding one can read that file until it expires. Accepted in R2-DOC-2.
- **Send out is parent-only in the app only** (spec V6). A family member who can view a shared document can save what they see, so a server check adds nothing.
- **The vault setting is in the plain kv-store.** Changing it needs a rooted device, which is MASVS-RESILIENCE (L2).
- **Inbox entries keep an event's ID, kind and date after it's unshared.** No title or place; the member saw the event when it was sent.
- **Busy-day markers** tell family members and caregivers that a parent is busy, never why (R2-BUSY-2), as decided in D-23.

## For the product owner

1. **SR2-M4:** add `DOCUMENTS_CRON_SECRET` (Edge Function secret) and `documents_function_url`, `documents_cron_secret` (Vault) to the hosted project before the beta. Tied to D-21.
2. **SR2-L4:** decide whether attachment titles on event detail need the vault lock.
3. **External review (#265, D-20)** is still open. This document and the threat model are the inputs for it.
4. **Export compliance (not a vulnerability):** `app.config.ts` sets `ITSAppUsesNonExemptEncryption: false` while the app bundles SQLCipher and uses AES-GCM to protect user data. That's usually exempt, but whether the declaration needs anything more is a store question for L-07 (#266).

## Re-running this review

Before the beta (#267): close or re-rate SR2-M1 to M5, re-run `pnpm audit`, re-read any migration added after `20261124180000`, and add device results for SR2-M3 and SR2-M5 here.
