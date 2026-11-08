# Parent Manager: Product Vision

Updated 2026-11-07. Competitor research, market sizing, pricing, and business metrics are in the companion document, Parent Manager: Market and Business Analysis.

## Vision and positioning

Parent Manager is one app that runs a new family's household logistics, so busy parents can give their time and attention to their children. Meals and groceries are the first module, not the whole product: this is a holistic parent manager, not another meal-planning app.

**The promise:** take the everyday mental load off new parents.

**The niche:** for parents in the US, UK, and Australia, from pregnancy to age five, Parent Manager is the one shared system where both partners and their helpers run the household, instead of five apps and a group chat.

**What makes it different**

- **Built for new parents.** Every screen assumes sleep-deprived, one-handed, interrupted use.
- **One household brain.** Meals, supplies, calendar, tasks, and documents share one household model, so modules inform each other. A busy appointment day can suggest an easy dinner; a low supply lands on the shopping list.
- **Shared by default.** Two partners, and later relatives and caregivers, see and edit the same plans and lists in real time.
- **Effortless by design.** Import and AI suggestions replace data entry; smart defaults replace setup.
- **Store-agnostic.** Lists leave the app as print, Apple or Android list items, or shared text. There is no retailer lock-in and no dependence on retailer ordering.
- **Built around the village.** Caregiver seats, a handoff brief, meal train, and a "ways to help" list let friends, family, and helpers take real tasks off the parents.
- **Stage-aware from pregnancy.** The app starts before the baby arrives and changes through newborn, first foods, toddler, and preschool.

**Launch scope:** US first, then the UK and Australia, all in English, built so more languages can follow. The core loop is free for the two parents, and a household subscription adds caregivers, automation, and depth.

## Target users and context

The primary user is a new parent who is short on time, sleep, and attention, and who often has older children to care for too. Their partner is a co-equal user, and grandparents, relatives, and caregivers join later as limited-access members on a Premium subscription.

The constraints that shape every design decision: parents often have one hand free, are interrupted constantly, use the app in short bursts, and need their partner to see the same information without a handoff conversation.

| Job to be done                        | Pain today                                                       | How the app helps                                       |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| Decide what the family eats this week | Decision fatigue, repeat meals, no time to plan                  | Quick planner, saved meals, copy last week, suggestions |
| Know what to buy                      | Scribbled lists, forgotten items, buying what is already at home | Auto-built list, pantry de-selection, purchase memory   |
| Keep supplies stocked                 | Running out of diapers, wipes, or formula at the worst time      | Supply tracking and running-low reminders               |
| Coordinate schedules                  | Appointments and plans scattered across messages and calendars   | Shared calendar and appointment reminders               |
| Split the work fairly                 | Unspoken workload, duplicated or dropped tasks                   | Shared, assignable tasks and chores                     |
| Find important paperwork              | Insurance cards and forms buried in photos and email             | Secure document vault with scan and share               |

## Launch scope and localization

Parent Manager launches in the United States first, then the United Kingdom and Australia, all in English, and is built from day one so that adding languages and regions later is content and configuration work, not a rewrite.

**Launch scope**

- Markets: the United States first, then the United Kingdom and Australia as a second wave, on iOS and Android.
- Language: English, with US, UK, and Australian variants.
- Formats: US customary units in the US, metric units in the UK and Australia, local date formats, and local currencies and prices (USD, GBP, AUD).
- Store listings, privacy policy, and terms written for each market, with UK and Australian privacy requirements reviewed before launch there.

**Build requirements so more languages can be added later**

