# Parent Manager: Phase 2 product specification

Status: draft for the product owner's review, 2026-11-21. Phase 2 is **Shared Calendar and Appointments, with Documents and Records**.

How this relates to the other docs:

- [vision.md](vision.md) is the source of truth. This spec implements its sections "Shared Calendar and Appointments", "Documents and Records", "How the modules connect" (calendar to meals, calendar to documents), the free and Premium table, and the Phase 2 row of "Roadmap and MVP scope".
- [spec.md](spec.md) is the Phase 1 spec. Everything in it still holds: roles, sync, notifications, export, deletion, the paywall rules and the non-functional requirements. This spec only adds to it.
- [architecture.md](architecture.md) says how Phase 2 is built (sections 3.5, 4, 5 and 9), and [backlog-phase2.md](backlog-phase2.md) breaks it into items.

**How to read this spec:**

- Requirements are numbered `FR2-<area>-<n>` (functional), `NFR2-<area>-<n>` (non-functional) and `R2-<area>-<n>` (data and business rules). The `2` keeps them apart from Phase 1's `FR-`, `NFR-`, `R-` and `AI-` IDs. Phase 2 uses no AI, so there are no `AI2-` requirements.
- **PROPOSED**, **ASSUMPTION** and user-facing text work as in spec.md: copy is named by purpose and lives in the locale files.
- Decision IDs `D-14` to `D-21` are in [decisions-needed.md](decisions-needed.md). Screen IDs continue from spec.md (`S-36` onwards).

## 1. Overview and scope

### 1.1 What Phase 2 delivers

Phase 2 gives the household one shared calendar for appointments and family plans, a secure vault for the paperwork those appointments need, and the first link between modules: a busy day changes what's for dinner.

**Done when** busy days visibly change the plan, documents attach to appointments, and a security review is passed (vision roadmap, Phase 2). Section 7.1 makes each part testable.

### 1.2 In scope

1. **Shared calendar:** events and appointments with a day, week and agenda view, simple repeats, offline use and real-time sharing.
2. **Appointment details:** who the event is for, who is taking them, preparation notes, a free-text place, reminders and attached documents.
3. **Device calendars (D-14):** a one-way copy of household events into each member's phone calendar, and an optional "busy times" import from calendars a member picks, shared as busy blocks without titles.
4. **Busy days (D-18):** a fixed rule marks busy days on the Plan tab (free), and Premium households get a one-tap easy dinner (D-15).
5. **Meals on the calendar:** each day in the calendar shows its planned meals.
6. **Document vault (D-17, D-19):** scan or upload files, categories, an optional person tag and expiry date, a biometric lock, and attach to appointments.
7. **Sharing with family members and caregivers (D-16):** only events and documents a parent shares.
8. **Free and Premium (D-15),** with safety, privacy, export and deletion always free.
9. **Security review** of the calendar and vault before release (D-20).

### 1.3 Out of scope for Phase 2

- Two-way device calendar sync, and server-side Google or iCloud calendar connections (D-14).
- Structured medical records: diagnoses, vaccine logs or schedules, growth, medications (D-19). Built-in health schedule templates (vision: checked against official guidance first).
- AI on documents or events: no text extraction, summaries or auto-filled expiry dates.
- Offline access to document files (D-17). Document metadata is listed offline; opening a file needs a connection.
- Tasks from appointments ("call the pediatrician"): Phase 3. Meal train on the calendar: Phase 5.
- Global search across modules, invitations to outside guests, and attendee lists.

### 1.4 Glossary

