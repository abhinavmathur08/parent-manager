// Checks the starter checklists (K-01, FR3-CHK-5, FR3-CHK-8, R3-CHK-1, NFR3-L10N-1):
// src/features/checklists/starter-templates.json against the locale files.
//
//   node scripts/checklist-content.js --check   fail on any problem or a stale review sheet (CI)
//   node scripts/checklist-content.js --write   regenerate docs/checklist-content-review.md
//
// Every template and item needs its own text in the locale of each region it's offered in, with
// no fallback to en-US, because each market's text is reviewed separately (D-27). The wording
// rules are a safety net against medical advice and clinical timings, not a replacement for the
// product owner's and health reviewers' review.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

const REGION_LOCALES = { US: 'en-US', GB: 'en-GB', AU: 'en-AU' };
// Must match CHILD_AGE_BANDS in src/features/people/codes.ts (a unit test checks).
const STAGES = ['expecting', 'infant_0_6m', 'infant_6_12m', 'toddler', 'preschool', 'older_child'];
const REVIEW_FLAGS = ['health', 'legal'];
const TEMPLATE_ID = /^checklist\.[a-z0-9_]+\.[a-z0-9_]+$/;
const ITEM_ID = /^checklist_item\.[a-z0-9_]+\.[a-z0-9_]+$/;

// Wording that suggests medical advice or a clinical schedule (FR3-CHK-8). Dates come from due
// offsets, so text never needs a number.
const BANNED = [
  [/\d/, 'a number (timings belong in dueOffsetDays)'],
  [
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(hours?|days?|weeks?|months?)\b/i,
    'a spelled-out timing',
  ],
  [/\b(trimester|gestation|weeks pregnant)\b/i, 'a pregnancy timing'],
  [
    /\b(dose|dosage|medicine|medication|paracetamol|acetaminophen|ibuprofen|prescri\w*|supplement\w*|vitamin\w*)\b/i,
    'a medicine',
  ],
  [/\b(symptom\w*|diagnos\w*|fever|treatment|treat)\b/i, 'a clinical word'],
  [/\b(should|must)\b/i, 'advice wording ("should" or "must")'],
];

