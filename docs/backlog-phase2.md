# Parent Manager: Phase 2 backlog

Status: draft, 2026-11-21, reconciled with [spec-phase2.md](spec-phase2.md). Phase 2 is **Shared Calendar and Appointments, with Documents and Records**. Each item is one GitHub issue, one branch and one PR of about 400 lines or less (see [CLAUDE.md](../CLAUDE.md)).

**Done when** busy days visibly change the plan, documents attach to appointments, and a security review is passed (spec-phase2 section 7.1).

**Sizes, order and IDs** work as in [backlog.md](backlog.md): XS is half a day or less, S about a day, and every item comes after what it depends on. New groups use letters Phase 1 doesn't: **C** calendar, **B** busy days, **V** document vault. Phase 2 items in existing groups continue their numbers (A-05, M-04, L-05 onwards). Decision IDs refer to [decisions-needed.md](decisions-needed.md).

**Issues:** none are created yet. They're created once the spec is merged and the product owner approves, in a "Phase 2" milestone with a `phase-2` label and new `area:calendar` and `area:documents` labels.

## Coverage

Every `FR2-` requirement is covered by at least one item. `NFR2-` requirements are cited where an item delivers them; the rest are checked in L-05 and the definition of done.

## Items

### 1. C-01.1 Calendar schema, RLS and sync

`events`, `event_people` and `event_reminders` with RLS (parents see all; family and caregivers see shared events), the reminder-count trigger (1 Free, 5 Premium), export and deletion registration, and sync registration.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR2-CAL-3, FR2-CAL-6, FR2-REM-1, FR2-PAY-2, R2-CAL-1, NFR2-SEC-1
- **Depends on:** none (Phase 1 sync and households)
- **Acceptance:**
  - pgTAP: another household can't read or write any row; a caregiver sees only shared events and can't change `shared`
  - A second reminder on a Free household is refused by the server
  - Export and deletion registry tests pass

### 2. C-01.2 Repeats: rules, exceptions and expansion

`event_exceptions` table and a pure `expandOccurrences` function (daily, weekly on weekdays, every 2 weeks, monthly; until or count; household timezone and daylight saving), with `stableId` exception IDs.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR2-CAL-4, R2-CAL-1, R2-CAL-2
- **Depends on:** C-01.1
- **Acceptance:**
  - Unit tests cover each rule, DST changes in the US, GB and AU, moved and skipped occurrences
  - Two devices editing the same occurrence offline write one exception (harness)

### 3. C-01.3 Sync: per-row visibility

`scoped` sync tables and `public.visible_ids(table)`, so rows a member can no longer see leave their device (architecture section 5).

- **Area:** Sync
- **Size:** S
- **Spec:** R2-ACC-2, NFR2-OFF-2
- **Depends on:** C-01.1
- **Acceptance:**
  - Harness: unsharing an event removes it from a caregiver's device within 60 seconds of reconnecting
  - Harness: a lapse or removal clears every scoped table on that member's device

### 4. C-02.1 Calendar tab and agenda view

S-36 as the second tab, opening on today in an agenda list from the local copy, with empty and offline states.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR2-CAL-1, FR2-CAL-6, NFR2-PERF-1, NFR2-L10N-1
- **Depends on:** C-01.2
- **Acceptance:**
  - Agenda shows expanded occurrences in the household's timezone and locale formats
  - Pseudo-locale and largest text size show no clipping
  - `calendar_viewed` recorded

### 5. C-03.1 Event editor

S-37 sheet: title, start, end or all day, kind, for, taking, place, notes and reminders, with FR2-CAL-2 defaults and draft survival.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR2-CAL-2, FR2-REM-1
- **Depends on:** C-02.1
- **Acceptance:**
  - An appointment can be added with a title and a start in 3 taps or fewer after opening the sheet
  - The sheet survives the app being killed (NFR-A11Y-8)
  - `event_created` carries only fixed values and counts

### 6. C-03.2 Event detail, taking and sharing

S-38: details, "taking" (members can take shared events themselves), share and unshare for parents, delete with undo.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR2-CAL-7, FR2-CAL-8
- **Depends on:** C-03.1
- **Acceptance:**
  - A caregiver can set themself as taking but can't edit others' events (pgTAP and component test)
  - Delete has a 5-second undo
  - Maestro: add an appointment and open its detail