| Term            | Meaning                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event           | Anything on the household calendar, with a kind, a title, a time or all-day dates, and optional details.                                             |
| Kind            | A fixed identifier: `kind.appointment`, `kind.childcare`, `kind.activity`, `kind.family` or `kind.other`. Names come from translations.              |
| Appointment     | An event of kind `kind.appointment`, such as a pediatric or prenatal visit. It can have preparation notes, a "taking" member and documents.          |
| Taking member   | The household member taking the child or person to an event ("who is taking the baby"), or nobody yet.                                               |
| For (people)    | The household people an event is about, from `household_people`. Optional.                                                                           |
| Shared event    | An event visible to the household's family members and caregivers. Parents always see every event.                                                   |
| Repeat          | A simple rule: daily, weekly on chosen weekdays, every 2 weeks, or monthly on the same date, ending never, on a date, or after a count.              |
| Device calendar | A calendar in the phone's own calendar store (iCloud, Google account or local), reached through the operating system.                                |
| Busy block      | A start and end time copied from a member's device calendar, with no title, place or notes, shared with parents so busy days account for it.         |
| Busy day        | A day the busy-day rule (R2-BUSY-1) marks, or a member marks by hand.                                                                                |
| Easy meal       | A household or starter recipe tagged `tag.quick`, `tag.no_cook`, `tag.freezer_friendly`, `tag.batch_prep` or `tag.one_handed`, or a leftovers entry. |
| Document        | A file in the vault (one or more scanned pages, or one PDF or image) with a title, category, optional person tag and optional expiry date.           |
| Category        | A fixed identifier: `doc.insurance`, `doc.identity`, `doc.childcare_school`, `doc.medical`, `doc.household` or `doc.other`.                          |
| Vault lock      | A biometric or device-passcode check before the vault shows anything, separate from the app-wide lock.                                               |
| Document share  | A parent's grant that lets one named family member or caregiver see one document.                                                                    |

## 2. Roles and permissions

Phase 1's roles and seat rules stand. Family members and caregivers are Premium seats, and lose access when Premium lapses (FR-PAY-9). Decided in D-16: family members and caregivers see only what a parent shares.

| #             | Action                                                 | Parent | Family member        | Caregiver            | Tier                  |
| ------------- | ------------------------------------------------------ | ------ | -------------------- | -------------------- | --------------------- |
| **Calendar**  |                                                        |        |                      |                      |                       |
| C1            | See every event                                        | ✓      | ✗                    | ✗                    | Free                  |
| C2            | See shared events                                      | ✓      | ✓                    | ✓                    | Premium (seats)       |
| C3            | Create events                                          | ✓      | ✓ (shared, PROPOSED) | ✓ (shared, PROPOSED) | Free                  |
| C4            | Edit or delete any event; share or unshare             | ✓      | ✗                    | ✗                    | Free                  |
| C5            | Edit or delete events they created                     | ✓      | ✓                    | ✓                    | Free                  |
| C6            | Set "taking" to themself on a shared event             | ✓      | ✓                    | ✓                    | Free                  |
| C7            | Copy events to their device calendar; share busy times | ✓      | ✓ (shared events)    | ✓ (shared events)    | Free                  |
| C8            | Mark a day busy or not busy                            | ✓      | ✓                    | ✗                    | Free                  |
| C9            | See busy blocks                                        | ✓      | ✗                    | ✗                    | Free                  |
| **Documents** |                                                        |        |                      |                      |                       |
| V1            | Add, edit or delete documents                          | ✓      | ✗                    | ✗                    | Free up to the limit  |
| V2            | See every document                                     | ✓      | ✗                    | ✗                    | Free                  |
| V3            | See documents shared with them                         | ✓      | ✓                    | ✓                    | Premium               |
| V4            | Share or unshare a document with a named member        | ✓      | ✗                    | ✗                    | Premium               |
| V5            | Attach or detach documents on an event                 | ✓      | ✗                    | ✗                    | Free                  |
| V6            | Save a copy or send a document out of the app          | ✓      | ✗ (PROPOSED)         | ✗ (PROPOSED)         | Free, always (export) |

Rules:

- **R2-ACC-1:** An attachment never widens access. A family member or caregiver sees an event's attachment only if that document is shared with them too.
- **R2-ACC-2:** Removing a member, a lapse, or unsharing removes access within 60 seconds of the change reaching the server (NFR-PERF-3), including from the member's device copy (architecture section 5).

## 3. Functional requirements

