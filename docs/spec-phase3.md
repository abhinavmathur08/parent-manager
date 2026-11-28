# Parent Manager: Phase 3 product specification

Status: approved for building, 2026-11-27. Phase 3 is **Tasks and Chores**. Building starts now: the product owner decided on 2026-11-27 that Phases 1 to 3 launch together in one first beta (vision, Roadmap).

How this relates to the other docs:

- [vision.md](vision.md) is the source of truth. This spec implements its sections "Tasks and Chores", "How the modules connect" (anything to tasks), the free and Premium table, and the Phase 3 row of "Roadmap and MVP scope".
- [spec.md](spec.md) and [spec-phase2.md](spec-phase2.md) still hold: roles, seats, sync, notifications, quiet hours, export, deletion, the paywall rules and every non-functional requirement. This spec only adds to them.
- [backlog-phase3.md](backlog-phase3.md) breaks it into items. Architecture for Phase 3 is written in [architecture.md](architecture.md) by the first backlog item (T-01.1), not in this draft.

**How to read this spec:**

- Requirements are numbered `FR3-<area>-<n>` (functional), `NFR3-<area>-<n>` (non-functional) and `R3-<area>-<n>` (data and business rules), apart from Phase 1's and Phase 2's IDs. Phase 3 uses no AI, so there are no `AI3-` requirements.
- **PROPOSED**, **ASSUMPTION** and user-facing text work as in spec.md: copy is named by purpose and lives in the locale files.
- Decision IDs `D-24` to `D-30` are in [decisions-needed.md](decisions-needed.md). All seven were decided on 2026-11-27. Screen IDs continue from spec-phase2.md (`S-44` onwards).

## 1. Overview and scope

### 1.1 What Phase 3 delivers

Phase 3 gives the two partners one shared to-do list for the household, so the unspoken work becomes visible and split. Tasks can be assigned, dated, repeated as chores, started from stage-based checklists, and made from anything else in the app: a meal, a list item, an appointment or a document.

**Done when** partners use tasks weekly without leaving the app for a second tool (vision roadmap, Phase 3). Section 7.1 makes this measurable.

### 1.2 In scope

1. **Tasks:** a title, an optional due date and time, an assignee (a parent, a helper, or anyone), notes, one reminder, and done or not done. Offline and shared in real time.
2. **Recurring chores (D-24):** tasks that repeat on a schedule or a set number of days after they were last done. Free households get up to 3; Premium gets unlimited chores and rotation between members (D-26).
3. **Starter checklists (D-27):** ready-made lists for expecting and newborn households, chosen by the household's stage (D-6), shipped as language-neutral template IDs with translated text.
4. **Tasks from other modules:** "make a task" from a plan entry, a grocery item, a calendar event (including its preparation notes) and a document's expiry.
5. **Who's carrying what:** a neutral view of open and done tasks per member, with trends on Premium.
6. **Helpers (D-25):** family members and caregivers see and do only tasks assigned or shared to them, consistent with D-16.
7. **Free and Premium (D-24),** with export, deletion and privacy controls always free.

### 1.3 Out of scope for Phase 3

- Points, rewards, streaks, leaderboards or any scoring of members (D-28).
- Home-screen and lock-screen widgets, and Siri and Google Assistant shortcuts (D-30, conflict C3-1). Keyboard dictation in the title field works as in any text field.
- AI anywhere in tasks: no natural-language dates, no suggested tasks, no reading of notes.
- Subtasks, priorities, labels, comments and attachments on tasks.
- A person tag ("for the baby") on tasks, and any health field (data minimisation, R3-TASK-3).
- Automatic tasks created without a tap, such as a renewal task for every expiring document (PROPOSED for later, Premium).
- Checklists for stages after 0 to 6 months (6 to 12 months, toddler, preschool): later content releases.
- Copying tasks into Apple Reminders or another to-do app. Exit is through data export (FR3-PRIV-1).

### 1.4 Glossary

