# Parent Manager: design directions

Status: three directions for the product owner to choose from. These are written briefs, not designs. Real mockups of the core screens (Plan, List, Recipe, Import review) come after a direction is chosen, before backlog item F-06 builds the design system.

## What every direction must do

These come from the vision's constraint that every screen assumes sleep-deprived, one-handed, interrupted use. They apply whichever direction is chosen.

- **Thumb zone.** Primary actions sit in the bottom third: a bottom tab bar, a bottom "add" button and bottom sheets. Nothing essential sits only in the top corners.
- **Big targets.** Tap targets of at least 48 points, list rows of at least 56 points, and checkboxes that respond to a tap anywhere on the row.
- **Interruption-proof.** Every edit saves immediately, with no "Save" step that can be lost. Sheets keep their state if the app is backgrounded, and the app reopens where it was left. Undo replaces "are you sure?" dialogs.
- **One decision per screen.** Show the next action clearly, keep the rest a tap away, and use plain language.
- **Night-safe.** Dark mode follows the system and avoids pure-white flashes. No sounds or vibrations by default, so nothing wakes the baby.
- **Accessible.** WCAG AA contrast, layouts that work at the largest dynamic type size, screen-reader labels, and no meaning carried by color alone.
- **Localizable.** No text in images, layouts tolerate text up to twice as long, and right-to-left mirroring works.

Contrast ratios below were calculated against WCAG 2.x (AA needs 4.5:1 for body text, and 3:1 for large text and interface elements).

## Direction A: Calm Kitchen (recommended)

**Mood:** warm, quiet and reassuring, like a well-kept kitchen notebook. It lowers the stress of an overloaded day rather than adding energy. Calm, but not clinical.

### Palette

| Role                | Light                       | Dark                            | Contrast (light / dark)                                  |
| ------------------- | --------------------------- | ------------------------------- | -------------------------------------------------------- |
| Background          | `#FAF7F2` warm paper        | `#1C1B19`                       |                                                          |
| Surface             | `#FFFFFF`                   | `#262421`                       |                                                          |
| Text                | `#2B2A28`                   | `#F2EEE8`                       | 13.4 / 14.9                                              |
| Secondary text      | `#6B665E`                   | `#B5AFA6`                       | 5.3 / 7.9                                                |
| Primary (sage)      | `#3F6B4F`, white text on it | `#8DBB9C`, `#10291A` text on it | 5.7 / 8.0 on background, 6.1 / 7.2 for text on the color |
| Accent (terracotta) | `#B4602F`                   | `#E39A6B`                       | 4.2 / 7.5                                                |
| Danger              | `#B3261E`                   | `#F2B8B5`                       | 6.1 / 10.1                                               |

The light-mode accent reaches 4.2:1, so it's used only for fills, icons and large text, never small text.

### Typography and components

- **Typography:** the system font (SF Pro and Roboto) for all body text and controls, so dynamic type works natively. A soft serif such as Fraunces, free under the SIL Open Font License, is used only for screen titles and recipe names, for warmth. Body size starts at 17 points. Quantities use tabular figures, so columns line up.
- **Components:** soft 12-point corners, light dividers instead of heavy cards, generous spacing and a few subtle shadows. List rows read like a paper checklist, with checked items fading and sliding into a "done" group. Ingredient lines and photos are the only imagery.

### One-handed, interrupted use

- **Low strain at night:** a low-glare background and muted colors.
- **A calm Plan tab:** it shows "tonight" first, then the week.
- **No visual pressure:** the restrained palette makes the one primary button per screen obvious, and nothing competes with it.

### Risks

It can feel too quiet or generic if executed lazily. It needs good photography for recipes, or tasteful empty states without it.

## Direction B: Clear Utility

**Mood:** fast, precise and confident, like a pro tool that gets out of the way. Inspired by native list apps, it puts information density and speed first. Feels efficient and trustworthy.

### Palette

