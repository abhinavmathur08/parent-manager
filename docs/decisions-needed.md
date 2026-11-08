# Decisions and accounts needed from the product owner

Sorted by what blocks progress soonest. Each entry names the backlog items it unblocks (see [backlog.md](backlog.md)) and gives my recommendation. Paid plans and pricing are listed so you can decide; per `CLAUDE.md`, Claude won't create accounts, buy plans or set prices.

## Blocking the foundation (needed first)

### D-1 Supabase environments and plan

**Blocks:** F-03 environments, and everything after it.

- **The situation:** the existing project `parent-manager` becomes **staging**. Production needs a new project. The Free plan allows two active projects per organization, the Yakka project already uses one, and free projects pause after a week of inactivity.
- **Recommendation:** Supabase Pro for production. Put it in a new organization, "Parent Manager", to separate billing and access from Yakka. Create the production project shortly before the beta; staging can stay on Free until then.
- **You do:** choose the organization and plan, then create the production project in us-east-1 when asked.

### D-2 Product name and domain

**Blocks:**

- A-01: sign-in emails are sent from the domain, which needs DNS records for Resend.
- H-03: invite links need the domain.
- L-04: store listings.
- The app's display name.

- **The situation:** this is open in the vision. The bundle ID `com.myparentmanager` is already chosen and is never shown to users, so the brand can differ. The App Store and Google Play require unique app names.
- **Recommendation:**
  - Pick the name before A-01.
  - Check that the trademark and the store names are free.
  - Register the matching domain, plus a separate subdomain for email (such as `mail.<domain>`) to protect deliverability.
- **You do:** choose the name, buy the domain and give me access to DNS records, or add the records yourself when I list them.

### D-3 Design direction: decided

**Blocks:** F-06 design system, and every screen after it.

- **Decided 2026-11-07:** Calm Kitchen with Village touches, including a floating tab bar in Calm Kitchen's style. The details are in [design-directions.md](design-directions.md#decision-calm-kitchen-with-village-touches), and the board is `docs/design/direction-ac.html`.
- **Still open:** whether mockups of the remaining screens are commissioned or produced by Claude. This doesn't block F-06's tokens and components.

### D-4 Observability and email accounts: Sentry, PostHog and Resend

**Blocks:** F-07 observability, and A-01 email sign-in (Resend).

- **Recommendation:** the free tiers are enough until the beta.
  - **Sentry:** an organization and a React Native project.
  - **PostHog:** US Cloud, since the app launches in the US first. Revisit EU hosting before the UK launch.
  - **Resend:** verify the sending domain from D-2.
- **You do:** create the accounts and add the API keys and DSNs as EAS or GitHub secrets when asked. Never paste them into chat or code.

### D-5 Apple and Google developer accounts

**Blocks:** A-02 Apple and Google sign-in on real devices, M-01 purchases, and L-03 beta.

- **The situation:**
  - **Apple:** the Apple Developer Program costs USD 99 a year. Enrolling as an organization shows the company as the seller and needs a D-U-N-S number, which can take days to weeks.
  - **Google:** Google Play Console has a one-off USD 25 fee. New _personal_ accounts must run a closed test before production access; at last check, 12 testers for 14 days.
- **Recommendation:** decide now whether to publish as an individual or a company, because it's hard to change later. If a company, start the D-U-N-S and organization enrollment today. If personal on Google, plan the 14-day closed test into the beta timeline.
- **You do:** enroll in both. Add me later through App Store Connect API keys and a Google service account for EAS, which you create and upload yourself.

### D-6 Onboarding: due date or age, and the age range

**Blocks:** H-02 onboarding and H-05 people profiles. This comes from the vision's open questions.

- **Options:**
  - Ask for the due date or the baby's age.
  - Cover pregnancy to age 5, pregnancy to age 2, or extend to age 12.
- **Recommendation:**
  - Ask "Expecting, or how old is your youngest?" with age bands, and store the due month only.
  - Keep pregnancy to age 5 as in the vision.
  - Minimal data, and stage-aware later.

## Blocking Phase 1 features (needed in the next few weeks)

### D-7 AI provider and data terms

**Blocks:** R-05 AI import, and R-07 photo import.

- **The situation:** not in the fixed stack. It needs structured JSON output, image input, strong parsing quality, and terms that rule out training on our data, with short retention.
- **Recommendation:** run R-05's evaluation set on two providers and choose on accuracy, cost and terms. Calls go through our Edge Function only, so switching later is cheap.
- **You do:** approve the provider and sign up (a paid API account). Add the key as a Supabase secret.

### D-8 Starter recipe library: source and licensing

**Blocks:** R-04 starter library. The vision says the app must be useful on day one.

- **Options:** write our own recipes (or commission a recipe developer), license a collection, or use public-domain or openly licensed recipes with attribution.
- **Recommendation:** commission or write 40 to 60 original recipes, tagged for new parents. Ingredient lists are fine to use freely, but instructions and photos are copyrighted, and we can't scrape them from websites.
- **You do:** pick the source, the budget and the reviewer (ideally someone qualified to review baby-led-weaning recipes).

### D-9 Free-tier limits

**Blocks:** R-05 quotas, G-08 history window, and M-03 gates. The vision lists these as open questions.

- **Needed:** the free AI import allowance per month (I suggest 5), the Premium allowance (I suggest 100 with a fair-use cap), and the free history window (I suggest 4 weeks).
- **Recommendation:** start with these numbers and tune them from beta usage and AI cost.

### D-10 RevenueCat, products, prices and trial

**Blocks:** M-01 subscriptions, and M-02 paywall prompts.

- **The situation:** this is a human gate. Claude never changes billing configuration.
- **You do:**
  - Create the RevenueCat account.
  - Set up the subscription products in App Store Connect and Play Console: monthly and annual, with the trial length.
  - Set the USD prices.
  - Create a `premium` entitlement and an offering in RevenueCat.
  - Share the webhook secret as a Supabase secret.

### D-11 Legal and privacy review, and no ads

**Blocks:** L-01 disclosures, and L-03 external beta.

- **The situation:** the app stores children's age bands, allergies and possibly pregnancy status, which are health-related data. US state laws such as Washington's My Health My Data Act and, later, UK GDPR apply.
- **Recommendation:**
  - Confirm "no ads in either tier", which the vision proposes.
  - Engage a privacy lawyer before the external beta to review the privacy policy, terms and data inventory.
- **You do:** confirm no ads, and choose the counsel.

### D-12 Updates channel

**Blocks:** nothing technically. It decides how you receive progress reports between sessions.

- **Options:** a Slack channel through an integration, email, or comments on GitHub issues and PRs.
- **Recommendation:** GitHub, as the record (each PR summarizes what changed and how it was tested), plus a short email or Slack summary per session if you want push updates. Slack needs a workspace and the Slack integration connected to Claude.

## Not blocking Phase 1 (decide later)

- **Expo organization account:** optional now. Move the EAS project from the personal account `abhinav08` to an organization if others will join.
- **Which languages and regions after English:** this decides which translations come first. The localization foundation in F-05 doesn't depend on it.
- **Whether the UK and Australia launch together or one first:** a Phase 2 decision.
- **Which baby trackers to integrate:** Phase 5 research.
- **Whether to open household data to outside AI assistants:** decide after the MVP, with privacy review.