| Term             | Meaning                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task             | One thing to do, with a title, an optional due date or time, an optional assignee and a done state.                                                               |
| Chore            | A task with a repeat rule. Each occurrence is done, skipped or open on its own.                                                                                   |
| Occurrence       | One due date of a chore, identified by the chore and its original date (R3-CHORE-2).                                                                              |
| Assignee         | The member a task or occurrence is assigned to, or nobody ("anyone").                                                                                             |
| Helper           | A family member or caregiver: the Premium seats of spec.md section 2.1.                                                                                           |
| Shared task      | A task visible to every helper in the household, such as "anyone can help". Parents always see every task.                                                        |
| Rotation         | An ordered list of members a chore's occurrences are assigned to in turn (D-26).                                                                                  |
| Starter template | A checklist shipped with the app, such as `checklist.newborn.first_weeks`, whose items are template item IDs with translated text.                                |
| Checklist        | A household's started copy of a starter template or a saved template: a group of tasks with progress.                                                             |
| Saved template   | A household's own checklist saved for reuse (Premium).                                                                                                            |
| Source           | The item a task was made from: a plan entry, grocery item, event, document or checklist.                                                                          |
| Stage            | The household's youngest age band or expecting status from onboarding (D-6): `expecting`, `infant_0_6m`, `infant_6_12m`, `toddler`, `preschool` or `older_child`. |

## 2. Roles and permissions

Phase 1's roles and seat rules stand. Helpers are Premium seats and lose access when Premium lapses (FR-PAY-9). Following D-16 and D-25, helpers see only tasks assigned to them, shared with helpers, or in a rotation they're part of.

| #              | Action                                                      | Parent | Family member    | Caregiver        | Tier            |
| -------------- | ----------------------------------------------------------- | ------ | ---------------- | ---------------- | --------------- |
| **Tasks**      |                                                             |        |                  |                  |                 |
| T1             | See every task                                              | ✓      | ✗                | ✗                | Free            |
| T2             | See tasks assigned to them, shared, or in their rotation    | ✓      | ✓                | ✓                | Premium (seats) |
| T3             | Create tasks                                                | ✓      | ✓ (shared, D-25) | ✓ (shared, D-25) | Free            |
| T4             | Assign to a parent, to themself or to anyone                | ✓      | ✓ (D-25)         | ✓ (D-25)         | Free            |
| T5             | Assign to a helper, or share with helpers                   | ✓      | ✗                | ✗                | Premium         |
| T6             | Complete, reopen or take ("I'll do it") a task they can see | ✓      | ✓                | ✓                | Free            |
| T7             | Edit or delete any task                                     | ✓      | ✗                | ✗                | Free            |
| T8             | Edit or delete tasks they created                           | ✓      | ✓                | ✓                | Free            |
| **Chores**     |                                                             |        |                  |                  |                 |
| T9             | Create or edit a recurring chore                            | ✓      | ✗                | ✗                | Free up to 3    |
| T10            | Skip or reassign one occurrence they can see                | ✓      | ✓ (their own)    | ✓ (their own)    | Free            |
| T10a           | Set a chore's rotation                                      | ✓      | ✗                | ✗                | Premium         |
| **Checklists** |                                                             |        |                  |                  |                 |
| T11            | Start a starter checklist                                   | ✓      | ✗ (PROPOSED)     | ✗                | Free            |
| T12            | Save or apply a saved template                              | ✓      | ✗                | ✗                | Premium         |
| **Insights**   |                                                             |        |                  |                  |                 |
| T13            | See who's carrying what (this week and last)                | ✓      | ✗                | ✗                | Free            |
| T14            | See trends over time                                        | ✓      | ✗                | ✗                | Premium         |
| **Sources**    |                                                             |        |                  |                  |                 |
| T15            | Make a task from a plan entry or grocery item               | ✓      | ✓                | ✓                | Free            |
| T16            | Make a task from an event they can see                      | ✓      | ✓                | ✓                | Free            |
| T17            | Make a task from a document                                 | ✓      | ✗                | ✗                | Free            |

Rules:

- **R3-ACC-1:** A helper sees a task only if it's assigned to them, it's shared, or they're in its rotation. A task a helper creates is always shared, so parents and the other helpers see it. Decided reading (2026-11-28): a helper can hand back (unassign, or assign to a parent) only a **shared** task assigned to them. A private one would disappear from their device mid-write, so they can complete it but not hand it back.
- **R3-ACC-2:** A source link never widens access. A task made from an event or document shows its source only to members who can see that event or document; others see only "from the calendar" or "from the vault", with no title (R2-ACC-1).
- **R3-ACC-3:** Removing a member, a lapse, or unsharing removes access within 60 seconds of the change reaching the server, including from the helper's device (R2-ACC-2, architecture section 5, per-row visibility).

## 3. Functional requirements

Analytics and offline conventions are spec.md section 3.0. Event properties never carry task titles, notes, source titles, template item IDs, checklist names or the household's stage.

### 3.1 Tasks (TASK)

**User stories**

- As a parent, I want one list my partner and I both see, so that nothing lives only in one person's head.
- As a parent, I want to add a task in two taps with one hand, so that I can capture it before the baby wakes.
- As a parent, I want to hand a task to my partner without a conversation, so that the work is split without another negotiation.