// Words that mean an item touches a health service or legal admin, so it must carry that review
// flag. Not exhaustive: authors flag other items by judgement too. Maternity leave and pay are
// legal, not health, and registering with a GP is health, not legal.
const NEEDS_FLAG = {
  health:
    /\b(doctor|p(a)?ediatrician|GP|midwi(fe|ves)|health|nurse|hospital|clinic|provider|check-?ups?|vaccin\w*|immuni[sz]\w*|Medicare|Medicaid|NHS|maternity(?! (leave|pay|allowance))|antenatal|prenatal|postnatal|postpartum|dentist|pharmac\w*)\b/i,
  legal:
    /\b(regist(er|ering|ration) (the |a )?birth|registry|register office|certificate|social security|passport|guardian\w*|parental leave|maternity leave|paternity leave|insurance|benefits?|tax|Centrelink|Medicare|employer|wills?|citizenship)\b/i,
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function lookup(messages, id) {
  return id.split('.').reduce((node, part) => (node == null ? undefined : node[part]), messages);
}

function leafIds(node, prefix) {
  if (typeof node === 'string') return [prefix];
  if (node == null || typeof node !== 'object') return [prefix];
  return Object.entries(node).flatMap(([key, value]) => leafIds(value, `${prefix}.${key}`));
}

/**
 * Returns a list of problems, empty when the content is fine.
 * @param {{ templates: object[] }} data the starter templates JSON
 * @param {Record<string, object>} locales each locale's messages, by locale code
 */
function validate(data, locales) {
  const errors = [];
  const seen = new Set();
  // Which locales each ID needs text in.
  const needed = new Map();

  for (const template of data.templates ?? []) {
    const where = template.id ?? '(template without id)';
    if (!TEMPLATE_ID.test(template.id ?? '')) errors.push(`${where}: bad template ID`);
    if (seen.has(template.id)) errors.push(`${where}: duplicate ID`);
    seen.add(template.id);
    if (!STAGES.includes(template.stage)) errors.push(`${where}: unknown stage ${template.stage}`);
    const regions = Array.isArray(template.regions) ? template.regions : [];
    if (regions.length === 0) errors.push(`${where}: no regions`);
    for (const region of regions) {
      if (!REGION_LOCALES[region]) errors.push(`${where}: unknown region ${region}`);
    }
    needed.set(template.id, regions);
    if (!Array.isArray(template.items) || template.items.length === 0) {
      errors.push(`${where}: no items`);
    }

    for (const item of template.items ?? []) {
      const at = item.id ?? `${where} (item without id)`;
      if (!ITEM_ID.test(item.id ?? '')) errors.push(`${at}: bad item ID`);
      if (seen.has(item.id)) errors.push(`${at}: duplicate ID`);
      seen.add(item.id);
      const itemRegions = item.regions ?? regions;
      if (item.regions !== undefined && itemRegions.length === 0) errors.push(`${at}: no regions`);
      for (const region of itemRegions) {
        if (!REGION_LOCALES[region]) errors.push(`${at}: unknown region ${region}`);
        else if (!regions.includes(region))
          errors.push(`${at}: region ${region} isn't its template's`);
      }
      needed.set(item.id, itemRegions);

      const flags = item.review ?? [];
      for (const flag of flags) {
        if (!REVIEW_FLAGS.includes(flag)) errors.push(`${at}: unknown review flag ${flag}`);
      }
      const offset = item.dueOffsetDays;
      if (offset !== null && !Number.isInteger(offset)) {
        errors.push(`${at}: dueOffsetDays must be a whole number or null`);
      } else if (offset !== null && template.stage === 'expecting' && offset > 0) {
        errors.push(`${at}: an expecting item can't be due after the due month starts`);
      } else if (offset !== null && template.stage !== 'expecting' && offset < 0) {
        errors.push(`${at}: a baby's item can't be due before the checklist starts`);
      }
      // A suggested date on a health item would read as a clinical schedule (FR3-CHK-8).
      if (flags.includes('health') && offset !== null) {
        errors.push(`${at}: a health item has no suggested date (dueOffsetDays null)`);
      }
    }
  }

  const itemFlags = new Map(
    (data.templates ?? []).flatMap((t) => (t.items ?? []).map((i) => [i.id, i.review ?? []])),
  );
  for (const [id, regions] of needed) {
    if (!id) continue;
    const wanted = new Set(regions.map((r) => REGION_LOCALES[r]).filter(Boolean));
    for (const [locale, messages] of Object.entries(locales)) {
      const text = lookup(messages, id);
      if (!wanted.has(locale)) {
        if (text !== undefined) errors.push(`${id}: has ${locale} text but isn't offered there`);
        continue;
      }
      if (typeof text !== 'string' || text.trim() === '') {
        errors.push(`${id}: missing ${locale} text`);
        continue;
      }
      for (const [pattern, what] of BANNED) {
        if (pattern.test(text)) errors.push(`${id} (${locale}): has ${what}: "${text}"`);
      }
      const flags = itemFlags.get(id);
      if (!flags) continue;
      for (const [flag, pattern] of Object.entries(NEEDS_FLAG)) {
        if (pattern.test(text) && !flags.includes(flag)) {
          errors.push(`${id} (${locale}): mentions ${flag} matters but isn't flagged "${flag}"`);
        }
      }
    }
  }

  // Text left behind for an ID no template uses.
  for (const [locale, messages] of Object.entries(locales)) {
    for (const top of ['checklist', 'checklist_item']) {
      if (messages[top] === undefined) continue;
      for (const id of leafIds(messages[top], top)) {
        if (!needed.has(id)) errors.push(`${id}: ${locale} text for an unknown ID`);
      }
    }
  }
  return errors;
}

const SHEET = 'docs/checklist-content-review.md';

function due(template, offset) {
  if (offset === null) return 'Anytime';
  const days = Math.abs(offset);
  const span = days % 7 === 0 ? `${days / 7} wk` : `${days} d`;
  if (template.stage === 'expecting') {
    return offset === 0 ? 'Due month starts' : `${span} before due month`;
  }
  return offset === 0 ? 'Start day' : `${span} after start`;
}

const cell = (text) => (text === undefined ? '—' : text.replace(/\|/g, '\\|'));

/** The review sheet for the product owner and each market's health reviewer (K-04, D-27). */
function reviewSheet(data, locales) {
  const codes = Object.values(REGION_LOCALES);
  const lines = [
    '# Starter checklist content: review sheet',
    '',
    '<!-- Generated by `pnpm run checklists:sheet` from src/features/checklists/starter-templates.json and the locale files. Do not edit by hand. -->',
    '',
    `Content version ${data.version}. **Status: draft, not reviewed.** Claude drafted every item (D-27, K-04, FR3-CHK-8). Before the Phase 3 beta, the product owner reviews every item, and a qualified health reviewer in each market checks the items flagged **health** in that market's locale. Items flagged **legal** touch legal or government admin and get the product owner's check against official sources in the legal review. That review also confirms every legal item's suggested timing, such as the UK maternity-leave notice to employers, against official sources for each market. Sign-off for each locale is kept with the release notes, not here.`,
    '',
    'Rules every item follows: it names a practical action, never medical advice or a clinical timing. Health items never get a suggested date (decided 2026-11-27, FR3-CHK-8), and say to book or check with the family\'s provider. "—" means the item isn\'t offered in that market.',
    '',
    'Due dates are suggestions, counted from the first day of the due month for expecting checklists and from the day a newborn checklist starts.',
  ];
  const flagsOf = (item) => (item.review ?? []).join(', ') || '—';
  for (const template of data.templates) {
    lines.push('', `## ${lookup(locales['en-US'], template.id)} (\`${template.id}\`)`, '');
    lines.push(`| Item | Due | Flags | ${codes.join(' | ')} |`);
    lines.push(`| --- | --- | --- | ${codes.map(() => '---').join(' | ')} |`);
    for (const item of template.items) {
      const texts = codes.map((l) => cell(lookup(locales[l], item.id)));
      const slug = item.id.split('.').at(-1);
      lines.push(
        `| \`${slug}\` | ${due(template, item.dueOffsetDays)} | ${flagsOf(item)} | ${texts.join(' | ')} |`,
      );
    }
  }
  const reviewers = {
    health: "Each market's health reviewer checks these items in their own locale.",
    legal:
      "The product owner checks these items, and each one's suggested timing, against official sources for each market.",
  };
  for (const [flag, who] of Object.entries(reviewers)) {
    lines.push('', `## ${flag === 'health' ? 'Health' : 'Legal'} review by market`, '', who);
    for (const [region, locale] of Object.entries(REGION_LOCALES)) {
      lines.push('', `### ${region} (${locale})`, '');
      for (const item of data.templates.flatMap((t) => t.items)) {
        const text = lookup(locales[locale], item.id);
        if ((item.review ?? []).includes(flag) && text !== undefined) {
          lines.push(`- \`${item.id}\`: ${text}`);
        }
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--write') {
    console.error('Usage: node scripts/checklist-content.js --check | --write');
    process.exit(2);
  }
  const data = readJson('src/features/checklists/starter-templates.json');
  const locales = Object.fromEntries(
    Object.values(REGION_LOCALES).map((l) => [l, readJson(`src/i18n/locales/${l}.json`)]),
  );
  const errors = validate(data, locales);
  if (errors.length > 0) {
    console.error(`Starter checklist content has ${errors.length} problem(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const sheet = reviewSheet(data, locales);
  const file = path.join(root, SHEET);
  if (mode === '--write') {
    fs.writeFileSync(file, sheet);
    console.log(`Wrote ${SHEET}.`);
    return;
  }
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== sheet) {
    console.error(`${SHEET} is out of date. Run: pnpm run checklists:sheet`);
    process.exit(1);
  }
  console.log('Starter checklist content is valid and its review sheet is current.');
}

if (require.main === module) main();

module.exports = { validate, reviewSheet, STAGES, REGION_LOCALES };