- **No hard-coded text.** Every user-facing string lives in translation files under a key, using a localization framework chosen at the start.
- **Locale-aware formatting.** Dates, times, numbers, currency, and units follow the locale. Metric units are supported in the data model and shown in the UK and Australia.
- **Flexible layouts.** Screens tolerate longer text and right-to-left scripts, and no text is baked into images.
- **Language-neutral data.** Ingredients, tags, and units are stored as identifiers with names per language, so merging "1 cup milk" and "2 cups milk" never depends on English strings.
- **AI with a locale.** Every AI prompt takes a language and region, and recipe parsing and suggestions are evaluated per language before that language ships.
- **Translatable content.** The starter recipe library, onboarding, notification copy, email templates, and legal documents are versioned per locale.
- **Region readiness.** The household record holds a region setting for later differences in units, holidays, and store sections. Privacy law and store rules are reviewed before each new market.

**Adding a language later** follows one checklist: translate strings, adapt the starter library, review AI output, update legal and store listings, test layouts, and release. Which languages and regions come after the three English-speaking markets is an open question below.

## Product principles and non-goals

Five principles decide what gets built and what gets cut.

1. **Effortless first.** If a task takes more than a few taps or cannot be done one-handed, redesign it.
2. **Shared by default.** Anything a household uses is visible and editable by its members, with roles.
3. **Works with what parents already use.** Export to print, share sheets, and native list apps rather than forcing a new habit or depending on a partner's API.
4. **Smart defaults over setup.** Assume sensible staples, portions, and schedules; let parents correct rather than configure.
5. **Earn trust with family data.** Information about children and households is treated as sensitive from day one.

**Non-goals for now**

- Not a recipe or cooking-content platform, and not a meal-kit or meal-delivery service.
- No retailer ordering or checkout integrations (Instacart, Amazon, Whole Foods, and similar). The list is store-agnostic and leaves the app by export.
- Not a source of medical or nutrition advice. Allergy and dietary features carry clear disclaimers.
- Not a full baby tracker. Baby tracking is an integration, not a competing product.

## Product map

Six modules sit on one shared household layer, and they ship in phases starting with Meals and Groceries.

- **Phase 1 (MVP):** Meals and Groceries
- **Phase 2:** Household Supplies, and Calendar and Appointments
- **Phase 3:** Tasks and Chores
- **Phase 4:** Documents and Records
- **Phase 5:** Baby Tracking (integrations)
- **Shared household layer under all of them:** members and roles, real-time sharing, notifications, search, privacy and security, offline sync, AI assistance, camera

Every module reuses the same members, sharing, notifications, and security, which is what lets modules inform each other.

## Phase 1: Meals and Groceries

Phase 1 takes a parent from an empty week to a finished, shareable grocery list with as little effort as possible, and it is the first proof that the household model works.

### Recipes and meals

- Create meals by hand, or import from a web link, a screenshot, a photo of a cookbook page, pasted text, or voice. AI parses the input into ingredients and steps, and the parent reviews before saving.
- A starter library of recommended meals so the app is useful on day one.
- Every meal has an ingredient list with normalized units, so "1 cup milk" and "2 cups milk" merge. Meals scale by servings.
- Tags that matter to new parents: no-cook, one-handed, freezer-friendly, batch-prep, quick, kid-friendly, toddler and baby-led weaning.
- Dietary and allergy profiles per family member, with clear disclaimers that the app is not medical advice.

### Weekly planner

- A week grid for breakfast, lunch, dinner, snacks, and drinks. Parents pick from their own meals or recommended ones.
- Copy last week, save weekly templates, and auto-fill suggestions such as "fill my week with 15-minute meals."
- Leftover links, so cooking once can cover tomorrow's lunch. Portions per person, including separate plates for a baby or toddler.

### Pantry and de-selection

- A staples list (salt, oil, flour) assumed to be on hand and hidden from the list by default.
- One-tap "I already have this" on any ingredient. Optional quantity and expiry tracking, barcode scanning to add items, and running-low flags.

### Grocery list (store-agnostic)

- Built automatically from the week's meals, merged by ingredient, with pantry items removed.
- Add extra items by typing, voice, barcode, widget, or lock-screen shortcut.
- Grouped by store section, shared with a partner in real time, and usable offline for in-store checking off.

### Getting the list out

