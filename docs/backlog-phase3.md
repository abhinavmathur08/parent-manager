# Parent Manager: Phase 3 backlog

Status: draft, 2026-11-27, reconciled with [spec-phase3.md](spec-phase3.md). Phase 3 is **Tasks and Chores**. It's planning only: building starts after the Phase 1 beta, per the vision's phase gates. Each item is one GitHub issue, one branch and one PR of about 400 lines or less (see [CLAUDE.md](../CLAUDE.md)).

**Done when** partners use tasks weekly without leaving the app for a second tool (spec-phase3 section 7.1).

**Sizes, order and IDs** work as in [backlog.md](backlog.md): XS is half a day or less, S about a day, and every item comes after what it depends on. New groups use letters earlier phases don't: **T** tasks and chores, **K** checklists, **X** tasks from other modules. Phase 3 items in existing groups continue their numbers (A-06, M-05, L-09 onwards). Decision IDs refer to [decisions-needed.md](decisions-needed.md); an item with an open decision can't start until it's made.

**Issues:** none are created yet. They're created once the spec is merged and the product owner approves, in a "Phase 3" milestone with a `phase-3` label and a new `area:tasks` label.

## Coverage

Every `FR3-` requirement (44 in total) is covered by at least one item. `NFR3-` requirements are cited where an item delivers them; the rest are checked in L-09 and the definition of done.

## Items

### 1. T-01.1 Tasks schema, RLS and sync

`tasks` and `task_occurrences` with RLS for parents, the `done` check column, the server gate that refuses a chore past the free cap (`app_config`, default 3) or a rotation on a Free household, export and deletion registration, and sync registration. Writes architecture section 3.6 for Phase 3.

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-TASK-3, FR3-TASK-6, FR3-PAY-2, R3-TASK-1, R3-TASK-2, R3-TASK-3, R3-CHORE-1, R3-CHORE-2, R3-LINK-1, NFR3-SEC-1
- **Depends on:** none (Phase 1 sync and households, Phase 2 C-01.3 scoped sync)
- **Acceptance:**
  - pgTAP: another household can't read or write any row
  - A 4th recurring chore, or any rotation, on a Free household is refused by the server; with the cap set to 0, the first is
  - Harness: two devices completing one task offline end with one completion, and a stale reopen doesn't undo it
  - Export and deletion registry tests pass

### 2. T-01.2 Helper visibility