### 7. C-03.3 Repeats in the editor

Repeat picker, "this event" or "all events" for edits and deletes, and series delete confirmation.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR2-CAL-4, FR2-CAL-8
- **Depends on:** C-03.2
- **Acceptance:**
  - Moving one occurrence changes only that day; editing all keeps exceptions
  - `event_updated` records `scope`

### 8. C-02.2 Day and week views with meals

Day and week views (week falls back to the agenda at the largest text sizes), overlaps side by side, and each day's planned meals as one row linking to the Plan tab.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR2-CAL-1, FR2-CAL-5, NFR2-A11Y-1
- **Depends on:** C-02.1
- **Acceptance:**
  - A day with a planned dinner shows it, and tapping opens that day in the Plan tab
  - VoiceOver and TalkBack read kind, time, title and taking member

### 9. C-04.1 Local event reminders

`EventReminderScheduler` with the shared 60-notification budget, quiet hours, the new `calendar_reminders` switch, and the "show event details" device setting.

- **Area:** Notifications
- **Size:** S
- **Spec:** FR2-REM-2, FR2-REM-3, FR2-REM-6
- **Depends on:** C-03.1
- **Acceptance:**
  - Reminders fire offline at the right local time, nearest first within the budget
  - Notification text has no title unless the member turned details on
  - On a lapse only each event's first reminder stays scheduled

### 10. C-04.2 Change notifications and "who's taking?"

`event_changed` (Premium, deduplicated per event and hour) and the daily `who_taking` job, with their switches and inbox entries.

- **Area:** Notifications
- **Size:** S
- **Spec:** FR2-REM-4, FR2-REM-5, FR2-REM-6
- **Depends on:** C-03.2
- **Acceptance:**
  - Deno and pgTAP tests: payloads carry IDs and fixed values only; recipients are only members who can see the event
  - No change notifications on Free

### 11. B-01.1 Busy-day engine and overrides

`busy_blocks` and `busy_day_overrides` tables, and the pure busy-day function with thresholds from `app_config`.

- **Area:** Planner
- **Size:** S
- **Spec:** FR2-BUSY-4, FR2-BUSY-5, R2-BUSY-1, R2-BUSY-2, R2-BUSY-3, NFR2-PERF-3
- **Depends on:** C-01.2, C-01.3
- **Acceptance:**
  - Unit tests: dinner-window overlap, 3-hour union, all-day ignored, overrides win, household timezone
  - pgTAP: `busy_blocks` has no text columns; only parents read; members write only their own

### 12. B-01.2 Busy markers on the Plan tab

Day headers show the busy icon and reason; parents and family can mark a day busy or not busy from the Plan and Calendar tabs.

- **Area:** Planner
- **Size:** XS
- **Spec:** FR2-BUSY-1, FR2-BUSY-4
- **Depends on:** B-01.1, C-02.1
- **Acceptance:**
  - The marker uses an icon and text, not color alone
  - A caregiver sees the marker but no hidden events behind it

### 13. B-01.3 Easy dinner sheet

S-43: "add an easy dinner" and "swap for an easy meal" with leftovers, household and starter candidates, one-tap apply with undo, and allergen notices.

- **Area:** Planner
- **Size:** S
- **Spec:** FR2-BUSY-2, FR2-BUSY-3, FR2-BUSY-6
- **Depends on:** B-01.2
- **Acceptance:**
  - Maestro: a busy day with an empty dinner gets a `tag.quick` recipe in one tap
  - Nothing changes in the plan without a tap; dismiss hides it for that day
  - `busy_day_suggestion_applied` recorded with `mode` and `source`

### 14. C-05.1 Calendar settings and permission

S-39 with the explain-first permission sheet, full calendar access on iOS (the `calendarPermission` plugin string), and the declined state.

- **Area:** Calendar
- **Size:** XS
- **Spec:** FR2-DEV-1, FR2-PRIV-3, NFR2-SEC-5
- **Depends on:** C-02.1; decision D-14 (decided)
- **Acceptance:**
  - No permission prompt until a feature is turned on
  - Declining leaves the calendar working

### 15. C-05.2 Copy events to the device calendar

`DeviceCalendarSync` copy-out: a "Parent Manager" calendar or a chosen writable one, single events per occurrence in the window, updates and deletions, optional meals, and the sign-out prompt.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR2-DEV-2, FR2-DEV-3, FR2-PRIV-4
- **Depends on:** C-05.1, C-03.3
- **Acceptance:**
  - A partner's move updates the copy on next open, on iOS and Android
  - Copies carry no notes, people or attachments