Analytics and offline conventions are spec.md section 3.0. Event properties never carry titles, notes, places, file names, categories of a named person's document, or children's details.

### 3.1 Shared calendar (CAL)

**User stories**

- As a parent, I want one calendar my partner and I both see, so that nobody has to forward appointment texts.
- As a parent, I want to add an appointment in a few taps with one hand, so that I can do it while holding the baby.

**Requirements**

- **FR2-CAL-1:** A new Calendar tab sits second in the tab bar: Plan, Calendar, List, Recipes, Household (PROPOSED). It opens on today in an agenda view (S-36), with a day and week switch. The week starts on the household's week-start day.
- **FR2-CAL-2:** Adding an event (S-37) needs only a title and a start. Defaults: kind `kind.appointment`, a 1-hour length, today at the next whole hour, and shared with family and caregivers when its kind is `kind.childcare` (PROPOSED). Optional fields: end, all-day, kind, for (people), taking member, place (free text, never geocoded), notes, repeat and reminders.
- **FR2-CAL-3:** Times are stored as instants and shown in the household's timezone. All-day events store dates in the household's timezone, like plan entries, so a timezone change never moves them (R2-CAL-1).
- **FR2-CAL-4:** Repeats follow the rule in the glossary. Editing a repeating event asks "this event" or "all events". Changing one occurrence stores an exception; deleting one skips it. "This and following" is out of scope (PROPOSED).
- **FR2-CAL-5:** Each calendar day shows the household's planned meals for that day as one compact row (from Phase 1's plan, read only). Tapping it opens the Plan tab on that day. Meals are never copied into device calendars unless the member turns that on (FR2-DEV-3).
- **FR2-CAL-6:** The calendar works fully offline (vision "Offline and sync") through the Phase 1 sync layer, and a partner's change appears within 2 seconds when both are online (NFR-PERF-3).
- **FR2-CAL-7:** Event detail (S-38) shows the kind, time, for, taking, place, notes, reminders, attachments and who last changed it. Parents can share or unshare from here.
- **FR2-CAL-8:** Deleting an event has a 5-second undo (NFR-REL-5). Deleting a repeating series asks for confirmation.

**Acceptance criteria**

- **Partner sees an appointment:**
  - **Given** two parents online
  - **When** parent A adds "pediatrician, Tuesday 10:00" for the baby
  - **Then** parent B's Calendar shows it within 2 seconds, and `event_created` is recorded with `kind=appointment`, `has_people=true`.
- **Offline add:**
  - **Given** a parent in airplane mode
  - **When** they add an event and reconnect later
  - **Then** the event syncs once, with no duplicate on either device.
- **Repeat exception:**
  - **Given** a weekly "daycare pickup" on Mondays
  - **When** a parent moves next Monday's to 17:30 with "this event"
  - **Then** only that Monday changes.

**Edge cases**

- **Daylight-saving change:** a 10:00 weekly event stays at 10:00 local time in the household's timezone.
- **Overlaps** are allowed and shown side by side in the day view.
- **A person removed from the household** disappears from "for" on past and future events. The events stay.
- **A taking member who leaves** is cleared to "nobody yet", and parents get an inbox entry for upcoming events (PROPOSED).

**Analytics events**

| Event             | Properties                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| `calendar_viewed` | `view` (`agenda`, `day` or `week`)                                              |
| `event_created`   | `kind`, `all_day`, `repeats`, `has_people`, `has_taking`, `shared`, `reminders` |
| `event_updated`   | `kind`, `scope` (`one` or `all`)                                                |
| `event_deleted`   | `kind`, `scope`                                                                 |
| `event_shared`    | `shared`                                                                        |

### 3.2 Reminders and calendar notifications (REM)