The list is the product, and it can go anywhere. There are no retailer integrations.

- **Print:** quick print or save as PDF, formatted by store section.
- **Apple Reminders (iOS):** create a list directly in Reminders with each item as a checklist entry.
- **Android and other apps:** share to Google Keep, Google Tasks, or any list app through the share sheet, and copy as plain checklist text. The exact Android approach is confirmed during the build.
- **Share:** send the list to a partner or anyone by message or email.

### Purchase memory and recommendations

- Memory is built from in-app signals: items checked off, "bought" confirmations, and optional receipt scans with the camera. It does not depend on retailer order history.
- Recommendations such as "you usually buy milk every 8 days and it has been 9," and a suggested starting list each week.

### Nudges

A weekly "plan your week" prompt, "list is ready," "defrost the chicken tonight," and running-low alerts, all with per-type controls and quiet hours.

## The other modules

Each module reuses the household layer and links into the others, so the app gets more useful with every module a family adopts.

### Household Supplies

- Track recurring supplies such as diapers, wipes, formula, toiletries, and cleaning products, including diaper size and stage.
- Estimate usage and flag "running low" before the family runs out.
- Low supplies flow onto the same store-agnostic shopping list, in their own section, and leave the app by the same print and export options.

### Shared Calendar and Appointments

- A shared family calendar that syncs with Apple and Google calendars.
- Appointments such as pediatric visits, with reminders, preparation notes, and "who is taking the baby."
- Meals appear on the calendar, and busy days can trigger easy-meal suggestions in the planner.
- Health schedules are user-entered at first. Any built-in schedule templates should be checked against official guidance before they ship.

### Tasks and Chores

- Shared to-dos that can be assigned to either partner, with recurring chores and a simple view of who is carrying what.
- Quick capture by voice or widget, and starter checklists for the first weeks with a newborn.
- Tasks can be created from other modules, for example "call the pediatrician" from an appointment.

### Documents and Records

- A secure vault for insurance cards, birth certificates, daycare and school forms, and pediatric paperwork.
- Scan with the camera, lock with biometrics, set expiry reminders, and share selected documents with a caregiver.
- Higher security bar than the rest of the app (see cross-cutting capabilities).

### Baby Tracking (integrate, don't compete)

- Connect to existing feed, sleep, and diaper trackers where integration is available, and show a daily summary alongside meals and appointments.
- Which trackers can be integrated is a research item. A minimal quick-log may be added if no integration is practical.

### Meal train and grocery gifting

- Friends and family sign up through a shareable link to bring a meal or contribute groceries on specific days, without needing an account.
- The family sees the schedule on their calendar and in the meal plan.

### How the modules connect

- Calendar to Meals: busy days suggest easy dinners.
- Supplies to Groceries: low supplies join the shopping list.
- Calendar to Documents: an appointment can attach the insurance card.
- Anything to Tasks: any item can spawn an assignable task.

## Free tier and subscription

Parent Manager is free for the two parents with a complete core loop, and one household subscription adds people, automation, and depth. The free tier has to be good enough that a new parent recommends the app, and the subscription should feel like help scaling up rather than a price for the basics.

**Paywall principles**

1. **The core loop is free for two parents:** plan a week, build the list, share it, shop from it, and take it out of the app by print or native list.
2. **Charge for people, automation, and depth, not basics.** Extra members, higher AI usage, history, and smart predictions are Premium.
3. **Safety, privacy, and exit are always free.** Allergy profiles and warnings, data export, account deletion, and privacy controls never sit behind the paywall.
4. **One subscription covers the household,** not each person.
5. **Sell at the moment of need.** When a parent tries a Premium action, show a specific upgrade prompt that names the benefit, rather than a blocking paywall.
6. **Offer a free trial** so parents can feel the value first.
7. **Never hold data hostage.** If a subscription lapses, Premium features pause and caregivers lose access, but nothing is deleted and everything stays exportable.
8. **Proposed: no ads in either tier,** to protect trust with family data.