### 16. C-05.3 Share busy times

Pick device calendars, make busy blocks for the next 14 days in memory, skip all-day events and our copies, refresh limits, and delete on turning off, sign-out, leaving or removal.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR2-DEV-4, FR2-DEV-5, FR2-DEV-6
- **Depends on:** C-05.1, B-01.1
- **Acceptance:**
  - Unit test: a device event's title, place and notes never reach the outbox
  - Turning the feature off removes the member's blocks from the server at once

### 17. V-01 Spike: document scanner and PDF viewer

Compare `react-native-document-scanner-plugin` with the camera and `expo-image-manipulator`, and choose a PDF viewer or share-sheet fallback, on both platforms in a development build. Record the outcome in architecture section 3.5.

- **Area:** Documents
- **Size:** S
- **Spec:** FR2-DOC-2, FR2-DOC-4
- **Depends on:** none
- **Acceptance:**
  - A written decision with reasons for each new dependency
  - Multi-page scan works, or the fallback is documented

### 18. V-02.1 Document schema, shares and attachments

`documents`, `document_shares` and `event_documents` with RLS through `private.can_read_document`, export and deletion registration, and scoped sync of metadata.

- **Area:** Documents
- **Size:** S
- **Spec:** FR2-DOC-1, R2-ACC-1, R2-DOC-3, NFR2-SEC-1
- **Depends on:** C-01.3
- **Acceptance:**
  - pgTAP: other households, and members without a share, can't read or write rows
  - An attachment alone never grants a caregiver access

### 19. V-02.2 Storage bucket, upload function and purge

The private `documents` bucket and storage policies, the `documents` Edge Function (begin and finish upload, limits from `app_config`), signed reads, stale-upload cleanup and the hourly purge from `storage_purge_queue`.

- **Area:** Documents
- **Size:** S
- **Spec:** FR2-DOC-8, FR2-DOC-10, FR2-PAY-2, R2-DOC-1, R2-DOC-2, R2-DOC-4, FR2-PRIV-2
- **Depends on:** V-02.1; decision D-21 for hosted storage beyond test files
- **Acceptance:**
  - Deno tests: the 26th document on Free, a file over 10 MB and a caregiver upload are refused
  - Storage policy tests: no read without a share; links expire after 60 seconds
  - A deleted document's files are gone within one purge run

### 20. V-03 Vault lock and screen-capture protection

Vault lock with its own timeout and device setting, `expo-screen-capture` on vault screens, the iOS app-switcher blur, and the temporary viewer cache cleared on close and sign-out.

- **Area:** Documents
- **Size:** S
- **Spec:** FR2-DOC-3, FR2-DOC-4, NFR2-SEC-2, NFR2-SEC-3
- **Depends on:** V-02.1
- **Acceptance:**
  - Component tests: nothing renders before unlock; a device without a passcode can't open the vault
  - Screenshots are blocked on vault screens on both platforms (manual check)

### 21. V-04.1 Vault screen

S-40: documents by category with person and expiry, offline list, "waiting to upload" state, and the Household tab entry.

- **Area:** Documents
- **Size:** S
- **Spec:** FR2-DOC-1, NFR2-OFF-1
- **Depends on:** V-03
- **Acceptance:**
  - The list works offline; opening a file offline shows the offline message
  - Analytics never carry titles or categories of a named person's document

### 22. V-04.2 Add a document

S-41: scan, photo or file, HEIC to JPEG, size and page checks, title, category, person and expiry, and upload through V-02.2.

- **Area:** Documents
- **Size:** S
- **Spec:** FR2-DOC-2, FR2-DOC-8, FR2-DOC-11
- **Depends on:** V-01, V-02.2, V-04.1
- **Acceptance:**
  - A failed upload leaves no document row
  - At the limit, the Premium sheet opens with the `documents` trigger

### 23. V-04.3 Document viewer

S-42: pages from signed links, details, linked events, send out through the share sheet, and delete with undo.

- **Area:** Documents
- **Size:** S
- **Spec:** FR2-DOC-4, FR2-DOC-9, FR2-DOC-10, NFR2-PERF-2
- **Depends on:** V-04.2
- **Acceptance:**
  - No page remains in the cache after closing
  - Send out works on Free