- **FR2-REM-1:** Every event can have reminders: at the time, 15 minutes, 1 hour, 1 day or 2 days before (PROPOSED). New appointments default to 1 day before. Free households get 1 reminder per event; Premium gets up to 5 (D-15).
- **FR2-REM-2:** Reminders are local notifications on each device of each member who can see the event and has calendar reminders on (a new per-type switch on S-29). They work offline and respect quiet hours, moving to the end of quiet hours except for "at the time" reminders, which always fire (PROPOSED).
- **FR2-REM-3:** Notification text names the kind, time and taking member only. The title, place, notes and people appear only if the member turns on "show event details in notifications" on that device (off by default, PROPOSED). Health-related details never appear in server-sent notifications (NFR-SEC-5).
- **FR2-REM-4:** **Change notifications (Premium):** when another member creates, moves or cancels an event in the next 14 days that the recipient can see, the recipient gets an inbox entry and a push, at most 1 an hour per event (PROPOSED). The payload carries IDs and fixed values only.
- **FR2-REM-5:** The day before an appointment with no taking member, the household's parents get a "who's taking?" prompt at 18:00 household time (PROPOSED). Free.
- **FR2-REM-6:** On a lapse, the first reminder of each event keeps working, the others pause (kept, not deleted), and change notifications stop.

**Analytics events:** `event_reminder_set` (`offset_minutes`, `count`), `who_taking_prompt_answered` (`answered_from` `push` or `inbox`).

### 3.3 Device calendars (DEV)

Decided in D-14: one-way copy through the phone's own calendars, plus optional busy times. No server connection to Google or Apple.

- **FR2-DEV-1:** Device calendar features are off until a member turns them on in Calendar settings (S-39). Turning one on asks for the operating system's calendar permission, after a sheet that explains why. Declining leaves the app working with no device features.
- **FR2-DEV-2:** **Copy to my calendar:** events the member can see are copied into a target calendar on their device: a new "Parent Manager" calendar (the default) or an existing writable calendar they pick, such as their Google account calendar so it reaches Google Calendar on the web. Edits and deletions in the app update or remove the copies the next time the app runs. Edits made to the copies in another calendar app are not read back, and the next sync overwrites them.
- **FR2-DEV-3:** The copy carries the title, time, place and the kind's name. Notes, people and attachments stay in the app, and each copy links back to the event (PROPOSED). Planned dinners are copied only if the member turns on "include meals" (default off).
- **FR2-DEV-4:** **Share my busy times:** a member picks any of their device calendars. For the next 14 days (PROPOSED), the app turns each timed event into a busy block (start, end) and syncs it to the household. Titles, places, notes, attendees and all-day events are never read into the app's data (R2-BUSY-3). Events the app copied itself are skipped.
- **FR2-DEV-5:** Busy blocks refresh when the app opens or returns to the foreground, at most every 15 minutes. Turning the feature off, signing out, leaving or removal deletes that member's busy blocks from the server at once.
- **FR2-DEV-6:** Busy blocks are visible to parents only (table C9), as unnamed blocks labelled with the member's name. They count toward busy days.

**Acceptance criteria**

- **Copy:** **Given** "copy to my calendar" is on, **when** a partner moves an appointment, **then** the copy in the phone's calendar moves the next time this member opens the app.
- **No titles:** **Given** a member shares busy times from a calendar with "Therapy 15:00–16:00", **when** the busy block syncs, **then** the server row holds only the member, start and end, and a database test proves the table has no text columns.

**Analytics events:** `device_calendar_copy_changed` (`enabled`, `target` `new` or `existing`), `busy_times_changed` (`enabled`, `calendars_count`), `calendar_permission_result` (`granted`).

### 3.4 Busy days and the meal plan (BUSY)

Decided in D-18, with the tiers from D-15: detecting, marking and showing busy days is free; easy-meal suggestions are Premium, as the vision's free and Premium table says. This is the module link the Phase 2 "done when" measures.