| Role                       | Light                       | Dark                            | Contrast (light / dark) |
| -------------------------- | --------------------------- | ------------------------------- | ----------------------- |
| Background                 | `#FFFFFF`                   | `#0B0F17`                       |                         |
| Surface                    | `#F3F5F8`                   | `#151B26`                       |                         |
| Text                       | `#0F172A`                   | `#E6EAF2`                       | 17.9 / 15.9             |
| Secondary text             | `#475569`                   | `#9AA4B5`                       | 7.6 / 7.6               |
| Primary (blue)             | `#1D4ED8`, white text on it | `#7AA2FF`, `#0B1A3D` text on it | 6.7 / 7.7               |
| Accent (green, for "done") | `#047857`                   | `#4ADE9B`                       | 5.5 / 11.2              |
| Danger                     | `#B91C1C`                   | `#FCA5A5`                       | 6.5 / 10.1              |

### Typography and components

- **Typography:** the system font throughout, with stronger weights and compact line heights for denser lists. Clear size steps of 13, 15, 17, 22 and 28 points.
- **Components:** flat surfaces, crisp 8-point corners, edge-to-edge grouped lists like iOS Settings and Reminders, swipe actions on rows, and compact headers that collapse as you scroll.

### One-handed, interrupted use

- **More on screen:** density shows more of the list at once, which means less scrolling in a store aisle.
- **Familiar gestures:** swipe gestures match what parents already know from Reminders.
- **Bigger tap rows:** this direction adds an optional "large rows" setting, because density works against tired thumbs.

### Risks

It looks like every other productivity app, which weakens the "built for new parents" story. It's colder emotionally, and it can feel like work at 3 a.m.

## Direction C: Village

**Mood:** friendly, warm and optimistic, built around the village the vision describes: partners, grandparents and helpers. It celebrates small wins ("week planned!") and feels social.

### Palette

| Role              | Light                                     | Dark                            | Contrast (light / dark)                                      |
| ----------------- | ----------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| Background        | `#FFF8F1`                                 | `#1E1A22`                       |                                                              |
| Surface           | `#FFFFFF`                                 | `#29232E`                       |                                                              |
| Text              | `#2D2433`                                 | `#F7F1EA`                       | 14.1 / 15.3                                                  |
| Secondary text    | `#6E6275`                                 | `#BDB1C2`                       | 5.4 / 8.3                                                    |
| Primary (coral)   | `#C2410C`, white text on it               | `#FF9A76`, `#2A1206` text on it | 4.9 / 8.3                                                    |
| Accent (sunshine) | `#F6C445` fill only, `#2D2433` text on it | Same                            | 9.1 for text on the fill; never use the accent as text (1.5) |
| Danger            | `#B42318`                                 | `#FDA29B`                       | 6.2 / 8.8                                                    |

### Typography and components

- **Typography:** a rounded sans serif, such as Nunito (free under the SIL Open Font License), for titles. The system font for body text, to keep dynamic type reliable.
- **Components:** big rounded corners (16 to 20 points) and chunky buttons. Member avatars and color tags show who added or checked what. Light illustrations appear in empty states, small celebratory animations mark completions, and these respect the Reduce Motion setting.

### One-handed, interrupted use

- **Big buttons:** large, forgiving targets suit tired hands.
- **Visible sharing:** clear "who did what" cues reduce partner hand-offs, because you can see that your partner already bought the milk.
- **Re-orientation after an interruption:** celebrations give a sense of where you were.

### Risks

The most work to build: illustrations need to be commissioned and animations take time. It can feel childish or noisy to some parents. Coral and yellow are harder to keep accessible, and dark mode needs extra care.

## Recommendation: Direction A, Calm Kitchen, borrowing two ideas from C

Calm Kitchen fits the promise of the vision best ("take the everyday mental load off"): it lowers stress, works at night, and sets the app apart from both cold productivity tools and chirpy family apps. Its type pairing keeps dynamic type and localization safe, because body text stays in the system font, and it needs no custom illustrations to ship the MVP.

Two ideas to borrow from Village:

1. **Member avatar dots.** Show who added or checked an item, so sharing is visible.
2. **One small completion moment.** For example, when the list is fully checked off, with Reduce Motion respected.

Next step once a direction is chosen: mockups of Plan, List, Recipe detail and Import review, in light and dark mode, at default and the largest text sizes, tested with two or three real parents before F-06 starts.
