# Decisions and accounts needed from the product owner

This is the decision log. Each entry names the backlog items and GitHub issues it unblocks (see [backlog.md](backlog.md)) and gives my recommendation. Paid plans and pricing are listed so you can decide; per `CLAUDE.md`, Claude won't create accounts, buy plans or set prices.

## Status at a glance

Updated 2026-11-12.

| ID   | Decision                                   | Status                                                 | Needed by                                                                      |
| ---- | ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| D-1  | Supabase production plan                   | Deferred                                               | Before the external beta (L-03.2). Development and staging go ahead without it |
| D-2  | Product name and domain                    | Deferred; interim decided 2026-11-08                   | Before the internal beta (L-03.1). Store listings (#106) wait for it           |
| D-3  | Design direction                           | Decided 2026-11-07                                     |                                                                                |
| D-4  | Sentry, PostHog and Resend accounts        | Deferred 2026-11-08                                    | Before the internal beta. The wrappers do nothing without keys until then      |
| D-5  | Apple and Google developer accounts        | Decided 2026-11-08: publish as an individual. Enrolled |                                                                                |
| D-6  | Onboarding: due date or age, and age range | Decided 2026-11-08                                     |                                                                                |
| D-7  | AI provider and data terms                 | Deferred 2026-11-08                                    | Before AI parsing (R-05.3, #54)                                                |
| D-8  | Starter recipe content                     | Deferred                                               | Before the internal beta (L-03.1). Development uses placeholder recipes        |
| D-9  | Free-tier limits                           | Decided 2026-11-08                                     |                                                                                |
| D-10 | RevenueCat, products, prices and trial     | Deferred                                               | Before subscriptions are built (M-01.1, #94) and the beta. Needs D-5           |
| D-11 | Legal review and no ads                    | Deferred                                               | Before the external beta (L-01.2, #102)                                        |
| D-12 | Updates channel                            | Deferred                                               | Any time; blocks nothing                                                       |
| D-13 | Offline sync approach                      | Decided 2026-11-08: build our own                      |                                                                                |

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

### D-7 AI provider and data terms: needed before R-05.3

- **Decided 2026-11-08:** defer until R-05.3 AI parsing (#54). The import function, quotas and link extraction (R-05.1, R-05.2) don't need it.
- **Needs:** structured JSON output, image input, strong parsing quality, and terms that rule out training on our data, with short retention.
- **Recommendation for later:** run R-05.4's evaluation set on two providers, and choose on accuracy, cost and terms. Calls go through our Edge Function only, so switching later is cheap.
- **You do, then:** approve the provider, sign up for a paid API account, and add the key as a Supabase secret.

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
