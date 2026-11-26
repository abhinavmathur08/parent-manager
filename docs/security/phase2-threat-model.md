# Phase 2 threat model: calendar and documents

Written for L-05 (#264, NFR2-SEC-4) on 2026-11-25, against `main` at `3f50f49`. The findings it led to are in [phase2-review.md](phase2-review.md). It covers what Phase 2 adds: the shared calendar, device calendars, busy days and the document vault. Phase 1's model (households, sync, auth, AI import) is assumed and only revisited where Phase 2 depends on it.

## 1. What we protect

| Asset                                                                               | Why it matters                                                                        | Where it lives                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Document files** (scans, photos, PDFs of children's records, IDs, insurance)      | The most sensitive data in the app. Children's medical records are files only (D-19). | Private `documents` bucket, `<household>/<document>/<page>`; briefly the device's viewer cache.                                    |
| **Document metadata** (title, category including `doc.medical`, person tag, expiry) | Reveals that a child has a medical record, an ID document's expiry, who it's about.   | `documents`, `document_shares`, `event_documents`; the encrypted synced copy on members' devices.                                  |
| **Events** (title, place, notes, people, who's taking, repeats)                     | Where a child will be and when, appointments that may be health-related.              | `events` and its child tables; the encrypted synced copy; device calendar copies when a member turns them on; local notifications. |
| **Busy blocks** (a member's busy times from their own device calendar)              | A member's private schedule from outside the app.                                     | `busy_blocks` (member, start, end only, R2-BUSY-3); visible to parents.                                                            |
| **Busy days** (date, busy, reason)                                                  | Hints at parents' private events to family members and caregivers.                    | `busy_days`, published by parents' devices (D-23).                                                                                 |
| **Access decisions**: who may see what (D-16), the vault lock, Premium limits       | Enforce the privacy promises above, and billing.                                      | RLS and triggers in Postgres; the `documents` Edge Function; `VaultGate` on the device.                                            |
| **Server secrets**: service key, `DOCUMENTS_CRON_SECRET`, `NOTIFY_CRON_SECRET`      | The service key bypasses RLS and signs any storage link.                              | Edge Function secrets and Vault only. Never in the app or the repo.                                                                |

## 2. Who might attack

| Actor                                                 | What they have                                                                                   | What they might want                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1. Another household's member**                    | A valid account, the app, the publishable key, PostgREST, Realtime and Storage APIs, guessed IDs | Read or change any data of a household they don't belong to.                                                                                   |
| **A2. A family member or caregiver in the household** | A valid seat, everything a member can see, the same APIs                                         | Unshared events, unshared documents, parents' busy blocks, document files after an unshare or removal, sharing or editing they're not allowed. |
| **A3. A removed or paused member**                    | A still-valid session and refresh token for a while, their device's copies                       | Keep reading after access ends (R2-ACC-2).                                                                                                     |
| **A4. Someone holding an unlocked phone**             | Physical access to a member's unlocked phone for a short time                                    | Open the vault, take screenshots, read cached files.                                                                                           |
| **A5. Someone with the device's files**               | A backup, a lost or rooted phone, forensic tools                                                 | Files and data left in the app's container or backups.                                                                                         |
| **A6. A network attacker**                            | A hostile Wi-Fi network                                                                          | Read or change traffic, steal signed links.                                                                                                    |
| **A7. A third-party service**                         | Data we send to PostHog, Sentry, Expo push, Apple/Google push, the member's cloud calendar       | Personal data that shouldn't have reached them (NFR2-SEC-2, FR2-DOC-11).                                                                       |
| **A8. A compromised dependency**                      | Code running in the app or a build step                                                          | Anything the app can reach.                                                                                                                    |

A parent is trusted with all of their household's data (D-16): a parent attacking another parent of the same household is out of scope.

## 3. Trust boundaries and data flows

```
 Member's device                                   Supabase project                      Outside
 ┌──────────────────────────────┐                  ┌───────────────────────────────┐
 │ App (JS)                     │  HTTPS, JWT      │ PostgREST ── RLS + triggers   │
 │  ├ synced copy (SQLCipher) ◄─┼──────────────────┼► Postgres (events, documents, │
 │  ├ kv-store (settings, IDs)  │  Realtime (RLS)  │   busy_*, notifications)      │
 │  ├ VaultGate (lock, capture) │                  │       │ pg_cron + pg_net       │
 │  ├ viewer cache (60 s links) │  functions/v1    │       ▼                        │
 │  └ capture cache (uploads)   ├──────────────────┼► Edge Fn `documents`  ──────► Storage `documents`
 │                              │                  │   (service key; begin,         │  (private, no client
 │ OS calendar ◄── copies ──────┤                  │    finish, read, purge)        │   policy at all)
 │ (maybe synced to Google) ──► busy times (memory)│ Edge Fn `notify` ──────────────┼──► Expo push ─► APNs/FCM
 │ Local notifications          │                  └───────────────────────────────┘
 │ PostHog / Sentry (IDs only) ─┼──────────────────────────────────────────────────────► PostHog, Sentry
 └──────────────────────────────┘
```

Boundaries: **B1** device to Supabase (every request carries the member's JWT; RLS decides); **B2** Edge Function to Storage (service key; the function decides); **B3** app to the OS calendar and anything it syncs to; **B4** app to third parties (analytics, crash reports, push); **B5** the app's container to whoever holds the device or its backups.

## 4. Threats and controls (STRIDE by component)

Each control names where it lives. "Gap" points to a finding in [phase2-review.md](phase2-review.md).

### 4.1 Database: RLS and triggers (B1)

| Threat                                                                                        | Control                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 reads or writes another household's rows (I, T)                                            | Every Phase 2 table has `household_id`, RLS through `private.household_role()`, and anon revoked. `00_rls_enabled.test.sql` fails on any public table without RLS. Child rows are checked against their parent's household by trigger (`check_event_child`, `check_document_share`, `check_event_document`). |
| A2 reads unshared events or documents (I)                                                     | `private.can_read_event` (parent, or `shared`) and `private.can_read_document` (parent, or a live share, `ready` rows only). Child tables follow their parent; `event_documents` needs both (R2-ACC-1). pgTAP: `events_rls`, `documents_rls`, `event_exceptions`.                                            |
| A2 edits, deletes, shares or unshares what they may not (T, E)                                | `private.check_event` refuses `shared` changes by non-parents and any change except "taking" on events they didn't create; `can_edit_event` gates people, reminders and exceptions; shares and attachments are parent-only by policy and trigger.                                                            |
| A2 reads parents' busy blocks (I)                                                             | Select policy: parents, or your own blocks. Blocks have no text columns (test). Members see only published `busy_days` (date, flag, fixed reason).                                                                                                                                                           |
| A2 or A1 sets server columns (file sizes, `status`, `created_by`) or inserts documents (T, E) | `revoke insert on documents from authenticated`; `private.check_document` refuses changes to server columns.                                                                                                                                                                                                 |
| A3 keeps reading after removal or lapse (I)                                                   | `household_role()` is null at once for removed members, and for family and caregivers on Free. Scoped sync (`visible_ids`) drops rows from the device within 60 seconds online. Realtime checks RLS per change.                                                                                              |
| Bypassing Premium limits (E)                                                                  | Triggers under advisory locks: `limit_event_reminders`, `limit_documents`; share needs Premium (`check_document_share`).                                                                                                                                                                                     |
| Dynamic SQL injection (T)                                                                     | `visible_ids` runs as the caller, looks the table up in a registry and quotes the name. `export_rows` takes registry entries only.                                                                                                                                                                           |
| Errors that confirm another household's IDs exist (I)                                         | Triggers refuse non-members first with the same error as a missing row.                                                                                                                                                                                                                                      |

### 4.2 Storage and signed links (B2)

| Threat                                                              | Control                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 or A2 reads, lists or signs files directly (I)                   | The bucket is private with **no client policy** (`20261122140000_document_server_reads.sql`): clients can't read, list, sign or write. Only the `documents` function signs, with the service key (D-22).   |
| A2 or A3 gets a read link they shouldn't (I)                        | `read` checks `public.document_readable(caller, id)` (service role only), which runs `can_read_document` as the caller, and refuses deleted or unfinished documents with the same answer as a missing one. |
| A stolen read link (A6, A7) (I)                                     | Links last 60 seconds (`read_seconds`), TLS everywhere, the PDF view never navigates away from Storage and has JavaScript off, and links aren't logged.                                                    |
| A parent stores oversized files or more than the plan allows (E, D) | `begin` checks role, pages, per-file and plan limits; the bucket limits each object to 10 MB and three types; `finish` checks names and sizes match; the trigger holds the limits.                         |
| A stored file isn't what its type says (T)                          | Bucket type allow-list. Gap: bytes aren't checked (**SR2-L3**).                                                                                                                                            |
| Deleted files outlive their document or household (I)               | Triggers queue folders in `private.storage_purge_queue`; the hourly `purge` deletes them. Gap: needs secrets set in the hosted project (**SR2-M4**).                                                       |
| The purge endpoint is called by someone else (S, D)                 | `purge` needs `DOCUMENTS_CRON_SECRET`, compared in constant time; other actions need a valid user session checked against Auth.                                                                            |

### 4.3 The device: synced copy, caches and the vault (B5, A4, A5)

| Threat                                                   | Control                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A5 reads the synced copy (events, document metadata) (I) | SQLCipher with a random 256-bit key in SecureStore; no copy without SQLCipher; deleted at sign-out and when access is lost.                                                                                                                                                             |
| A5 reads document files left on the device (I)           | Files never sync. Pages download into `<cache>/vault-viewer/<id>/`, deleted on close, sign-out and launch; the iOS PDF view is `incognito` with no cache; send-out files are deleted after sharing. Gaps: capture files (**SR2-M1**), iOS URL cache (**SR2-M3**), backups (**SR2-L1**). |
| A4 opens the vault on an unlocked phone (S, I)           | `VaultGate`: a biometric or passcode check, on by default, again after 1 minute away; unlock held in memory only; no passcode, no vault; turning the lock off needs a check.                                                                                                            |
| A4 or malware screenshots or records documents (I)       | `usePreventScreenCapture` on every vault screen (`FLAG_SECURE` on Android), iOS app-switcher blur, content hidden while inactive. Gaps: unverified on devices (**SR2-M5**); attachment titles on event detail (**SR2-L4**).                                                             |

### 4.4 Device calendars (B3)

| Threat                                                             | Control                                                                                                                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Asking for calendar access when it isn't needed (privacy)          | Asked only when a member turns a feature on, after an explain-first sheet (NFR2-SEC-5).                                                                                      |
| Copies leak more than needed to the OS or a cloud calendar (I, A7) | Opt-in. A copy carries the title, time, place and kind's name only, never notes, people or attachments (FR2-DEV-3); meals only if turned on.                                 |
| Copies outlive the member's access (I, A3)                         | Unsharing removes a copy on the next run. Gap: removal or a lapse leaves them (**SR2-M2**). Sign-out keeps them by the member's choice (FR2-PRIV-4).                         |
| Busy times read too much of the member's own calendar (I)          | `busyEvents` keeps ID, all-day and times in memory only; blocks are member, start, end (R2-BUSY-3); turning it off, sign-out, leaving and removal delete them on the server. |

### 4.5 Notifications and third parties (B4)

| Threat                                                   | Control                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal or medical details reach push providers (I, A7) | Server pushes carry the notification ID, type and, for calendar types, the event ID and date; copy has no placeholders. `document_expiring` drops the category for `doc.medical`. `claim_pushes` re-checks access before sending.                    |
| Lock-screen exposure of event details (I, A4)            | Local reminders name kind, time and taking member only, unless the member turns on details on that device (off by default).                                                                                                                          |
| Analytics or crash reports carry content (I, A7)         | Analytics schema: IDs, counts, fixed values; vault events carry no category or title (`schema.ts`). Sentry strips quoted text, URLs' queries and request data; breadcrumbs are dropped while a vault screen is open. Edge Functions log counts only. |

### 4.6 Supply chain (A8)

The lockfile is installed with `--frozen-lockfile` in CI; Edge Function tests use `deno.lock` with `--frozen`; pnpm blocks install scripts unless allowed. `pnpm audit`: 2 moderate advisories in build-time tools (**SR2-L2**).

## 5. Assumptions and out of scope

- Supabase (Postgres, Storage, Auth, Realtime) enforces RLS and signs links correctly, and encrypts at rest (D-17). The external review (#265, D-20) is where a third party tests this.
- iOS and Android sandboxing, Keychain and Keystore work as documented. Rooted or jailbroken devices, runtime tampering and certificate pinning are MASVS L2 or resilience controls, out of scope for L1.
- A parent is trusted with all household data. A member who can see something can photograph it with another phone.
- Copies a member chose to put in a cloud calendar are governed by that provider once they leave the device.
- The hosted project holds test data only until D-1 and D-21 are settled.