- **FR2-BUSY-1:** The Plan tab marks each busy day of the week (R2-BUSY-1) on its day header with an icon and a reason ("appointments after 4pm", "6 hours booked", "marked busy"), never by color alone.
- **FR2-BUSY-2:** On a busy day, if dinner is empty the day offers "add an easy dinner"; if dinner is a recipe that isn't an easy meal and takes over 30 minutes, it offers "swap for an easy meal". The sheet lists up to 5 easy meals: leftovers candidates first (Phase 1 leftover links), then household recipes, then starter recipes, avoiding recipes in the last 7 days (PROPOSED). One tap applies, with a 5-second undo. Suggestions are Premium (FR2-BUSY-5).
- **FR2-BUSY-3:** The app never changes the plan without a tap. Dismissing a suggestion hides it for that day.
- **FR2-BUSY-4:** Parents and family members can mark a day "busy" or "not busy" from the Plan or Calendar tab, which overrides the rule for that day.
- **FR2-BUSY-5:** **Tiers (D-15):** busy-day detection, the marker and reason, and manual marking are free. Easy-meal suggestions (FR2-BUSY-2) are Premium. On a free household, a busy day with an empty or hard dinner shows one "easy dinner ideas" action that opens the Premium sheet (trigger `busy_day_meals`, FR-PAY-4), shown at most once per week per member (PROPOSED). On a lapse, suggestions stop and the markers stay. Both work offline from the synced events and busy blocks.
- **FR2-BUSY-6:** Allergy notices on suggested recipes follow Phase 1 (AI-11, AI-12).

**Acceptance criteria**

- **Busy day changes the plan:**
  - **Given** a Premium household with a 16:30 appointment on Wednesday and an empty Wednesday dinner
  - **When** a parent opens the Plan tab
  - **Then** Wednesday shows the busy marker and "add an easy dinner", and one tap adds a `tag.quick` recipe, recording `busy_day_suggestion_applied`.
- **Free household at the moment of need:**
  - **Given** a free household with the same Wednesday
  - **When** a parent opens the Plan tab
  - **Then** Wednesday shows the busy marker and reason, and "easy dinner ideas" opens the Premium sheet naming busy-day meal suggestions first, recording `paywall_viewed` with `trigger=busy_day_meals`.

**Analytics events:** `busy_day_shown` (`reason`), `busy_day_suggestion_shown` (`mode` `add` or `swap`, `candidates_count`), `busy_day_suggestion_applied` (`mode`, `source` `leftovers`, `household` or `starter`), `busy_day_overridden` (`busy`).

### 3.5 Document vault (DOC)