**What sits where**

| Capability                | Free (two parents)                                                                         | Premium (household subscription)                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Household members         | Two parents with full access                                                               | Caregivers, grandparents, and extended family, each with a role and limited access                            |
| Recipes and meals         | Unlimited manual recipes, the starter library, and a small monthly allowance of AI imports | A much larger AI import allowance, bulk import, and heavy photo and voice import                              |
| Weekly planner            | Full planner and copy last week                                                            | Saved template library and "fill my week" suggestions that use dietary preferences and leftovers              |
| Grocery list              | Auto-built list, pantry de-selection, real-time sharing, print, and native list export     | Multiple lists, custom aisle order per store, and price and budget estimates                                  |
| Pantry                    | Staples list and "I have it"                                                               | Expiry tracking, running-low alerts, and bulk barcode and receipt scanning                                    |
| Purchase memory           | Frequently bought items                                                                    | Smart "what you probably need this week" recommendations                                                      |
| Household supplies        | A few key items tracked by hand                                                            | Unlimited items, usage prediction, and running-low reminders                                                  |
| Calendar and appointments | Shared calendar, appointments, and a basic reminder                                        | Multiple reminders per event, change notifications, caregiver schedule sharing, and busy-day meal suggestions |
| Tasks and chores          | Shared to-dos assigned between the two parents                                             | Recurring chores, templates, load-balance insights, and tasks assigned to caregivers                          |
| Documents                 | A handful of documents with scanning and biometric lock                                    | Large storage, expiry reminders, and secure sharing with caregivers                                           |
| Meal train                | Join as a guest and host one meal train                                                    | Unlimited meal trains and grocery gifting                                                                     |
| Caregiver handoff brief   | Not included                                                                               | One-tap shareable brief for caregivers                                                                        |
| History and insights      | The last few weeks                                                                         | Full history and trends                                                                                       |
| Notifications             | Core reminders and quiet hours                                                             | Custom nudges and a weekly digest                                                                             |
| Support                   | Standard                                                                                   | Priority                                                                                                      |

**Always free:** allergy profiles and warnings, list print and export, offline use, data export, account deletion, privacy controls, and core notifications.

## Cross-cutting capabilities

These capabilities serve every module and are built once.

- **Accounts and households.** Email or magic-link sign-in, Sign in with Apple and Google, biometric unlock, and household invitations with roles (parent, family member, caregiver). Account deletion and data export are included from the start.
- **Notifications.** Push and an in-app inbox with per-module controls, quiet hours, and optional email digests.
- **Fast capture.** Voice shortcuts through Siri and Google Assistant, home-screen and lock-screen widgets, and a share extension to send recipes or links into the app.
- **Offline and sync.** Lists, the weekly plan, and the calendar work offline, with conflict handling when two partners edit at once.
- **Camera.** Barcode scanning, receipt scanning, document scanning, and recipe photos.
- **AI assistance.** Recipe parsing, meal suggestions, and natural-language adds such as "add bananas and diapers." AI output is always shown for review before it is saved.
- **Search.** One search across meals, items, appointments, tasks, and documents.
- **Privacy and security.** Household and children's information is treated as sensitive: encryption in transit and at rest, per-household data isolation, biometric lock for the document vault, minimal data collection, no sale of data, accurate store privacy disclosures, and legal review of the privacy policy and terms before launch.
- **Accessibility and comfort.** Dark mode, dynamic type, screen-reader support, and one-handed layouts.
- **Quality and operations.** Analytics, crash and performance monitoring, feature flags, and forced-update prompts.
- **Localization.** All text is externalized for translation, formats follow the locale, and data is language-neutral. English only at first: the US launches first, then the UK and Australia (see Launch scope and localization).
- **Subscriptions and billing.** Apple and Google in-app purchases managed through a subscription service, one household entitlement shared by all members, a free trial, restore purchases, and a graceful downgrade that never deletes data.

## Roadmap and MVP scope