**Requirements**

- **FR3-TASK-1:** A Tasks tab (S-44) holds the household's tasks, in the Recipes tab's former slot (D-29): the tabs are Plan, Calendar, List, Tasks and Household. Recipes moves to a button in the Plan tab's header, and stays in the add-to-slot sheet (S-11). It groups open tasks as Overdue, Today, Upcoming (next 14 days, by day) and Anytime (no due date), with Done collapsed at the end. A filter switches between Mine, Everyone, and each member (PROPOSED). Decided readings (2026-11-28): tasks due after the Upcoming range show in a **Later** group, by date, after Upcoming, so none is hidden; and S-11 keeps searching and planning every household and starter recipe but has no link to the Recipes library, which opens from the Plan tab's header.
- **FR3-TASK-2:** Adding a task (S-45) needs only a title. The add action is bottom-reachable, and the sheet opens with the keyboard up and the title focused. Defaults: no due date, assigned to the member adding it if a helper, otherwise to anyone (PROPOSED). Optional fields: due date, due time, assignee, reminder, notes, repeat (Premium) and "share with helpers" (Premium). Decided reading (2026-11-28): on a Free household, "share with helpers" is hidden from parents until M-05 adds the `helper_tasks` Premium sheet; it then opens that sheet instead.
- **FR3-TASK-3:** A due date alone is stored as a date in the household's timezone, like all-day events, so a timezone change never moves it. A due date with a time is stored as an instant and shown in the household's timezone (R3-TASK-1).
- **FR3-TASK-4:** One tap on a task's checkbox completes it, with a 5-second undo, and moves it to Done. Done tasks record who completed them and when. Reopening is possible from Done.
- **FR3-TASK-5:** Assigning is one tap from the task row's member chip or task detail (S-46). A shared task with no assignee shows "I'll do it" to every member who can see it, which assigns it to them.
- **FR3-TASK-6:** Tasks work fully offline through the Phase 1 sync layer, and a partner's change appears within 2 seconds when both are online (NFR-PERF-3).
- **FR3-TASK-7:** Task detail (S-46) shows the title, due, assignee, reminder, notes, repeat and rotation, its source (FR3-LINK-5), and who created, last changed and completed it.
- **FR3-TASK-8:** Deleting a task has a 5-second undo (NFR-REL-5). Deleting a chore asks "this occurrence" (skip it) or "the whole chore".
- **FR3-TASK-9:** Done tasks stay visible in Done for the free history window, the current week and the last 4 weeks (D-9, applied to tasks by D-24). Premium shows all.

**Acceptance criteria**

- **Partner sees an assigned task:**
  - **Given** two parents online
  - **When** parent A adds "book the car service" assigned to parent B, due Friday
  - **Then** parent B's Tasks tab shows it under Upcoming within 2 seconds, and `task_created` is recorded with `assignee_role=parent`, `has_due=true`, `source=manual`.
- **Offline completion by both:**
  - **Given** both parents offline with the same open task
  - **When** each completes it and they reconnect in either order
  - **Then** the task is done once on both devices, with the earlier completion's member and time, and a stale reopen from a device that hadn't seen the completion doesn't undo it.
- **Two-tap add:** **Given** the Tasks tab, **when** a parent taps add, types a title and taps save, **then** the task exists, in 2 taps plus typing.

**Edge cases**

- **An assignee who leaves or is removed:** their open tasks become unassigned, and parents get one inbox entry listing the count (PROPOSED). Done tasks keep "former member" (FR-PRIV-3).
- **A due date in the past** is allowed and shows as overdue.
- **Daylight-saving change:** a task due at 18:00 stays at 18:00 local time in the household's timezone.

**Analytics events**

| Event            | Properties                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `tasks_viewed`   | `filter` (`mine`, `everyone` or `member`)                                                                                |
| `task_created`   | `source`, `has_due`, `has_time`, `assignee_role` (`none`, `self`, `parent` or `helper`), `shared`, `repeats`, `reminder` |
| `task_completed` | `source`, `was_overdue`, `by_assignee`, `recurring`                                                                      |
| `task_reopened`  | `recurring`                                                                                                              |
| `task_assigned`  | `assignee_role`, `via` (`chip`, `detail` or `take`)                                                                      |
| `task_deleted`   | `recurring`, `scope` (`one` or `all`)                                                                                    |

### 3.2 Recurring chores and rotation (CHORE)

Decided in D-24: Free households get up to 3 recurring chores, and Premium gets unlimited chores and rotation (vision free and Premium table). Rotation follows D-26.