Decided in D-17 (storage) and D-19 (children's records: files only, no structured medical fields).

**User stories**

- As a parent, I want the insurance card on my phone and my partner's, so that we never dig through photos at the front desk.
- As a parent, I want the vault locked even when my phone is unlocked, so that someone holding it can't see our birth certificates.

**Requirements**

- **FR2-DOC-1:** The vault (S-40) is reached from the Household tab and from an appointment's attachments. It lists documents by category, with title, person tag and expiry, and works offline as a list. Opening a file needs a connection.
- **FR2-DOC-2:** **Adding (S-41):** scan with the camera (edge detection and multiple pages where the device supports it, architecture section 3.5), take a photo, or pick a PDF or image. Accepted types: PDF, JPEG, PNG and HEIC, converted to JPEG on the device. At most 10 MB per file and 20 pages per scan (PROPOSED). The parent sets a title (required), category (required), person tag and expiry date (optional).
- **FR2-DOC-3:** **Vault lock:** opening the vault needs a biometric or device-passcode check, on by default on every device, and again after 1 minute in the background (PROPOSED). A member can turn it off on their device after a check. A device with no passcode can't open the vault (PROPOSED).
- **FR2-DOC-4:** **Viewing (S-42):** pages and images open in the app from short-lived links (R2-DOC-2). Files aren't saved on the device, except in a temporary cache removed when the viewer closes. Screenshots and screen recording are blocked on vault screens, and the app switcher shows no content (architecture section 3.5).
- **FR2-DOC-5:** **Attach to appointments:** from event detail, a parent attaches existing documents or adds a new one. The event shows the attachments, and the document shows its events.
- **FR2-DOC-6:** **Sharing (Premium):** a parent shares a document with named family members or caregivers, and can unshare. Sharing an event that has attachments offers to share those documents too, unticked by default (PROPOSED).
- **FR2-DOC-7:** **Expiry reminders (Premium):** parents get an inbox entry and push 30 days and 7 days before a document's expiry date (PROPOSED), with the category name and date only.
- **FR2-DOC-8:** **Limits (D-15):** Free holds up to 25 documents. Premium holds up to 2 GB per household. Both are server settings. At the limit the add action opens the Premium sheet (FR-PAY-4, new trigger `documents`). On a lapse, nothing is deleted: every document stays viewable and exportable, adding is blocked above 25, shares pause and expiry reminders stop.
- **FR2-DOC-9:** **Save or send out:** parents can save a copy or share a document through the share sheet. It's always free (exit features).
- **FR2-DOC-10:** **Deleting** a document asks for confirmation, removes it from every event and share, and is undoable for 5 seconds. The file leaves storage within 24 hours (R2-DOC-4).
- **FR2-DOC-11:** No text in documents is read, extracted or sent anywhere. Category `doc.medical` is allowed, and its existence never reaches analytics, crash reports or server notifications.

**Acceptance criteria**

- **Attach and open:**
  - **Given** a parent with the insurance card in the vault
  - **When** they attach it to Tuesday's pediatrician appointment
  - **Then** their partner sees the attachment on the event, opens it after the vault lock, and `document_attached` is recorded with no category.
- **Caregiver isolation:**
  - **Given** a Premium household with a caregiver and two documents, one shared with the caregiver
  - **When** the caregiver opens the vault
  - **Then** they see only the shared document, and a request for the other's storage path is refused.
- **Free limit:** **Given** a free household with 25 documents, **when** a parent adds another, **then** the Premium sheet opens naming document storage, and the server refuses a direct insert.

**Edge cases**

- **Offline:** adding is queued only as a draft on the device and uploads when online; the vault shows "waiting to upload" (PROPOSED). Viewing shows the offline message.
- **Upload fails halfway:** no document row is created until the file is stored (architecture section 3.5).
- **Scanner unavailable on the device:** the camera and file picker remain.

**Analytics events:** `vault_opened` (`unlocked_with` `biometric`, `passcode` or `none`), `document_added` (`source` `scan`, `photo` or `file`, `pages_count`, `size_bucket`), `document_viewed`, `document_attached`, `document_shared` (`shared`, `members_count`), `document_deleted`, `document_sent_out`.

### 3.6 Privacy, export and deletion (PRIV2)

- **FR2-PRIV-1:** Household data export (FR-PRIV-2) adds events, repeats and exceptions, reminders, busy-day overrides, document metadata, shares and attachments, and the document files in a `documents/` folder of the ZIP. Busy blocks are in the account export of the member they came from. Export stays free.
- **FR2-PRIV-2:** Household and account deletion (FR-PRIV-3, FR-PRIV-7) cover every Phase 2 table and every stored file. Files leave storage within 24 hours, and backups within the FR-PRIV-4 period.
- **FR2-PRIV-3:** Settings gain "Calendar" (device copy, busy times, notification details) and "Documents" (vault lock) sections on S-29 and S-31.
- **FR2-PRIV-4:** Signing out deletes the app's copies in the device calendar only if the member chooses to on a prompt (PROPOSED: kept by default, since they're the member's own calendar), and always stops busy-time sharing.

### 3.7 Free versus Premium in Phase 2 (PAY2)

Decided in D-15.

| Capability  | Free                                                                                  | Premium                                                  |
| ----------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Calendar    | Shared calendar, appointments, repeats, 1 reminder per event, device copy, busy times | Up to 5 reminders per event, change notifications        |
| Busy days   | Busy-day detection, markers and reasons, and manual marking                           | Easy-meal suggestions on busy days                       |
| Sharing     | Two parents see everything                                                            | Family and caregivers see shared events and documents    |
| Documents   | Up to 25, with scanning, vault lock, attachments and send out                         | Up to 2 GB, expiry reminders, sharing with named members |
| Always free | Export and deletion of all Phase 2 data, vault lock, privacy settings                 |                                                          |

- **FR2-PAY-1:** New Premium sheet triggers: `reminders`, `busy_day_meals`, `documents` (limit), `document_share` and `caregiver_calendar` (sharing with a household that has no seats).
- **FR2-PAY-2:** Every limit is enforced on the server as well as in the app (architecture section 4). The one exception is busy-day suggestions: they're worked out on the device and write ordinary plan entries that any member may add by hand, so the app gates them by the household's synced entitlement, and the server has nothing to refuse.

## 4. Screens

| ID   | Screen               | Purpose                                              | Navigation                   |
| ---- | -------------------- | ---------------------------------------------------- | ---------------------------- |
| S-36 | Calendar             | Agenda, day and week views with meals per day        | Tab; to S-37, S-38           |
| S-37 | Event editor (sheet) | Add or edit an event, repeats and reminders          | From S-36, S-38              |
| S-38 | Event detail         | Details, taking, attachments, share                  | To S-37, S-42, S-41          |
| S-39 | Calendar settings    | Device copy, busy times, notification details        | Household tab, S-36          |
| S-40 | Vault                | Documents by category, behind the vault lock         | Household tab, S-38          |
| S-41 | Add document         | Scan, photo or file; title, category, person, expiry | From S-40, S-38              |
| S-42 | Document viewer      | Pages, details, events, share, send out, delete      | From S-40, S-38              |
| S-43 | Easy dinner sheet    | Busy-day suggestions                                 | From the Plan tab's busy day |

Flows to cover with Maestro: add an appointment and see it on the partner's device (two-device harness), attach a document and open it, apply a busy-day suggestion.

## 5. Data and business rules

- **R2-CAL-1:** A timed event stores `starts_at` and `ends_at` as instants. An all-day event stores `start_date` and `end_date` (inclusive) in the household's timezone. Occurrences of repeats are expanded on the device for the visible range, never stored, except exceptions.
- **R2-CAL-2:** An occurrence is identified by its series ID and original start, so an exception made offline on two devices merges into one.
- **R2-BUSY-1:** **Busy-day rule** (PROPOSED numbers, server settings): a day is busy if, in the household's timezone, either (a) any timed event or busy block of a parent overlaps the dinner window, 16:00 to 19:00, or (b) the union of timed events and parents' busy blocks between 07:00 and 21:00 covers 3 hours or more. A manual mark overrides both. All-day events never count.
- **R2-BUSY-2:** A busy day's events count whether or not they're shared, but a family member or caregiver sees only the marker and reason, never the hidden events behind it. Parents' devices publish each day's result for today and the next 13 days (PROPOSED): the date, busy or not, and the reason, nothing else. Members' devices show markers from it, with their household's own marks applied at once (D-22).
- **R2-BUSY-3:** A busy block holds only the member, start and end. The app reads device events in memory to make blocks and keeps nothing else.
- **R2-DOC-1:** Files live in a private storage bucket under `<household_id>/<document_id>/`, encrypted at rest by the host (D-17). They're never public.
- **R2-DOC-2:** Viewing uses signed links that expire after 60 seconds (PROPOSED), issued only to members who may see the document.
- **R2-DOC-3:** A document row has a person tag at most once, and no free-text field except the title. The title is the parent's choice; the editor hints not to put medical details in it (copy, PROPOSED).
- **R2-DOC-4:** A deleted document's files are purged from storage within 24 hours. A deleted household's files likewise.
- **R2-PAY-1:** Limits and windows in this spec (reminders, 25 documents, 2 GB, 14-day busy window, busy thresholds) are server settings, tuned without a release.

## 6. Non-functional requirements

Phase 1's NFRs apply to every Phase 2 screen and table. Additions:

- **NFR2-PERF-1:** The Calendar tab shows the agenda within 500 ms (p75) from the local copy, with 2 years of events and 20 repeating series (PROPOSED).
- **NFR2-PERF-2:** A 2 MB document opens within 3 seconds (p95) on 4G.
- **NFR2-PERF-3:** Busy-day evaluation for a week finishes within 50 ms on the mid-range Android device.
- **NFR2-OFF-1:** Events, repeats, reminders, busy blocks, busy-day overrides and document metadata work offline. Document files, sharing and adding a document need a connection (NFR-OFF-2 applies).
- **NFR2-OFF-2:** A member who loses access to an event or document (unshare, removal, lapse) loses it from their device on the next sync, and the two-device harness proves it.
- **NFR2-SEC-1:** Every new table has `household_id`, RLS and pgTAP tests proving another household, and a family member or caregiver without a share, can't read or write it. Storage policies get the same tests.
- **NFR2-SEC-2:** No document file, page image or text reaches analytics, Sentry, logs, AI or notifications. Sentry drops breadcrumbs from vault screens.
- **NFR2-SEC-3:** The vault lock, screen-capture blocking and the temporary cache rules (FR2-DOC-3, FR2-DOC-4) are covered by component tests and the security review.
- **NFR2-SEC-4:** **Security review (D-20):** before Phase 2 reaches beta, a review covers a written threat model, RLS and storage policies, signed links, the device copy and caches, the vault lock, device calendar handling, and dependencies, against OWASP MASVS L1 (PROPOSED). Every high or critical finding is fixed before release.
- **NFR2-SEC-5:** Device calendar permission is asked only when a member turns on a device feature, never at launch.
- **NFR2-A11Y-1:** Calendar views are usable with VoiceOver and TalkBack (each event announces kind, time, title and taking member), at the largest text size (the week view falls back to the agenda), and one-handed (add is bottom-reachable).
- **NFR2-L10N-1:** Dates, times, weekday names, 12 or 24 hour clocks and durations come from the `Intl` helpers in the household's locale. Kinds, categories and repeat rules are stored as identifiers.

## 7. Release and quality

### 7.1 Phase 2 definition of done

1. Every Phase 2 backlog item is merged, and every `FR2-` is covered by a test or manual case.
2. **Busy days visibly change the plan:** in beta, at least half of households with a busy day in a week see the marker, and at least 1 in 5 Premium or trial households that see one apply a suggestion (PROPOSED).
3. **Documents attach to appointments:** the attach-and-open flow passes in Maestro on both platforms, and caregiver isolation passes in pgTAP.
4. **A security review is passed** (NFR2-SEC-4), with its report kept with the release notes.
5. Store privacy answers and the data inventory are updated for calendar and document data (vision launch gates).

### 7.2 Beta

Phase 2 goes to Phase 1's beta households first, behind a feature flag, for 3 weeks (PROPOSED), with at least 5 Premium households with a caregiver.

## 8. Assumptions, open questions and conflicts

### 8.1 Assumptions

| ID    | Assumption                                                                                                                     | If wrong                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| AS2-1 | Full calendar access on iOS is acceptable to parents, since write-only access can't create our calendar or read busy times.    | Offer a write-only mode that copies to the default calendar without updates. |
| AS2-2 | A suitable document scanner and PDF viewer exist for Expo (spike V-01).                                                        | Photo and file only, and PDFs open through the share sheet.                  |
| AS2-3 | Document files and calendar data are health-related data under US state laws when they concern appointments or medical papers. | Legal review (D-11) may add consent steps.                                   |

### 8.2 Open questions

Open decisions are D-20 (security reviewer and budget) and D-21 (storage plan for documents) in decisions-needed.md. Every PROPOSED value above is the product owner's to confirm.

### 8.3 Conflicts with other docs

- **C2-1, document storage limit.** The vision says "a handful of documents" free and "large storage" Premium. D-15 sets 25 and 2 GB. No vision change needed.
- **C2-2, Phase 1 spec section 1.5** lists Documents and Records and Shared Calendar as separate later modules. They're one phase now (PR #232); this spec covers both.
