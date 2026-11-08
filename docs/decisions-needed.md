# Decisions and accounts needed from the product owner

This is the decision log. Each entry names the backlog items and GitHub issues it unblocks (see [backlog.md](backlog.md)) and gives my recommendation. Paid plans and pricing are listed so you can decide; per `CLAUDE.md`, Claude won't create accounts, buy plans or set prices.

## Status at a glance

Updated 2026-11-08.

| ID   | Decision                                   | Status                                   | Needed by                                                                      |
| ---- | ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------ |
| D-1  | Supabase production plan                   | Deferred                                 | Before the external beta (L-03.2). Development and staging go ahead without it |
| D-2  | Product name and domain                    | **Open**                                 | Email sign-in (#32) and invite links (#41)                                     |
| D-3  | Design direction                           | Decided 2026-11-07                       |                                                                                |
| D-4  | Sentry, PostHog and Resend accounts        | **Open**                                 | Observability (#21, #22) and email sign-in (#32)                               |
| D-5  | Apple and Google developer accounts        | **Open**, start now because of lead time | Apple and Google sign-in (#35, #36) and device builds                          |
| D-6  | Onboarding: due date or age, and age range | Decided 2026-11-08                       |                                                                                |
| D-7  | AI provider and data terms                 | **Open**                                 | AI parsing (#54)                                                               |
| D-8  | Starter recipe content                     | Deferred                                 | Before the internal beta (L-03.1). Development uses placeholder recipes        |
| D-9  | Free-tier limits                           | Decided 2026-11-08                       |                                                                                |
| D-10 | RevenueCat, products, prices and trial     | Deferred                                 | Before subscriptions are built (M-01.1, #94) and the beta. Needs D-5           |
| D-11 | Legal review and no ads                    | Deferred                                 | Before the external beta (L-01.2, #102)                                        |
| D-12 | Updates channel                            | Deferred                                 | Any time; blocks nothing                                                       |
| D-13 | Offline sync approach                      | **Open**, blocks the sync layer          | Before H-06.2 (#28)                                                            |

## Open: needed during development and staging

### D-2 Product name and domain

**Blocks:**

- A-01.1 (#32): sign-in emails come from the domain, which needs DNS records for Resend.
- H-03.3 (#41): invite links need the domain.
- L-04 (#106): store listings.
- The app's display name.

**Details:**

- **The situation:** this is open in the vision. The bundle ID `com.myparentmanager` is already chosen and is never shown to users, so the brand can differ. The App Store and Google Play require unique app names.
- **Interim:** development can use Supabase's built-in email, which is rate-limited but fine for testing, and invite codes instead of links.
- **Recommendation:** pick the name before A-01.1, check that the trademark and store names are free, and register the matching domain plus an email subdomain (such as `mail.<domain>`).
- **You do:** choose the name, buy the domain, and add the DNS records when I list them.

### D-4 Observability and email accounts: Sentry, PostHog and Resend

**Blocks:** F-07.1 and F-07.2 observability (#21, #22), and A-01.1 email sign-in (#32, Resend).

- **Recommendation:** the free tiers are enough until the beta. Use PostHog US Cloud for the US launch, and revisit EU hosting before the UK. Resend needs the sending domain from D-2.
- **You do:** create the accounts and add the API keys and DSNs as EAS or GitHub secrets when asked. Never paste them into chat or code.

### D-5 Apple and Google developer accounts

**Blocks:** A-02.1 and A-02.2 Apple and Google sign-in (#35, #36), test builds on real iPhones, M-01.1 purchases (#94), and L-03.1 beta builds (#104).

**Apple:**

- The Apple Developer Program costs USD 99 a year.
- Enrolling as an organization shows the company as the seller, and needs a D-U-N-S number, which can take days to weeks.

**Google:**

- Google Play Console has a one-off USD 25 fee.
- New _personal_ accounts must run a closed test before production access; at last check, 12 testers for 14 days.

**Recommendation:** decide now whether to publish as an individual or a company, because it's hard to change later. If you choose a company, start the D-U-N-S and organization enrollment today.

**You do:** enroll in both. Later, add access for EAS through App Store Connect API keys and a Google service account, which you create and upload yourself.

### D-7 AI provider and data terms

**Blocks:** R-05.3 AI parsing (#54), and with it the import screens and photo import.

- **The situation:** this isn't in the fixed stack. It needs structured JSON output, image input, strong parsing quality, and terms that rule out training on our data, with short retention.
- **Recommendation:** run R-05.4's evaluation set on two providers, and choose on accuracy, cost and terms. Calls go through our Edge Function only, so switching later is cheap.
- **You do:** approve the provider, sign up for a paid API account, and add the key as a Supabase secret.

### D-13 Offline sync approach

**Blocks:** H-06.2 to H-06.4, the sync layer (#28 onwards), and so every feature that needs sharing or offline use.

- **The situation:** the H-06.1 spike (#27, PR #110) failed with Legend-State. It's fast (p95 about 515 ms), but on the device a row deleted elsewhere came back, and a stale uncheck stalled the write queue. Its Supabase plugin is also a beta. The server-side conflict rules held, and the two-device test harness is reusable.
- **Options:**
  - Spike PowerSync for one day with the same harness. It's a new vendor holding a copy of household data, free during development and from USD 49 a month for production.
  - Build our own write queue on the device with Supabase Realtime. That adds no vendor, but takes about 2 to 3 extra days, and we own any sync bugs.
- **Recommendation:** the one-day PowerSync spike first, then decide with results. Build our own if it also fails, or if you'd rather not add a processor for children's data.

## Decided

### D-3 Design direction: decided 2026-11-07

Calm Kitchen with Village touches, including a floating tab bar in Calm Kitchen's style. The details are in [design-directions.md](design-directions.md#decision-calm-kitchen-with-village-touches), and the tokens in [design-system.md](design-system.md). Still open: whether mockups of later screens are commissioned or produced by Claude. The current set is `docs/design/mockups.html`.

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

## Deferred until the beta or launch

These don't block development or staging. Each is listed with the point by which it's needed.

### D-1 Supabase production plan: needed before the external beta

- **Why it's needed:**
  - Production should be its own project, separate from staging (`parent-manager`). With Yakka, that would be a third project, and the free plan allows only two.
  - Free projects pause after a week of inactivity.
  - The free plan has no automatic backups, and keeps only 1 day of logs.
- **Recommendation:** Supabase Pro (from USD 25 a month, first project included), in a new "Parent Manager" organization, created shortly before the external beta.
- **In the meantime:** the development and staging parts of F-03.2 (#10) and F-04.4 (#15) can be built now. Only their production halves wait.

### D-8 Starter recipe content: needed before the internal beta

- **Recommendation:** commission or write 40 to 60 original recipes, tagged for new parents. Ingredient lists are fine to use freely, but instructions and photos are copyrighted and can't be scraped.
- **In the meantime:** development uses a handful of placeholder recipes. R-04.1 (the read-only library and save-a-copy) doesn't need the final content; R-04.2 (#51) does.

### D-10 RevenueCat, products, prices and trial: needed before subscriptions are built

This is a human gate: Claude never changes billing configuration. It needs D-5 first.

**You do:**

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

## Not blocking Phase 1 (decide later)

- **Expo organization account:** optional now. Move the EAS project from the personal account `abhinav08` to an organization if others will join.
- **Which languages and regions after English:** this decides which translations come first. The localization foundation (F-05) doesn't depend on it.
- **Whether the UK and Australia launch together or one first:** a Phase 2 decision.
- **Which baby trackers to integrate:** Phase 5 research.
- **Whether to open household data to outside AI assistants:** decide after the MVP, with privacy review.