- **FR3-CHORE-1:** A task becomes a chore by setting a repeat (S-45). Two modes: **on a schedule**, using the calendar's repeat rule (daily, weekly on chosen weekdays, every 2 weeks, monthly on the same date, ending never, on a date or after a count, FR2-CAL-4), or **after it's done**, every N days from the last completion (PROPOSED, N from 1 to 90).
- **FR3-CHORE-2:** The Tasks tab shows each chore's next open occurrence only, never a stack of missed ones. If an occurrence's date passes undone it shows once as overdue; completing or skipping it brings up the next (PROPOSED).
- **FR3-CHORE-3:** Each occurrence is completed or skipped on its own, recording who and when, and the chore's history shows them in task detail.
- **FR3-CHORE-4:** **Rotation (Premium; D-26):** a parent can pick an ordered list of 2 or more members (parents, and helpers on Premium) to take turns. Each new occurrence goes to the next member in the list after whoever did the last one. Reassigning one occurrence changes only that one. There's no automatic balancing.
- **FR3-CHORE-5:** Editing a chore asks "this occurrence" or "all future". Changing the rule keeps the history of done and skipped occurrences.
- **FR3-CHORE-6:** **Lapse:** the household's 3 earliest-created live chores (the free cap, R3-PAY-1) keep running with rotation stopped, each keeping its current assignee. Chores beyond the cap pause: the open occurrence stays as an ordinary task, no new occurrences appear, and nothing is deleted (vision paywall principle 7, as FR2-REM-6 keeps each event's first reminder). Deleting a running chore lets the earliest paused one resume. Premium returning resumes every chore from today, with rotation.
- **FR3-CHORE-7:** **Free cap:** a free household can have up to 3 live recurring chores, a server setting (`app_config`, default 3, can be 0) tuned without a release. Setting a repeat on a 4th opens the Premium sheet naming unlimited recurring chores (trigger `recurring_chore`), and the server refuses a direct insert or update past the cap. Paused chores don't count toward the cap.

**Acceptance criteria**

- **Rotation:**
  - **Given** a Premium household with "take out the bins" weekly on Tuesdays, rotating A then B
  - **When** A completes this Tuesday's
  - **Then** next Tuesday's shows assigned to B on both devices.
- **After done:** **Given** "descale the kettle" every 30 days after it's done, **when** it's done 5 days late, **then** the next is due 30 days after that completion.
- **Free cap:** **Given** a free household with 3 recurring chores, **when** a parent sets a repeat on another task, **then** the Premium sheet opens naming unlimited recurring chores, and a direct write of a 4th chore is refused by the server.
- **Lapse:** **Given** a Premium household with 5 chores, one rotating, **when** Premium lapses, **then** the 3 earliest-created keep producing occurrences with their current assignees, the other 2 pause with their open occurrence kept, and nothing is deleted.

**Analytics events:** `chore_created` (`mode` `schedule` or `after_done`, `rotation_count`), `chore_occurrence_skipped`, `chore_occurrence_reassigned`.

### 3.3 Starter checklists (CHK)

Content source and review follow D-27: Claude drafts the items, the product owner reviews them, and a qualified health reviewer in each market checks items that touch health services. Stages follow D-6.

**User stories**

- As an expecting parent, I want a ready list of what to sort before the birth, so that I don't have to research it at 2am.
- As a new parent, I want the first weeks' admin in one place, split between us, so that nothing like registering the birth slips.

**Requirements**