### 24. V-05 Attach documents to appointments

Attach existing or new documents from S-38, show attachments on events and events on documents.

- **Area:** Documents
- **Size:** S
- **Spec:** FR2-DOC-5, R2-ACC-1
- **Depends on:** V-04.3, C-03.2
- **Acceptance:**
  - Maestro (iOS and Android): attach the insurance card to an appointment and open it from the event
  - A caregiver without a share sees the event but not the attachment

### 25. V-06 Share documents with members

Share and unshare with named family members and caregivers (Premium), and the "share attachments too" offer when sharing an event.

- **Area:** Documents
- **Size:** S
- **Spec:** FR2-DOC-6
- **Depends on:** V-05, C-01.3
- **Acceptance:**
  - Unsharing removes the document from the member's device on next sync (harness)
  - On Free the share action opens the Premium sheet

### 26. V-07 Document expiry reminders

`document_expiring` daily job (Premium), 30 and 7 days before, to parents, with the `document_expiry` switch.

- **Area:** Notifications
- **Size:** XS
- **Spec:** FR2-DOC-7
- **Depends on:** V-02.1
- **Acceptance:**
  - Payload has the category and date only; nothing sent on Free

### 27. M-04 Phase 2 Premium triggers and lapse

Premium sheet triggers `reminders`, `documents`, `document_share` and `caregiver_calendar`, and lapse behavior for reminders, shares and expiry reminders.

- **Area:** Subscriptions
- **Size:** S
- **Spec:** FR2-PAY-1, FR2-PAY-2, FR2-DOC-8, FR2-REM-6
- **Depends on:** V-06, C-04.2
- **Acceptance:**
  - Each trigger opens the sheet with its benefit first
  - After a lapse nothing is deleted and every document stays viewable and exportable

### 28. A-05 Export and deletion for Phase 2

Add Phase 2 tables to household and account export, include files in a `documents/` folder of the ZIP, and cover files in household and account deletion.

- **Area:** Privacy
- **Size:** S
- **Spec:** FR2-PRIV-1, FR2-PRIV-2
- **Depends on:** V-02.2, B-01.1
- **Acceptance:**
  - Export of a household with documents contains every Phase 2 table and file
  - After household deletion, no row or storage object remains (pgTAP and Deno)

### 29. L-05 Threat model and internal security review

Written threat model and an OWASP MASVS L1 review of RLS, storage, signed links, device copy and caches, vault lock, device calendars and dependencies. Fix findings in follow-up items.

- **Area:** Release
- **Size:** S
- **Spec:** NFR2-SEC-4
- **Depends on:** A-05, V-06, C-05.3
- **Acceptance:**
  - Threat model and findings kept in `docs/security/`
  - No open high or critical finding

### 30. L-06 External security review

A short external mobile and API test of the calendar and vault, by the reviewer the product owner chooses.

- **Area:** Release
- **Size:** S
- **Spec:** NFR2-SEC-4
- **Depends on:** L-05; decision D-20
- **Acceptance:**
  - Report received; every high or critical finding fixed and retested

### 31. L-07 Data inventory and store privacy answers for Phase 2

Add calendar, busy-time and document data to the data inventory, the privacy policy draft, Apple's App Privacy answers and Google's Data safety form.

- **Area:** Release
- **Size:** XS
- **Spec:** NFR-SEC-7, NFR2-SEC-2
- **Depends on:** L-05; decision D-11
- **Acceptance:**
  - Every Phase 2 table and file type is in the inventory

### 32. L-08 Phase 2 beta

Release Phase 2 behind a feature flag to Phase 1's beta households for 3 weeks, including Premium households with a caregiver, and measure the definition of done.

- **Area:** Release
- **Size:** S
- **Spec:** none (release)
- **Depends on:** L-06, L-07
- **Acceptance:**
  - The busy-day and attach-and-open measures in spec-phase2 section 7.1 are reported
  - Each store submission is approved by the product owner

## Deliberately after Phase 2

- Two-way device calendar sync, and server connections to Google or iCloud
- Structured medical records and health schedule templates
- Offline document files and client-side encryption (revisit after L-06)
- Text extraction or AI on documents
- Tasks from appointments (Phase 3) and the meal train on the calendar (Phase 5)
- Global search across modules