The MVP is Phase 1 plus the household foundation, built and released on iOS and Android together. Later phases are ordered by how directly they extend the daily meals-and-groceries habit. The phases are not dated yet, and the "done when" criteria are proposals to confirm.

| Phase                                | Scope                                                                                                                                                                                                                                                                                                                                                                         | Done when                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. MVP                               | Accounts, household with partner sharing, recipes (manual and import), weekly planner, auto-built grocery list with pantry de-selection, shared offline list, print and native list export, weekly reminder, a localization-ready US English build, and the free tier with the first Premium features (caregiver seats, larger AI import allowance, saved templates, history) | Two partners can plan a week, share the list, and shop from it on both platforms in beta testing |
| 2. Smarter meals, supplies, calendar | Purchase memory and recommendations, pantry expiry, meal train, Household Supplies, Shared Calendar and Appointments, and the UK and Australia launch                                                                                                                                                                                                                         | Low supplies and busy days visibly change the list and the plan                                  |
| 3. Tasks and Chores                  | Assignable shared tasks, recurring chores, newborn starter checklists, tasks created from other modules                                                                                                                                                                                                                                                                       | Partners use tasks weekly without leaving the app for a second tool                              |
| 4. Documents and Records             | Secure vault, scanning, expiry reminders, caregiver sharing                                                                                                                                                                                                                                                                                                                   | Security review passed and documents attach to appointments                                      |
| 5. Baby tracking and ecosystem       | Tracker integrations, daily summary, deeper caregiver roles (Premium)                                                                                                                                                                                                                                                                                                         | At least one tracker integration live, chosen after research                                     |

**Launch gates for every phase:** automated tests passing, privacy and store disclosures updated, internal and beta testing on both platforms, and a staged rollout with a rollback plan.

**Market expansion.** The US launches first. The UK and Australia follow as a second wave, in English, once the core loop and the second-parent flow are proven, with local pricing, units, store listings, and a privacy review. Canada and Ireland are later candidates.

## Success metrics, risks, and open questions

Success is a family that returns every week and brings in its partner, so the first metrics measure habit and sharing. Numeric targets are set after the first beta gives a baseline.

**Proposed metrics**

- Activation: share of new households that plan a first week and export a grocery list within 7 days.
- Partner join rate: share of households where a second adult joins.
- Weekly active households and weeks planned per household.
- Retention at 4 and 8 weeks.
- Later phases: number of modules used per household.

**Key risks**

- **Scope creep across six modules.** Mitigation: strict phase gates and an MVP limited to Phase 1.
- **Children's and household data.** Mitigation: privacy by design, minimal collection, security review before the document vault ships, and legal review of terms and policy.
- **Differentiation from meal-planning apps.** Mitigation: lead with the new-parent focus, partner sharing, and the cross-module household model.
- **AI parsing errors, especially allergens.** Mitigation: always show parsed results for review and carry clear disclaimers.
- **Android list export is less direct than iOS.** Mitigation: share-sheet and plain-text fallbacks.
- **Empty-app problem.** Mitigation: a starter recipe library and import from day one.
- **Tracker integration availability.** Mitigation: treat integrations as research and keep the module small.
- **Localization retrofit.** Mitigation: externalized strings and locale-aware formatting from the first commit.

**Open questions**

- [ ] Confirm the free-versus-Premium table, especially the free AI import allowance and the free limits on supplies and documents.
- [ ] No ads in either tier?
- [ ] Which languages and regions come after English in the US, UK, and Australia?
- [ ] Should onboarding ask for the due date or the baby's age, to start the right stage mode and the expecting-parents path?
- [ ] Product name and brand direction.
- [ ] Which baby trackers matter most to the target parents?
- [ ] Should the product cover pregnancy through age five, extend to age twelve, or start with pregnancy to age two?
- [ ] Should household data be opened to outside AI assistants, and in what way?
- [ ] After the US, should the UK and Australia launch together, or one first?