- **FR3-CHK-1:** Starter checklists (S-47) are offered by stage: `expecting` gets `checklist.expecting.prepare_home`, `checklist.expecting.hospital_bag` and `checklist.expecting.paperwork`; `infant_0_6m` gets `checklist.newborn.first_weeks` and `checklist.newborn.home_routines` (PROPOSED names and set). Every template is listed for browsing; the household's stage only picks what's suggested first.
- **FR3-CHK-2:** The empty Tasks tab, and the Tasks tab after the household's stage changes (an age band edited on S-28), suggest the matching checklists once each (PROPOSED). Dismissing hides the suggestion.
- **FR3-CHK-3:** Starting a checklist shows a preview of its items with every item ticked. The parent can untick items, then start. Each kept item becomes a task in the household, with the checklist as its source, unassigned and with a suggested due date (FR3-CHK-4).
- **FR3-CHK-4:** Suggested due dates are offsets from an anchor: for `expecting`, the first day of the due month (the only date stored, D-6), such as "8 weeks before"; for `infant_0_6m`, the day the checklist starts (no birth date is stored). Items with no sensible date stay Anytime (PROPOSED). Items flagged for health review never get a suggested date and always stay Anytime (decided 2026-11-27, FR3-CHK-8).
- **FR3-CHK-5:** Items are template item IDs, such as `checklist_item.newborn.add_baby_to_insurance`. Their text comes from the locale files in the household's locale, and an item only appears in the regions its template lists (R3-CHK-1). A started item keeps its ID until a member edits the title, which then stores the edited text.
- **FR3-CHK-6:** A checklist (S-48) shows its tasks grouped by due, and progress as "n of m done" in text and a ProgressBar. Its tasks also appear in the Tasks tab like any other.
- **FR3-CHK-7:** **Saved templates (Premium):** a parent can save a checklist, or any selection of tasks, as a household template with its titles and relative due offsets, and apply it later as a new checklist. Templates are hidden on a lapse and kept in export (FR-PAY-9).
- **FR3-CHK-8:** Checklist content is practical household logistics. It never gives medical advice (vision non-goals). Items that involve a health service say to book or check with the family's provider, and never state a clinical schedule. Items that touch a health service are flagged for health review and never get a suggested due date, since any date could read as a clinical schedule (decided 2026-11-27: the safe side of "no medical advice"; `pnpm run checklists:check` enforces it). Content is reviewed per D-27 before the beta; the health reviewers are still to be arranged.

**Acceptance criteria**

- **Start a newborn checklist:**
  - **Given** a US household whose youngest is 0 to 6 months
  - **When** a parent opens the empty Tasks tab, starts "first weeks" and unticks two items
  - **Then** the remaining items appear as unassigned tasks in US English, the partner sees them within 2 seconds, and `checklist_started` is recorded with `items_count` and `items_removed_count` only.
- **Region:** **Given** a GB household, **when** a parent previews "first weeks", **then** no US-only item appears and the text is in British English.

**Analytics events:** `checklist_suggested`, `checklist_started` (`items_count`, `items_removed_count`), `checklist_completed` (`items_count`), `task_template_saved` (`items_count`), `task_template_applied` (`items_count`). No template ID or stage, since expecting status is health-related data (AS3-3).

### 3.4 Tasks from other modules (LINK)

This is the vision's "anything to tasks" link for the modules that exist by Phase 3.

- **FR3-LINK-1:** A "make a task" action sits on plan entry detail (S-12), grocery item detail (S-15), event detail (S-38) and the document viewer (S-42). It opens the task editor (S-45) prefilled, linked to its source, and saving is one more tap.
- **FR3-LINK-2:** Prefills (PROPOSED):

  | Source       | Title                                        | Due                                    |
  | ------------ | -------------------------------------------- | -------------------------------------- |
  | Plan entry   | The meal's name                              | The entry's date                       |
  | Grocery item | The item's display line ("2 L milk")         | None                                   |
  | Event        | The prepare-for message with the event title | The day before the event               |
  | Document     | A generic renew-a-document message, no title | 30 days before the expiry date, if set |

- **FR3-LINK-3:** **From preparation notes:** event detail offers "make tasks from notes" when the notes have text. A sheet (S-50) lists each non-empty line as a ticked row; the parent unticks any and saves, and each kept line becomes a task due the day before the event, linked to it. Nothing is parsed beyond splitting lines.
- **FR3-LINK-4:** A task made from a document never copies the document's title or category into the task, since tasks sit outside the vault lock (security finding SR2-L4). Opening its source goes through the vault lock.
- **FR3-LINK-5:** Task detail shows the source as a chip ("from the plan", "from the list", "from the calendar", "from the vault", "from a checklist") that opens it, subject to R3-ACC-2. If the source is deleted, the chip says it's no longer available and the task stays.
- **FR3-LINK-6:** Completing a task never changes its source, and changing the source never changes the task, except that a source event's date change doesn't move the task (PROPOSED: the parent may want the prep done anyway).
- **FR3-LINK-7:** **Tasks on the calendar:** each day in the Calendar tab shows the number of tasks due that day that the member can see, as one compact row (like meals, FR2-CAL-5). Tapping opens the Tasks tab on that day. Tasks are never copied into device calendars.

**Acceptance criteria**

- **Appointment prep:**
  - **Given** a pediatrician appointment on Tuesday with notes "bring the red book" and "list questions"
  - **When** a parent chooses "make tasks from notes" and saves both lines
  - **Then** two tasks due Monday appear, each showing "from the calendar", and `task_created` is recorded twice with `source=event`.
