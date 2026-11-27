# Decisions and accounts needed from the product owner

This is the decision log. Each entry names the backlog items and GitHub issues it unblocks (see [backlog.md](backlog.md)) and gives my recommendation. Paid plans and pricing are listed so you can decide; per `CLAUDE.md`, Claude won't create accounts, buy plans or set prices.

## Status at a glance

Updated 2026-11-27. D-14 to D-23 are Phase 2 decisions ([spec-phase2.md](spec-phase2.md)). D-24 to D-30 are Phase 3 decisions ([spec-phase3.md](spec-phase3.md)), all decided on 2026-11-27; Phase 3 is planning only, so none blocks current work.

| ID   | Decision                                   | Status                                                 | Needed by                                                                      |
| ---- | ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| D-1  | Supabase production plan                   | Deferred                                               | Before the external beta (L-03.2). Development and staging go ahead without it |
| D-2  | Product name and domain                    | Deferred; interim decided 2026-11-08                   | Before the internal beta (L-03.1). Store listings (#106) wait for it           |
| D-3  | Design direction                           | Decided 2026-11-07                                     |                                                                                |
| D-4  | Sentry, PostHog and Resend accounts        | Deferred 2026-11-08                                    | Before the internal beta. The wrappers do nothing without keys until then      |
| D-5  | Apple and Google developer accounts        | Decided 2026-11-08: publish as an individual. Enrolled |                                                                                |
| D-6  | Onboarding: due date or age, and age range | Decided 2026-11-08                                     |                                                                                |
| D-7  | AI provider and data terms                 | Deferred 2026-11-08; built with a fake provider        | Before real AI parsing; steps in D-7 below                                     |
| D-8  | Starter recipe content                     | Deferred                                               | Before the internal beta (L-03.1). Development uses placeholder recipes        |
| D-9  | Free-tier limits                           | Decided 2026-11-08                                     |                                                                                |
| D-10 | RevenueCat, products, prices and trial     | Interim, decided 2026-11-15: mock store                | Real products, prices and RevenueCat before the beta                           |
| D-11 | Legal review and no ads                    | Deferred                                               | Before the external beta (L-01.2, #102)                                        |
| D-12 | Updates channel                            | Deferred                                               | Any time; blocks nothing                                                       |
| D-13 | Offline sync approach                      | Decided 2026-11-08: build our own                      |                                                                                |
| D-14 | Phase 2: device calendar sync              | Decided 2026-11-21: device copy and busy times         |                                                                                |
| D-15 | Phase 2: free and Premium split            | Decided 2026-11-21                                     |                                                                                |
| D-16 | Phase 2: what caregivers see               | Decided 2026-11-21: shared items only                  |                                                                                |
| D-17 | Phase 2: document storage                  | Decided 2026-11-21: private bucket and vault lock      |                                                                                |
| D-18 | Phase 2: busy days and the plan            | Decided 2026-11-21: rule and one-tap suggestion        |                                                                                |
| D-19 | Phase 2: children's records                | Decided 2026-11-21: files only, no medical fields      |                                                                                |
| D-20 | Phase 2: security reviewer and budget      | Open                                                   | Before the Phase 2 beta (L-06)                                                 |
| D-21 | Phase 2: storage plan for documents        | Open                                                   | Before the Phase 2 beta; part of D-1                                           |
| D-22 | Phase 2: who signs document read links     | Decided 2026-11-22: the `documents` function only      |                                                                                |
| D-23 | Phase 2: busy days for members             | Decided 2026-11-22: parents' devices publish           |                                                                                |
| D-24 | Phase 3: free and Premium split            | Decided 2026-11-27: 3 free recurring chores            |                                                                                |
| D-25 | Phase 3: what helpers do with tasks        | Decided 2026-11-27: assigned, shared or rotation       |                                                                                |
| D-26 | Phase 3: chore rotation                    | Decided 2026-11-27: simple turn-taking                 |                                                                                |
| D-27 | Phase 3: starter checklist content         | Decided 2026-11-27: Claude drafts, health review       | Arrange the health reviewers before K-04 and the Phase 3 beta                  |
| D-28 | Phase 3: points and rewards                | Decided 2026-11-27: out of scope                       |                                                                                |
| D-29 | Phase 3: where Tasks sits in the tab bar   | Decided 2026-11-27: Tasks takes the Recipes slot       |                                                                                |
| D-30 | Phase 3: voice and widget capture          | Decided 2026-11-27: deferred to after Phase 3          |                                                                                |

## Decided

### D-3 Design direction: decided 2026-11-07

Calm Kitchen with Village touches, including a floating tab bar in Calm Kitchen's style. The details are in [design-directions.md](design-directions.md#decision-calm-kitchen-with-village-touches), and the tokens in [design-system.md](design-system.md). Still open: whether mockups of later screens are commissioned or produced by Claude. The current set is `docs/design/mockups.html`.

### D-5 Developer accounts: decided 2026-11-08, publish as an individual

Both stores will use personal (individual) accounts, not a company.

- **Apple:** the Apple Developer Program as an individual costs USD 99 a year. The App Store shows your legal name as the seller. No D-U-N-S number is needed, so enrollment is usually quick after identity verification.
- **Google:** a personal Google Play Console account has a one-off USD 25 fee and needs identity verification.
  - **Closed test first:** new personal accounts must run a closed test before getting production access; at last check, at least 12 testers for 14 days in a row. L-03.2 (#105) plans for this, so start closed testing early.
  - **Public contact details:** Google may also require public contact details for developers who sell, which applies here because of in-app subscriptions. Check this during enrollment.
- **Moving to a company later:** both stores support transferring an app to another developer account, such as a future company. It takes some steps, and subscribers need care, so check the transfer rules at the time.
- **Enrollment:** done for both stores. The first EAS iOS build registered `com.myparentmanager` under team `5JNGSJXS6A` on 2026-11-08.
- **Still to do (you):** when asked, create an App Store Connect API key and a Google Play service account for EAS, and add them as EAS credentials yourself. Never paste them into chat.
- **Unblocks:** A-02.1 and A-02.2 Apple and Google sign-in (#35, #36), and L-03.1 beta builds (#104). M-01.1 purchases (#94) still need D-10.

### D-6 Onboarding: decided 2026-11-08

- **Question:** onboarding asks "Expecting, or how old is your youngest?" and stores age bands only (expecting, 0 to 6 months, 6 to 12 months, toddler, preschool, older child).
- **Expecting:** for an expecting household, store the **due month only**, never a full date.
- **Age range:** pregnancy to age 5, as in the vision.
- **Unblocks:** H-02.2 onboarding (#65). Spec FR-ONB-4 and NFR-SEC-4 are updated to match.

### D-9 Free-tier limits: decided 2026-11-08

| Limit                              | Free                                  | Premium                  |
| ---------------------------------- | ------------------------------------- | ------------------------ |
| AI imports per household per month | 5                                     | 100, with a fair-use cap |
| History of plans and lists         | The current week and the last 4 weeks | All                      |

- **Unchanged rules:** link imports read from embedded recipe data don't count, and failed imports don't count.
- **Tuning:** limits are server settings, tuned from beta usage and AI cost without a release.
- **Unblocks:** R-05.1 (#52), M-03 (#96) and G-08 (#98). Spec FR-AI-9, FR-LIST-13, FR-PAY-6 and section 5.7 are updated to match.
- **Still PROPOSED in the spec:** Premium seats (6), saved templates (50) and the trial length (14 days, part of D-10).

### D-13 Offline sync: decided 2026-11-08, build our own

- **Decision:** build our own sync layer, with no sync vendor. A local SQLite copy, an outbox of queued writes, and Supabase Realtime filtered by household. The H-06.2 to H-06.4 items already describe this design.
- **Why:** the Legend-State spike (H-06.1, #27, PR #110) failed two offline conflict rules on the device. A sync vendor such as PowerSync would be another processor holding children's data, from about USD 49 a month. Building our own adds no vendor, at the cost of about 2 to 3 more days, and we own any sync bugs.
- **Reused from the spike:** the server-side conflict rules (server-set `updated_at` and `version`, soft deletes) held, and the two-device test harness carries over as H-06.3's acceptance test. PR #110 is closed, and its branch is kept for reference.
- **Unblocks:** H-06.2 to H-06.4 (#28, #30, #31).

### D-14 Device calendar sync: decided 2026-11-21

- **Decision:** connect through the phone's own calendars (`expo-calendar`), with no server connection to Google or Apple. Household events are copied one way into a calendar on each member's phone: a new "Parent Manager" calendar, or an existing writable one such as their Google account calendar. Each member can also share busy times from calendars they pick, as busy blocks with no titles. Two-way sync is later.
- **Why:** it reaches iCloud and Google calendars on both platforms with no OAuth app verification or Google security assessment, no tokens on our server, and no new processor.
- **Unblocks:** C-05.1 to C-05.3 in [backlog-phase2.md](backlog-phase2.md). Spec FR2-DEV-1 to FR2-DEV-6.

### D-15 Phase 2 free and Premium split: decided 2026-11-21

- **Free:** shared calendar, appointments, repeats, 1 reminder per event, device copy, busy times, busy-day detection, markers and manual marking, and up to 25 documents with scanning, the vault lock and attachments.
- **Premium:** easy-meal suggestions on busy days (as the vision's table says; confirmed by the product owner, "Keep busy day meals suggestions in Premium"), up to 5 reminders per event, change notifications, caregiver and family access to shared events and documents, document expiry reminders, and up to 2 GB of documents.
- **Always free:** export and deletion of all Phase 2 data, the vault lock and privacy settings.
- **Tuning:** every number is a server setting.

### D-16 What caregivers see: decided 2026-11-21, shared items only

Family members and caregivers see only events a parent shares (shared by default for childcare events) and documents a parent shares with them by name. Nothing in the vault is visible by default, and an attachment never widens access. Spec section 2.

### D-17 Document storage: decided 2026-11-21

- **Storage:** a private Supabase Storage bucket under `<household_id>/`, encrypted at rest by Supabase, read through signed links that expire after 60 seconds.
- **On the device:** a vault lock (biometric or passcode) on by default, screen capture blocked, and no files kept on the device beyond a temporary viewer cache. Documents aren't available offline.
- **Limits:** PDF, JPEG, PNG and HEIC, up to 10 MB a file. Kept until a parent deletes them; deleted files are purged from storage within 24 hours.
- **Not chosen:** client-side encryption (key sharing and recovery make it a large build) and an offline cache. Both can be revisited after the security review.

### D-18 Busy days and the plan: decided 2026-11-21

A day is busy when a parent's event or busy block overlaps 16:00 to 19:00, or 3 or more hours are booked between 07:00 and 21:00, or a member marks it. The Plan tab shows the marker and reason (free) and, for Premium households, offers one-tap easy dinners (D-15). It never changes the plan without a tap. Spec section 3.4 and R2-BUSY-1.

### D-23 Busy days for family members and caregivers: decided 2026-11-22, parents publish

Family members' and caregivers' devices hold only shared events and their own busy blocks, so they can't work out a day made busy by a parent's private event (R2-BUSY-2). Parents' devices publish each day's result for today and the next 13 days (PROPOSED) to a synced `busy_days` table every active member reads: the date, busy or not, and the reason (`dinner`, `booked` or `marked`), with no titles, times or event IDs. Members' devices show markers from it; parents' devices keep using `busyDays()` directly. Not chosen: a server function, since the server can't expand repeats today. Issue #284, B-01.4.

### D-19 Children's records: decided 2026-11-21, files only

The vault holds files a parent chooses, with a category and an optional person tag. There are no structured medical fields: no diagnoses, vaccine logs or schedules, growth or medications. A `doc.medical` category is allowed and never reaches AI, analytics or notifications. Appointment notes are free text the parent writes.

### D-22 Document read links: decided 2026-11-22, signed on the server only

Only the `documents` Edge Function issues read links, after its own `private.can_read_document` check for the caller, signed with the service role for 60 seconds. Clients have no storage policy on the `documents` bucket, so no member can read, list or sign a file directly, or mint a link that lasts longer (V-02.3, R2-DOC-1, NFR2-SEC-1).

### D-24 Phase 3 free and Premium split: decided 2026-11-27, 3 free recurring chores

The product owner chose the vision's table plus a few recurring chores on Free (the option that needed a vision change).

- **Free:** unlimited one-off tasks between the two parents, every built-in starter checklist, tasks from other modules, due dates, 1 reminder per task, this week's and last week's "who's carrying what" counts, 4 weeks of done history, and up to 3 recurring chores.
- **Premium:** unlimited recurring chores, rotation (turn-taking), saved household templates, trends over time, full done history, and tasks for caregivers and family members.
- **Always free:** export, deletion and privacy controls.
- **Free-chore cap:** a server setting (`app_config`, default 3), tuned without a release, including to 0. Adding a 4th recurring chore opens a specific upgrade prompt naming unlimited recurring chores (trigger `recurring_chore`), and the server refuses it too.
- **Lapse:** chores beyond the cap pause rather than being deleted (vision paywall principle 7), as Phase 2 kept each event's first reminder and paused the rest. The 3 earliest-created chores keep running without rotation; each paused chore's open occurrence stays as an ordinary task; Premium returning resumes them all.
- **Vision:** the product owner approved changing the "What sits where" table's Tasks and chores row to match.
- **Unblocks:** T-01.1, K-03, T-05, M-05. Spec section 3.8, FR3-CHORE-6 and FR3-CHORE-7; resolves conflicts C3-2 and C3-3.

### D-25 What family members and caregivers do with tasks: decided 2026-11-27, assigned, shared or rotation

Helpers see a task assigned to them, a task shared with helpers ("anyone can help"), or a chore they rotate on, following D-16. They can complete, take and add tasks; what they add is always shared, and they can assign only to themselves or a parent. Only parents share, assign to helpers or create chores. Not chosen: complete-only helpers (they couldn't flag "we're out of nappy cream"), and helpers seeing every task. Spec section 2 and R3-ACC-1; unblocks T-01.2.

### D-26 Chore rotation: decided 2026-11-27, simple turn-taking

A parent picks an ordered list of members; each new occurrence goes to the next one after whoever did the last, and one occurrence can be reassigned. No automatic balancing. Rotation is Premium (D-24). Not chosen: fixed assignees only, and automatic balancing (opaque, and it scores members, against D-28). Spec FR3-CHORE-4; unblocks T-03.2.

### D-27 Starter checklist content: decided 2026-11-27, Claude drafts with health review

- **Content:** Claude drafts original, practical logistics items for each region (US, UK and Australia) in five checklists: expecting (prepare the home, hospital bag, paperwork) and newborn (first weeks, home routines). Items name actions, never clinical timings or medical advice.
- **Review:** the product owner reviews every item, and a qualified health reviewer in each market (such as a midwife, health visitor or pediatric nurse) checks the items that touch health services.
- **Expecting checklists ship in Phase 3,** since the app is stage-aware from pregnancy (spec conflict C3-4).
- **Still open (you):** arrange the health reviewers in each market before K-04 and the Phase 3 beta. Claude won't engage a vendor or reviewer.
- **Unblocks:** K-04 (content drafting can start; sign-off waits for the reviewers). Development uses K-01's placeholder content.

### D-28 Points, rewards and streaks: decided 2026-11-27, out of scope

No points, streaks, badges or rankings. "Who's carrying what" shows neutral counts only. Spec FR3-LOAD-3; unblocks T-05.

### D-29 Where Tasks sits in the tab bar: decided 2026-11-27, the Recipes slot

Tasks takes the Recipes tab's slot: Plan, Calendar, List, Tasks, Household. Recipes moves to a button in the Plan tab's header, and stays in the add-to-slot sheet (S-11). T-02.1 updates design-system.md's tab bar row and the Maestro flows that open Recipes when it's built. Not chosen: a sixth tab (cramped at large text sizes), or Tasks inside the Household tab (two taps away). Spec FR3-TASK-1 and conflict C3-6; unblocks T-02.1.

### D-30 Voice and widget capture: decided 2026-11-27, deferred to after Phase 3

Widgets, lock-screen shortcuts, and Siri and Google Assistant shortcuts are built once, after Phase 3, as one fast-capture item covering tasks and the grocery list together. Phase 3 has a bottom-reachable two-tap add, and keyboard dictation works in the title field. No vision change: the vision's Phase 3 row doesn't list quick capture (spec conflict C3-1).

## Deferred until the beta or launch

These don't block development or staging. Each is listed with the point by which it's needed.

### D-2 Product name and domain: needed before the internal beta

- **Blocks now:** only L-04 store listings (#106) and the app's display name.
- **Interim, decided 2026-11-08:**
  - **Email sign-in (A-01.1, #32):** uses Supabase's built-in email, which is rate-limited but fine for development and staging.
  - **Joining a household (H-03.3, #41):** build joining by invite code now. Invite links follow once there's a domain.
- **Switching later:** the sending domain and link host become configuration (Supabase SMTP settings and an env var), not code changes.
- **You do, before the beta:** choose the name, check the trademark and store names, and buy the domain plus an email subdomain (such as `mail.<domain>`). I'll list the DNS records for Resend.

### D-4 Sentry, PostHog and Resend: needed before the internal beta

- **Decided 2026-11-08:** defer all three accounts.
- **In the meantime:** F-07.1 (#21) and F-07.2 (#22) build the crash-reporting and analytics wrappers so they do nothing without keys. Screens that call them aren't blocked, and adding keys later turns them on with no code change.
- **Recommendation for later:** free tiers are enough until the beta. Use PostHog US Cloud for the US launch, and revisit EU hosting before the UK. Resend needs the domain from D-2.
- **You do, before the beta:** create the accounts, and add the keys and DSNs as EAS or GitHub secrets when asked. Never paste them into chat or code.

### D-7 AI provider and data terms: needed before real AI parsing

- **Decided 2026-11-08:** defer until R-05.3 AI parsing (#54). The import function, quotas and link extraction (R-05.1, R-05.2) don't need it.
- **Built while it's open (R-05.3):** parsing sits behind a provider interface in the `import-recipe` Edge Function (architecture section 6). Tests, CI, local development and E2E use a deterministic fake provider. A Claude adapter is written but stays off until the secrets below are set. With no provider set, imports fail cleanly with "can't import right now" and don't use the allowance; links with embedded recipe data still import, because they need no AI call.
- **Needs:** structured JSON output, image input, strong parsing quality, and terms that rule out training on our data, with short retention.
- **Recommendation for later:** run R-05.4's evaluation set on two providers, and choose on accuracy, cost and terms. Calls go through our Edge Function only, so switching later is cheap.
- **What the model receives:** only the recipe text or image, the household's locale and region, and the allowed unit, tag and allergen lists. Never names, people, allergies or plans.
- **You do, to turn on real parsing with Claude:**
  1. Approve Anthropic as the provider after reading its commercial terms (API data isn't used for training by default; check the current retention period).
  2. Create an Anthropic Console account for the business, add billing, and create an API key in a workspace named for this app. Set a monthly spend limit there.
  3. Add the secrets to the Supabase project yourself (never paste the key into chat), then deploy the function:

     ```bash
     pnpm supabase secrets set --project-ref <project-ref> AI_PROVIDER=anthropic ANTHROPIC_API_KEY=<your key>
     pnpm supabase functions deploy import-recipe --project-ref <project-ref>
     ```

     Optional: `AI_MODEL` picks the model. It defaults to `claude-opus-5-5`; `claude-sonnet-5-5` and `claude-haiku-5-5` are cheaper, and the evaluation set (R-05.4) shows whether they're accurate enough.

  4. Run the evaluation set against the real provider (R-05.4, `pnpm run eval:ai`) and check it passes the thresholds in spec AI-22 before relying on it.
- **To turn it off again:** `pnpm supabase secrets unset --project-ref <project-ref> AI_PROVIDER`. The remote kill switch (`app.kill_switches`, `ai_import`) also hides import in the app.
- **Another provider:** add one adapter file next to `ai/anthropic.ts` and one line in `ai/select.ts`, then run the evaluation set on it.

### D-1 Supabase production plan: needed before the external beta

- **Why it's needed:**
  - Production should be its own project, separate from staging (`parent-manager`). With Yakka, that would be a third project, and the free plan allows only two.
  - Free projects pause after a week of inactivity.
  - The free plan has no automatic backups, and keeps only 1 day of logs.
- **Recommendation:** Supabase Pro (from USD 25 a month, first project included), in a new "Parent Manager" organization, created shortly before the external beta.
- **In the meantime (decided 2026-11-09):** one hosted project, `parent-manager`, serves both development and staging builds, on the Free plan, with test data only. The Migrations workflow (F-04.4, #15) deploys to it after each merge. Automated tests use the local stack.
- **Production builds too (decided 2026-11-12):** all three EAS environments, production included, point at `parent-manager` until D-1, so crash reporting, analytics and remote config (F-07.1, F-07.2, F-09) can be built now. Only giving production its own project (F-03.2, #10) and F-04.4's production half wait for this decision. No real family may use a build until then.

### D-8 Starter recipe content: needed before the internal beta

- **Recommendation:** commission or write 40 to 60 original recipes, tagged for new parents. Ingredient lists are fine to use freely, but instructions and photos are copyrighted and can't be scraped.
- **In the meantime:** development uses a handful of placeholder recipes. R-04.1 (the read-only library and save-a-copy) doesn't need the final content; R-04.2 (#51) does.

### D-10 RevenueCat, products, prices and trial: interim, decided 2026-11-15, mock store

- **Interim decision, in the product owner's words:** "build D-10 entirely with a subscription flow that imitates all aspects without charging a credit card. We can add RevenueCat later".
- **What that means:** subscriptions are built against a provider-neutral billing interface shaped like RevenueCat's SDK (`src/lib/billing/`, architecture section 8). The only implementation is a mock store that keeps real subscription state on the server and never charges anyone. Its monthly and annual prices are PROPOSED placeholders, and the trial is the spec's PROPOSED 14 days.
- **Safety:** the mock is never selected by a production build, and the server refuses mock purchases unless `BILLING_MOCK_ENABLED` is set on that project. No migration sets it.
- **Still with the product owner, before the beta:** the real store products, prices and trial, and RevenueCat. RevenueCat then plugs in as a second implementation of the same interface.

This is a human gate: Claude never changes billing configuration. It needs D-5 first.

**You do, before the beta:**

- Create the RevenueCat account.
- Set up monthly and annual products and the trial length (PROPOSED: 14 days) in App Store Connect and Play Console.
- Set the USD prices.
- Create a `premium` entitlement and an offering.
- Add the webhook secret as a Supabase secret.

### D-11 Legal review and no ads: needed before the external beta

- **The situation:** the app stores children's age bands, allergies and possibly a due month, which is health-related data. US state laws such as Washington's My Health My Data Act apply now, and UK GDPR later.
- **Recommendation:**
  - Confirm "no ads in either tier", as the vision proposes.
  - Engage a privacy lawyer before the external beta to review the privacy policy, terms and data inventory (L-01.1, L-01.2).

### D-12 Updates channel: any time

It blocks nothing.

- **Recommendation:** GitHub as the record, since each PR says what changed and how it was tested.
- **Optional extra:** a short email or Slack summary per session if you want push updates. Slack needs a workspace and the Slack integration.

### D-20 Phase 2 security reviewer and budget: needed before the Phase 2 beta

- **Why:** Phase 2 is done only when a security review is passed (vision roadmap), and the vault holds identity and insurance documents.
- **Recommendation:** an internal review against OWASP MASVS L1 with a written threat model (L-05), then a short external mobile and API penetration test of the calendar and vault, scoped at 3 to 5 days. Typical cost is several thousand USD; get two quotes.
- **You do:** choose the reviewer and approve the budget. Claude won't engage a vendor or create accounts.
- **Blocks:** L-06 only.

### D-21 Storage plan for documents: needed before the Phase 2 beta

- **Why:** the Supabase Free plan includes 1 GB of file storage for the whole project, and a 50 MB file limit. Premium allows 2 GB per household.
- **Recommendation:** decide together with D-1: Supabase Pro includes 100 GB, then pay as you go. Development and staging use test files only until then.
- **Blocks:** nothing in development.

## Not blocking Phase 1 (decide later)

- **Expo organization account:** optional now. Move the EAS project from the personal account `abhinav08` to an organization if others will join.
- **Which languages and regions after English:** this decides which translations come first. The localization foundation (F-05) doesn't depend on it.
- **Whether the UK and Australia launch together or one first:** a Phase 7 decision.
- **Which baby trackers to integrate:** Phase 6 research.
- **Whether to open household data to outside AI assistants:** decide after the MVP, with privacy review.