The helper read and write rules (assigned, shared or in the rotation; helpers' own tasks always shared; no sharing, assigning to other helpers or repeats), and scoped sync for both tables.

- **Area:** Sync
- **Size:** S
- **Spec:** R3-ACC-1, R3-ACC-3, NFR3-OFF-3, NFR3-SEC-1
- **Depends on:** T-01.1; decision D-25
- **Acceptance:**
  - pgTAP: a caregiver sees only tasks matching R3-ACC-1 and can't change `shared` or assign another helper
  - Harness: unsharing, reassigning away, removing from a rotation and a lapse each remove the task from the helper's device within 60 seconds of reconnecting

### 3. T-02.1 Tasks tab

S-44 in the tab bar slot D-29 chooses: Overdue, Today, Upcoming, Anytime and Done groups from the local copy, the Mine, Everyone and member filters, and empty and offline states. Updates design-system.md's tab bar row.

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-TASK-1, FR3-TASK-6, NFR3-PERF-1, NFR3-L10N-1
- **Depends on:** T-01.1; decision D-29
- **Acceptance:**
  - Due dates show in the household's timezone with relative words from the `Intl` helpers
  - Pseudo-locale and largest text size show no clipping
  - `tasks_viewed` recorded with `filter`

### 4. T-02.2 Task editor

S-45 sheet without repeats: title, due date and time, assignee, reminder, notes and "share with helpers", with the FR3-TASK-2 defaults, the no-health-details hint and draft survival.

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-TASK-2, FR3-TASK-3, FR3-PRIV-3, NFR3-A11Y-2
- **Depends on:** T-02.1
- **Acceptance:**
  - A task can be added with a title in 2 taps plus typing
  - The sheet survives the app being killed (NFR-A11Y-8)
  - `task_created` carries only fixed values and booleans

### 5. T-02.3 Complete, assign, detail and delete

One-tap complete with undo, "I'll do it", the assign chip, S-46 task detail, delete with undo, the Done section and the 4-week history window in the read policy.

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-TASK-4, FR3-TASK-5, FR3-TASK-7, FR3-TASK-8, FR3-TASK-9, NFR3-A11Y-1, NFR3-OFF-2
- **Depends on:** T-02.2, T-01.2
- **Acceptance:**
  - VoiceOver and TalkBack announce title, due, assignee and state, and offer complete, assign and delete as actions
  - pgTAP: on Free, done tasks older than the window aren't returned
  - Maestro: add, assign to the partner and complete a task (two-device harness for the partner's view)

### 6. T-03.1 Chore engine

Pure functions for chore occurrences: the schedule mode through `expandOccurrences`, the after-done mode, the next open occurrence with missed ones collapsed, and rotation's next assignee.

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-CHORE-1, FR3-CHORE-2, FR3-CHORE-4, R3-CHORE-1, R3-CHORE-2, R3-CHORE-3, NFR3-PERF-2
- **Depends on:** T-01.1
- **Acceptance:**
  - Unit tests cover each mode, DST in the US, GB and AU, skipped and reassigned occurrences, and rotation after a late completion
  - 30 chores expand for 12 weeks within 50 ms on the reference device

### 7. T-03.2 Chores in the editor and detail

Repeat picker in S-45 (Free up to the cap) and rotation picker (Premium), "this occurrence" or "all future" for edits and deletes, skip and reassign one occurrence, and the chore's history in S-46.

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-CHORE-1, FR3-CHORE-3, FR3-CHORE-4, FR3-CHORE-5, FR3-CHORE-7, FR3-TASK-8
- **Depends on:** T-03.1, T-02.3; decision D-26
- **Acceptance:**
  - Maestro: complete a rotating chore and see the next occurrence assigned to the other parent
  - Changing the rule keeps done and skipped history
  - `chore_created` records `mode` and `rotation_count`

### 8. T-04.1 Task reminders and today's tasks

`TaskReminderScheduler` sharing the 60-notification device budget, quiet hours, the "show details" setting widened to tasks, the 08:00 today's-tasks count, and the two local switches on S-29.

- **Area:** Notifications
- **Size:** S
- **Spec:** FR3-NOT-1, FR3-NOT-2, FR3-NOT-4, FR3-NOT-5
- **Depends on:** T-02.3
- **Acceptance:**
  - Reminders fire offline at the right local time, nearest first across tasks, events and defrost reminders
  - Text has no title unless the member turned details on
  - No today's-tasks notification on a day with none

### 9. T-04.2 Assigned-to-you notification

A trigger that enqueues `task_assigned` for the new assignee when another member assigns, batched to 1 an hour, with its `notification_prefs` column, fixed copy and inbox entry.

- **Area:** Notifications
- **Size:** XS
- **Spec:** FR3-NOT-3, FR3-NOT-5
- **Depends on:** T-02.3
- **Acceptance:**
  - pgTAP: payload carries IDs only; rotation turns and self-assignment send nothing
  - Copy check passes (`pnpm run notify:copy:check`)

### 10. K-01 Starter template format and content check

The template data format (template ID, stage, regions, items with ID, regions and due offset), its locale keys for `en-US`, `en-GB` and `en-AU`, a check script in `pnpm run check` that every item has text in every locale, and placeholder content.

- **Area:** Content
- **Size:** S
- **Spec:** FR3-CHK-5, R3-CHK-1, NFR3-L10N-1
- **Depends on:** none
- **Acceptance:**
  - The check fails on a missing translation or an unknown region
  - A GB household never gets a US-only item (unit test)

### 11. K-02.1 Start a starter checklist

`checklists` table with RLS, export and deletion registration; S-47 with suggested and all templates, the preview with untick, and starting, which writes tasks with due offsets from the due month or the start date.

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-CHK-1, FR3-CHK-3, FR3-CHK-4, R3-CHK-2
- **Depends on:** K-01, T-02.3
- **Acceptance:**
  - pgTAP: another household can't read or write a checklist
  - Maestro: start "first weeks", untick two items, and see the rest as tasks
  - `checklist_started` carries `items_count` and `items_removed_count` only

### 12. K-02.2 Checklist screen and stage suggestions

S-48 with progress in text and a ProgressBar, and suggestions on the empty Tasks tab and after a stage change, shown once each.

- **Area:** Tasks
- **Size:** XS
- **Spec:** FR3-CHK-2, FR3-CHK-6
- **Depends on:** K-02.1
- **Acceptance:**
  - Editing the youngest's age band from 0 to 6 months to 6 to 12 months suggests nothing new (no templates for that stage yet)
  - A dismissed suggestion stays hidden on both parents' devices

### 13. K-03 Saved templates

`task_templates` and `task_template_items` with RLS and registration; save a checklist or selected tasks as a template and apply it (Premium).

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-CHK-7, FR3-PAY-2
- **Depends on:** K-02.2
- **Acceptance:**
  - A template insert on Free is refused by the server
  - Applying a template creates a checklist with offsets from today

### 14. K-04 Starter checklist content and review

Final content for the five templates in three locales, written or commissioned per D-27, and the reviewer's sign-off.

- **Area:** Content
- **Size:** S
- **Spec:** FR3-CHK-8
- **Depends on:** K-01; decision D-27
- **Acceptance:**
  - No item gives medical advice or a clinical schedule
  - Sign-off for each locale kept with the release notes

### 15. X-01 Tasks from the plan and the list

"Make a task" on S-12 and S-15 with prefills, and the source chip on S-46 with its "no longer available" state.

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-LINK-1, FR3-LINK-2, FR3-LINK-5, FR3-LINK-6, R3-LINK-1
- **Depends on:** T-02.3
- **Acceptance:**
  - A task from a list item shows "from the list" and opens the item
  - Deleting the source leaves the task
  - Completing the task doesn't check off the item

### 16. X-02 Tasks from events and preparation notes

"Make a task" on S-38, and S-50 to make tasks from the notes' lines.

- **Area:** Calendar
- **Size:** S
- **Spec:** FR3-LINK-1, FR3-LINK-2, FR3-LINK-3, R3-ACC-2
- **Depends on:** X-01
- **Acceptance:**
  - Maestro: make two tasks from an appointment's notes, due the day before
  - A caregiver who can't see the event sees "from the calendar" with no title

### 17. X-03 Tasks from documents

"Make a task" on S-42 with the generic title and an expiry-based due date, and a source chip that opens through the vault lock.

- **Area:** Documents
- **Size:** XS
- **Spec:** FR3-LINK-1, FR3-LINK-2, FR3-LINK-4, R3-ACC-2
- **Depends on:** X-01
- **Acceptance:**
  - No document title or category is written to the task (unit test)
  - The chip opens the vault lock first

### 18. X-04 Tasks on the calendar

Each Calendar day shows the count of visible tasks due, opening the Tasks tab on that day.

- **Area:** Calendar
- **Size:** XS
- **Spec:** FR3-LINK-7
- **Depends on:** T-02.1
- **Acceptance:**
  - A helper's count includes only tasks they can see
  - No task reaches the device calendar copy

### 19. T-05 Who's carrying what

S-49: counts per member for this week and last (free), trends over 12 weeks (Premium) with the `task_insights` trigger, neutral copy and numbers as text.

- **Area:** Tasks
- **Size:** S
- **Spec:** FR3-LOAD-1, FR3-LOAD-2, FR3-LOAD-3, FR3-PAY-2, NFR3-A11Y-2
- **Depends on:** T-03.2
- **Acceptance:**
  - Counts match a fixture household (unit test)
  - No ranking, score or "behind" state anywhere on the screen (component test)

### 20. M-05 Phase 3 Premium triggers and lapse

Premium sheet triggers `recurring_chore` (a 4th chore on Free), `chore_rotation`, `task_template`, `task_insights` and `helper_tasks` with each benefit's copy, and lapse behavior for chores, rotation, templates, insights and helpers.

- **Area:** Subscriptions
- **Size:** S
- **Spec:** FR3-PAY-1, FR3-PAY-2, FR3-CHORE-6, FR3-CHORE-7, FR3-CHK-7
- **Depends on:** T-05, K-03
- **Acceptance:**
  - Each trigger opens the sheet with its benefit first
  - After a lapse, the 3 earliest chores keep running without rotation; the rest pause with their open occurrence kept as a task; templates are hidden; nothing is deleted
  - Restarting Premium resumes chores from today

### 21. A-06 Export, deletion and leaving for Phase 3

Add Phase 3 tables to household and account export, with template item text in the household's locale; cover them in deletion; unassign a leaving or deleted member's open tasks, drop them from rotations, and tell parents in the inbox.

- **Area:** Privacy
- **Size:** S
- **Spec:** FR3-PRIV-1, FR3-PRIV-2
- **Depends on:** K-03, T-03.2
- **Acceptance:**
  - Export of a household with tasks, chores, checklists and templates contains every Phase 3 table
  - After household deletion no Phase 3 row remains (pgTAP)
  - After account deletion no registered column holds the user's ID

### 22. L-09 Phase 3 internal security review

Review the helper RLS rules, scoped sync, source links (R3-ACC-2), notification payloads and analytics properties against NFR3-SEC-1 and NFR3-SEC-2. Fix findings in follow-up items.

- **Area:** Release
- **Size:** XS
- **Spec:** NFR3-SEC-1, NFR3-SEC-2
- **Depends on:** A-06, X-03
- **Acceptance:**
  - Findings kept in `docs/security/`
  - No open high or critical finding

### 23. L-10 Data inventory and store privacy answers for Phase 3

Add task, checklist and template data to the data inventory, the privacy policy draft, Apple's App Privacy answers and Google's Data safety form.

- **Area:** Release
- **Size:** XS
- **Spec:** NFR-SEC-7, NFR3-SEC-2
- **Depends on:** L-09; decision D-11
- **Acceptance:**
  - Every Phase 3 table is in the inventory

### 24. L-11 Phase 3 beta

Release Phase 3 behind a feature flag to the earlier beta households for 4 weeks, including Premium households with a helper, run the end survey, and measure the definition of done.

- **Area:** Release
- **Size:** S
- **Spec:** none (release)
- **Depends on:** L-10, K-04, M-05
- **Acceptance:**
  - The weekly-use and second-tool measures in spec-phase3 section 7.1 are reported
  - Each store submission is approved by the product owner

## Deliberately after Phase 3

- Widgets, lock-screen shortcuts, and Siri and Google Assistant shortcuts for tasks and the list together (D-30)
- Checklists for 6 to 12 months, toddler and preschool
- Automatic tasks without a tap, such as renewal tasks for expiring documents
- Tasks from supplies (Phase 4) and the meal train (Phase 5)
- Subtasks, priorities, comments and attachments on tasks
- Points, rewards or streaks (D-28: out of scope)