- **Document isolation:** **Given** a task made from a passport document, **when** a caregiver who can see the task but not the document opens it, **then** the task shows "from the vault" with no title, and the chip doesn't open the document.

**Analytics events:** `task_created` with `source`, and `tasks_from_notes_created` (`lines_count`, `kept_count`).

### 3.5 Reminders and task notifications (NOT)

- **FR3-NOT-1:** A task with a due date can have one reminder: at the due time, at 09:00 on the due day, or 1 day before at 18:00 (PROPOSED). It's a local notification on the assignee's devices, or on every parent's devices when unassigned, and works offline. It respects quiet hours like event reminders (FR2-REM-2), and shares the 60-notification device budget (architecture section 9).
- **FR3-NOT-2:** Reminder text says a task is due and when. The title appears only if the member has turned on "show details in notifications" on that device, the Phase 2 setting widened to cover tasks (off by default, PROPOSED).
- **FR3-NOT-3:** **Assigned to you:** when another member assigns a task or occurrence to someone, the assignee gets an inbox entry and a push, at most 1 an hour per assignee, batched (PROPOSED). Copy is fixed text with no placeholders, and the payload carries IDs only. Rotation turns don't notify. Free.
- **FR3-NOT-4:** **Today's tasks:** at 08:00 household time (PROPOSED), a member with open tasks due today that are theirs (or unassigned, for parents) gets one local notification with the count only. Nothing is sent on days with none.
- **FR3-NOT-5:** Three new per-type switches on S-29: task reminders, assigned to you, and today's tasks, all on by default (PROPOSED).

**Analytics events:** `task_reminder_set` (`offset` `at_time`, `morning` or `day_before`), and Phase 1's `notification_sent` and `notification_opened` with types `task_assigned`, `task_reminder` and `tasks_today`.

### 3.6 Who's carrying what (LOAD)

Decided in D-24: this week's and last week's counts are free; trends over time (the vision's "load-balance insights") are Premium.

- **FR3-LOAD-1:** S-49 shows, for each parent (and each helper on Premium): open tasks assigned, overdue, and done this week and last week, plus the unassigned count. It's reached from the Tasks tab header. Parents only.
- **FR3-LOAD-2:** **Trends (Premium):** done tasks per member per week for the last 12 weeks, and which chores each member did most. Free shows the Premium sheet with trigger `task_insights` from a "see trends" action.
- **FR3-LOAD-3:** The view states counts and never ranks, scores, colors a member as behind, or awards anything (D-28). Copy is neutral.

**Analytics events:** `load_view_viewed` (`range` `week` or `trends`).

### 3.7 Privacy, export and deletion (PRIV3)

- **FR3-PRIV-1:** Household data export (FR-PRIV-2) adds tasks, chore occurrences, checklists, saved templates and their items, as JSON plus a tasks CSV. Template items show both the ID and the text in the household's locale. Export stays free and includes Premium-only data after a lapse.
- **FR3-PRIV-2:** Household and account deletion (FR-PRIV-3, FR-PRIV-7) cover every Phase 3 table. Account deletion clears the member from `created_by`, `updated_by`, `done_by` and rotations as "former member", and unassigns their open tasks.
- **FR3-PRIV-3:** Task titles and notes are free text the member writes. The editor hints not to put health details in them (copy, PROPOSED), as for document titles (R2-DOC-3).

### 3.8 Free versus Premium in Phase 3 (PAY3)

Decided in D-24 (2026-11-27). The product owner approved changing the vision's table to match; that edit isn't in this PR yet.

| Capability  | Free                                                                                                    | Premium                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Tasks       | Unlimited tasks between the two parents, due dates, 1 reminder, notifications, done history for 4 weeks | Full done history                                              |
| Chores      | Up to 3 recurring chores (server setting)                                                               | Unlimited recurring chores, rotation                           |
| Checklists  | Every starter checklist                                                                                 | Saved templates                                                |
| Sources     | Make a task from plans, lists, events and documents                                                     |                                                                |
| Insights    | Who's carrying what, this week and last                                                                 | Trends over 12 weeks                                           |
| Helpers     | None                                                                                                    | Tasks assigned to or shared with family members and caregivers |
| Always free | Export and deletion of all Phase 3 data, privacy settings                                               |                                                                |

- **FR3-PAY-1:** New Premium sheet triggers: `recurring_chore` (a 4th chore on Free), `chore_rotation`, `task_template`, `task_insights` and `helper_tasks` (assigning or sharing on a household with no seats).
- **FR3-PAY-2:** Every gate is enforced on the server as well as in the app: a chore past the free cap, a rotation on a free household's chore, a saved template, and a done task older than the window are refused or hidden by policy (architecture section 8). Insights are worked out on the device from synced rows, so the app gates them by the household's synced entitlement.

## 4. Screens

| ID   | Screen                   | Purpose                                                         | Navigation                         |
| ---- | ------------------------ | --------------------------------------------------------------- | ---------------------------------- |
| S-44 | Tasks                    | Overdue, Today, Upcoming, Anytime and Done; filters; add        | Fourth tab (D-29); to S-45 to S-49 |
| S-45 | Task editor (sheet)      | Title, due, assignee, reminder, notes, repeat, rotation, share  | From S-44, S-46 and every source   |
| S-46 | Task detail              | Details, source chip, chore history, complete, skip, delete     | From S-44, S-48; to S-45           |
| S-47 | Starter checklists       | Suggested and all templates, saved templates, preview and start | From S-44                          |
| S-48 | Checklist                | Progress and items; save as template                            | From S-44, S-47                    |
| S-49 | Who's carrying what      | Counts per member; trends on Premium                            | From S-44's header                 |
| S-50 | Tasks from notes (sheet) | Notes split into lines to keep or untick                        | From S-38                          |

Flows to cover with Maestro: add and assign a task and see it on the partner's device (two-device harness), start a newborn checklist, make tasks from appointment notes, complete a rotating chore.

## 5. Data and business rules

- **R3-TASK-1:** A task has either no due, a `due_date` (date in the household's timezone) or a `due_at` (instant). Completion is a checked column with who and when, so the Phase 1 conflict rule keeps a completion from being undone by a stale write (architecture section 5).
- **R3-TASK-2:** A task's title is null when it comes from a template item and hasn't been edited; its text then comes from the locale files by `template_item_id`. Nothing matches, sorts or merges on title text.
- **R3-TASK-3:** Tasks have no person tag, priority, health field or attachment. The only free text is the title and notes.
- **R3-CHORE-1:** A chore stores its rule on the task (`repeat`, reusing the calendar's JSON rule plus `after_done_days`), and its rotation as an ordered list of user IDs. Occurrences are expanded on the device for the visible range, never stored, except those done, skipped or reassigned.
- **R3-CHORE-2:** An occurrence row's ID is `stableId('task_occurrence', task, original_date)`, so two devices completing the same occurrence offline write one row (R2-CAL-2).
- **R3-CHORE-3:** Rotation's next assignee is worked out from the last done occurrence, on the device, and written when the occurrence is first touched; until then every device computes the same answer from the same synced rows.
- **R3-CHK-1:** Starter templates ship in the app as data: template ID, stage, regions, and items with ID, regions and due offset. Their text is in the locale files under the item IDs, for `en-US`, `en-GB` and `en-AU`. A new app version may add or change templates; checklists already started don't change (PROPOSED).
- **R3-CHK-2:** A started checklist row stores the template ID or saved template ID, the anchor date and who started it. Nothing else about the stage is stored on it.
- **R3-LINK-1:** A task's source is a kind (`source.plan_entry`, `source.grocery_item`, `source.event`, `source.document` or `source.checklist`) and an ID. It's a link, not a foreign key: deleting the source leaves the task.
- **R3-PAY-1:** Windows and limits in this spec (the free cap of 3 recurring chores, which may be 0, the 14-day Upcoming range, the 4-week done history, 12 weeks of trends, notification times, the "after done" range) are server settings in `app_config`, tuned without a release.

## 6. Non-functional requirements

Phase 1's and Phase 2's NFRs apply to every Phase 3 screen and table. Additions:

- **NFR3-PERF-1:** The Tasks tab shows within 500 ms (p75) from the local copy, with 1,000 tasks and 30 chores (PROPOSED).
- **NFR3-PERF-2:** Expanding every chore's occurrences for 12 weeks finishes within 50 ms on the mid-range Android device.
- **NFR3-OFF-1:** Everything in Phase 3 works offline, including starting a starter checklist (its content is in the app). Export, the Premium sheet's purchase and server notifications need a connection.
- **NFR3-OFF-2:** Two partners completing, reopening or reassigning the same task or occurrence offline converge on one result on reconnecting, proven in the two-device harness.
- **NFR3-OFF-3:** A helper who loses access to a task (unshare, reassignment, removal from a rotation, lapse, removal) loses it from their device on the next sync, proven in the harness.
- **NFR3-SEC-1:** Every new table has `household_id`, RLS and pgTAP tests proving another household, and a helper outside R3-ACC-1, can't read or write it, and that a helper can't share, assign to another helper, or set a repeat.
- **NFR3-SEC-2:** No task title, note, source title or template text reaches analytics, Sentry, logs, AI or server push text. Sentry drops breadcrumbs from task screens' text inputs.
- **NFR3-A11Y-1:** Every task row is usable with VoiceOver and TalkBack: it announces title, due, assignee, done state and "repeats", and offers complete, assign and delete as accessibility actions, not only as swipes. Done is shown by a checkmark, strikethrough and state text, never color alone.
- **NFR3-A11Y-2:** Completing is one tap on a 48 pt target. Adding is bottom-reachable. Every screen works at the largest text size, and S-49 shows numbers as text, not bars alone.
- **NFR3-L10N-1:** Due dates use the `Intl` helpers in the household's locale, including relative words such as "today" and "tomorrow". Repeat rules, sources and template items are stored as identifiers. Checklist text is reviewed for each of `en-US`, `en-GB` and `en-AU`, and passes the pseudo-locale and right-to-left layout checks.

## 7. Release and quality

### 7.1 Phase 3 definition of done

1. Every Phase 3 backlog item is merged, and every `FR3-` is covered by a test or manual case.
2. **Partners use tasks weekly** (PROPOSED measures): in a 4-week beta, at least half of two-parent households complete tasks in at least 3 of the 4 weeks, and in at least a third of those, both parents complete tasks.
3. **Without a second tool** (PROPOSED): in the beta's end survey, at least two thirds of active households say they no longer keep household to-dos in another app, a shared note or a group chat.
4. Checklist content is reviewed per D-27 for each locale, with the reviewer's sign-off kept with the release notes.
5. The data inventory and store privacy answers are updated for task data (vision launch gates), and the internal security review covers the new RLS (L-09).

### 7.2 Beta

Phase 3 goes to the earlier phases' beta households first, behind a feature flag, for 4 weeks (PROPOSED), including at least 5 Premium households with a helper. Free households count toward 7.1, so the measure isn't driven by recurring chores alone.

## 8. Assumptions, open questions and conflicts

### 8.1 Assumptions

| ID    | Assumption                                                                                                                           | If wrong                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| AS3-1 | Free households reach the weekly habit with one-off tasks, checklists and up to 3 recurring chores.                                  | Tune the free cap (R3-PAY-1) from beta usage.                               |
| AS3-2 | The calendar's repeat engine (`expandOccurrences`) serves chores' schedule mode without changes.                                     | A separate small expander for tasks.                                        |
| AS3-3 | Starter checklist choice and task titles can reveal pregnancy or health details, so they're health-related data under US state laws. | Legal review (D-11) may add a consent step; analytics already exclude them. |
| AS3-4 | The Phase 2 per-row visibility (scoped sync) handles tasks' visibility rule with rotation lists.                                     | A visibility table of task and member IDs.                                  |

### 8.2 Open questions

D-24 to D-30 are decided. The one open follow-up is arranging D-27's health reviewers before K-04 and the beta. Every PROPOSED value above is still the product owner's to confirm.

### 8.3 Conflicts and gaps with other docs

- **C3-1, quick capture.** The vision's Tasks and Chores section lists "quick capture by voice or widget", but the Phase 3 roadmap row doesn't, and Phase 1 left widgets and assistant shortcuts out (spec.md C-2). Decided reading (D-30): they're deferred to one fast-capture item after Phase 3, for tasks and the grocery list together. No vision change, since the Phase 3 row doesn't list them.
- **C3-2, starter checklists and templates.** The vision's table puts "templates" in Premium, and its Phase 3 row includes "newborn starter checklists". Resolved by D-24: built-in starter checklists are free and a household's saved templates are Premium, and the product owner approved changing the vision's table to say so (2026-11-27).
- **C3-3, who's carrying what.** The vision's module section describes "a simple view of who is carrying what" with no tier, and its table makes "load-balance insights" Premium. Resolved by D-24: the current counts are free and trends Premium.
- **C3-4, expecting checklists.** The vision's Phase 3 row says "newborn starter checklists"; Decided reading (D-27): expecting checklists ship in Phase 3, since the vision is "stage-aware from pregnancy" and D-6 stores the due month. No vision change.
- **C3-5, "anything to tasks".** The vision says any item can spawn a task. This spec covers plan entries, grocery items, events and documents, the modules that exist; recipes, people and settings aren't sources. Supplies join in Phase 4.
- **C3-6, tab bar.** The design system's floating tab bar holds 5 tabs, all used since Phase 2. Resolved by D-29: Tasks takes the Recipes slot, and T-02.1 updates design-system.md's tab bar row when it's built.
