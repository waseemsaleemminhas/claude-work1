/**
 * Ironclad Tech — one staff page for the Sales and "Dupes Call backs" tabs.
 *
 * Paste this whole file into the Google Sheet: Extensions -> Apps Script -> Code.gs, Save.
 *
 * What staff get
 *   ONE link (a web page) with three buttons:
 *     - New Sale          -> writes a row on the "Sales" tab
 *     - New Call Back     -> writes a row on the "Dupes Call backs" tab
 *     - Edit a record     -> type the full SSN, open that row, change it, save
 *   Staff never need access to the spreadsheet itself.
 *
 * Rules kept from the old forms
 *   - Only people on the "Staff Access" tab can use the page.
 *   - Every field is checked against RULES before anything is written, in the browser
 *     and again on the server. The same rules are put on the sheet columns
 *     (Data validation) so typing straight into the sheet is checked too.
 *   - A new entry whose SSN is already on the tab is refused.
 *   - Choice lists (Carrier, Policy Type, Closer, Status, ...) are read live from the
 *     sheet, plus an "Other" box for new values. Gender, Smoker and Account Type are
 *     fixed lists.
 *   - "State Born In" is a dropdown of US states (stored as the 2-letter code) plus
 *     "Born outside the US" (stored as "Outside US"), which reveals "Country of Birth".
 *   - Carrier is on BOTH tabs and shares one dropdown list, so Sales and Dupes agree.
 *
 * Editing
 *   - A record is found by full SSN only — nothing can be browsed or listed.
 *   - The SSN itself is shown locked: it is the key, so it cannot be changed here.
 *   - Only the fields that actually changed are written, so Remarks and anything else
 *     management keeps in the row is left alone.
 *   - Every edit is written to "Access Log": who, when, and field: old -> new.
 *     SSN / routing / account values are never logged, only "changed".
 *
 * ---- Set up (once) -------------------------------------------------------------
 *  1. Save this file, then run `setup` and approve the permission prompts.
 *     It adds the Carrier column to "Dupes Call backs", the "Access Code" column to
 *     "Staff Access", gives every staff member a code, and applies sheet validation.
 *  2. Deploy -> New deployment -> type "Web app"
 *       Execute as:      Me
 *       Who has access:  Anyone with a Google account
 *     Deploy, then copy the web app URL — that is the one link staff need.
 *  3. "Ironclad Forms" menu -> "Staff access codes" and send each person their code.
 *     (Workspace accounts in your own domain are recognised automatically and are not
 *      asked for a code.)
 *  4. When the old Google Forms are no longer needed:
 *     "Ironclad Forms" -> "Close the old Google Forms".
 *
 *  After pasting a NEW version of this file: Deploy -> Manage deployments -> edit ->
 *  Version: New version -> Deploy. The URL does not change.
 */

// ---- Settings -------------------------------------------------------------

const SALES_TAB = 'Sales';
const DUPES_TAB = 'Dupes Call backs';
const STAFF_TAB = 'Staff Access';
const LOG_TAB = 'Access Log';
const SUBMITTED_BY_HEADER = 'Submitted By';
const STAFF_CODE_HEADER = 'Access Code';
const APP_TITLE = 'Ironclad Tech — Staff Entry';

// Delete each response from the old Forms after it is safely written to the sheet,
// so SSN/bank data is stored in one place only (the sheet).
const DELETE_RESPONSE_AFTER_WRITE = true;

// false: each tab is checked on its own (a Call Back can later become a Sale).
// true:  an SSN already on either tab is rejected.
const SSN_UNIQUE_ACROSS_TABS = false;

// Email the staff member when an old-Form submission is rejected as a duplicate SSN.
const EMAIL_ON_REJECT = true;

const CONFIRMATION = 'Submitted. If it could not be saved (for example a duplicate SSN) you will get an email within a minute.';

// Format checks. `re` must match the whole answer (spaces at the ends are ignored).
// Used by the page (before submit), on the server, and by the sheet's Data validation.
const RULES = {
  name: { re: "[A-Za-z][A-Za-z .,'-]*[A-Za-z.]", msg: 'Letters only (spaces, . , \' - allowed).' },
  phone: { re: '[(]?[2-9][0-9]{2}[)]?[ .-]?[0-9]{3}[ .-]?[0-9]{4}', msg: 'US phone, 10 digits, e.g. 2107257036 or (210) 725-7036.' },
  email: { re: 'N/A|n/a|[^@ ]+@[^@ ]+[.][A-Za-z]{2,}', msg: 'A valid email, or N/A if none.' },
  coverage: { re: '[0-9]+([.][0-9]+)? ?[kK]', msg: 'Amount in thousands, e.g. 5k or 15k.' },
  premium: { number: [1, 10000], msg: 'Monthly premium in dollars, numbers only, e.g. 45.50.' },
  ssn: { re: '[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{4}', msg: 'SSN: 9 digits, e.g. 123-45-6789.' },
  routing: { re: '[0-9]{9}', msg: 'Routing number: exactly 9 digits (keep leading zeros).' },
  account: { re: '[0-9]{4,17}', msg: 'Account number: 4 to 17 digits, numbers only.' },
  country: { re: "[A-Za-z][A-Za-z .,'()-]*[A-Za-z.)]", msg: 'Country name, letters only, e.g. Mexico.' },
  heightWeight: { re: '[3-7]([.][0-9]{1,2})?/[0-9]{2,3}', msg: 'Feet.inches/pounds, e.g. 5.9/138 or 5.11/260.' },
};

// "State Born In" dropdown. The page shows "Texas (TX)"; the sheet stores the code "TX".
const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['PR', 'Puerto Rico'], ['GU', 'Guam'], ['VI', 'U.S. Virgin Islands'], ['AS', 'American Samoa'],
  ['MP', 'Northern Mariana Islands'],
];
const OUTSIDE_US = 'Outside US';
const BORN_OUTSIDE = 'Born outside the US';
const stateChoices_ = () => US_STATES.map(([c, n]) => n + ' (' + c + ')').concat([BORN_OUTSIDE]);

// Accepts "Texas (TX)", "TX" or "Texas"; anything else is treated as outside the US.
function stateCode_(v) {
  const s = String(v).trim();
  const inParens = s.match(/\(([A-Za-z]{2})\)$/);
  if (inParens) return inParens[1].toUpperCase();
  const up = s.toUpperCase();
  if (US_STATES.some(x => x[0] === up)) return up;
  const byName = US_STATES.find(x => x[1].toUpperCase() === up);
  return byName ? byName[0] : OUTSIDE_US;
}

// Stored as plain text in the sheet so leading zeros are kept.
const TEXT_RULES = ['ssn', 'routing', 'account'];

// type: text | para | date | choice | state | country ;  header = exact column header
// shared: fields with the same tag share one dropdown list across both tabs
// after:  column the script creates on the tab if missing, right after this header
const SALES_FIELDS = [
  { header: 'Date', title: 'Sale Date', type: 'date', help: 'Leave blank to use today.' },
  { header: 'Full Name', title: 'Full Name', type: 'text', required: true, rule: 'name' },
  { header: 'Phone', title: 'Phone', type: 'text', required: true, rule: 'phone' },
  { header: 'Address', title: 'Address', type: 'para' },
  { header: 'Email', title: 'Email', type: 'text', rule: 'email', help: 'Write N/A if none.' },
  { header: 'Gender', title: 'Gender', type: 'choice', seed: ['Male', 'Female'], fixed: true },
  { header: 'State Born in', title: 'State Born In', type: 'state' },
  { header: 'Country of Birth', title: 'Country of Birth', type: 'country', rule: 'country', required: true, help: 'Only asked when born outside the US.' },
  { header: 'Date Of Birth', title: 'Date of Birth', type: 'date' },
  { header: 'Coverage', title: 'Coverage', type: 'text', rule: 'coverage', help: 'e.g. 5k' },
  { header: 'Carrier', title: 'Carrier', type: 'choice', shared: 'carrier' },
  { header: 'Policy Type', title: 'Policy Type', type: 'choice' },
  { header: 'Premium', title: 'Premium (monthly $)', type: 'text', rule: 'premium', help: 'Numbers only, e.g. 45.50 — feeds the Summary totals.' },
  { header: 'Existing insurance', title: 'Existing Insurance', type: 'text' },
  { header: 'Medications', title: 'Medications', type: 'para' },
  { header: 'Health Issues', title: 'Health Issues', type: 'para' },
  { header: 'Beneficary Names', title: 'Beneficiary Name(s)', type: 'para' },
  { header: 'Relation', title: 'Beneficiary Relation', type: 'text' },
  { header: 'Beficiary DOB', title: 'Beneficiary DOB', type: 'text' },
  { header: 'SSN', title: 'SSN', type: 'text', rule: 'ssn', help: 'e.g. 123-45-6789. Must not already be on this tab.' },
  { header: 'Bank Name', title: 'Bank Name', type: 'text' },
  { header: 'Routing Number', title: 'Routing Number', type: 'text', rule: 'routing' },
  { header: 'Account Nmumber', title: 'Account Number', type: 'text', rule: 'account' },
  { header: 'Gets Paid On', title: 'Gets Paid On', type: 'text' },
  { header: 'Closer Name', title: 'Closer Name', type: 'choice', required: true },
  { header: 'Licensed Agent', title: 'Licensed Agent', type: 'choice' },
  { header: 'Status', title: 'Status', type: 'choice' },
  { header: 'Driving_L', title: 'Driving License', type: 'text' },
  { header: 'Draft 1st and Onwards', title: 'Draft 1st and Onwards', type: 'text' },
  // "Remarks - Anas/ Waseem" is intentionally left off: management fills it in the sheet.
];

const DUPES_FIELDS = [
  { header: 'NAME', title: 'Name', type: 'text', required: true, rule: 'name' },
  { header: 'ADDRESS', title: 'Address', type: 'para' },
  { header: 'PHONE', title: 'Phone', type: 'text', required: true, rule: 'phone' },
  { header: 'E-MAIL', title: 'Email', type: 'text', rule: 'email', help: 'Write N/A if none.' },
  { header: 'GENDER', title: 'Gender', type: 'choice', seed: ['Male', 'Female'], fixed: true },
  { header: 'BORN ST', title: 'State Born In', type: 'state' },
  { header: 'Country of Birth', title: 'Country of Birth', type: 'country', rule: 'country', required: true, help: 'Only asked when born outside the US.' },
  { header: 'DOB', title: 'Date of Birth', type: 'date' },
  { header: 'EXISTING INS', title: 'Existing Insurance', type: 'text' },
  { header: 'CARRIER', title: 'Carrier', type: 'choice', shared: 'carrier', after: 'EXISTING INS' },
  { header: 'HEIGHT/WEIGHT', title: 'Height / Weight', type: 'text', rule: 'heightWeight', help: 'e.g. 5.9/138' },
  { header: 'SMOKER/NON SMOKER', title: 'Smoker / Non Smoker', type: 'choice', seed: ['Smoker', 'Non smoker'], fixed: true },
  { header: 'HEALTH ISSUES', title: 'Health Issues', type: 'para' },
  { header: 'BENEFICIARY', title: 'Beneficiary', type: 'para' },
  { header: 'SSN', title: 'SSN', type: 'text', rule: 'ssn', help: 'e.g. 123-45-6789. Must not already be on this tab.' },
  { header: 'BANK NAME', title: 'Bank Name', type: 'text' },
  { header: 'ACC TYPE', title: 'Account Type', type: 'choice', seed: ['Checking', 'Savings'], fixed: true },
  { header: 'ROUTING NO', title: 'Routing Number', type: 'text', rule: 'routing' },
  { header: 'ACC NO', title: 'Account Number', type: 'text', rule: 'account' },
  { header: 'DRAFT DATE', title: 'Draft Date', type: 'text' },
  { header: 'STATUS', title: 'Status', type: 'choice' },
];

const FORMS = {
  sales: {
    tab: SALES_TAB, fields: SALES_FIELDS, handler: 'onSalesSubmit',
    name: 'Ironclad — Sales Entry', label: 'New Sale',
    blurb: 'Add a sale to the Sales tab.',
  },
  dupes: {
    tab: DUPES_TAB, fields: DUPES_FIELDS, handler: 'onDupesSubmit',
    name: 'Ironclad — Dupes / Call Back Entry', label: 'New Call Back',
    blurb: 'Add a duplicate / call back to the Dupes Call backs tab.',
  },
};

// ---- Menu -----------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ironclad Forms')
    .addItem('Set up / update everything (safe to re-run)', 'setup')
    .addItem('Show the staff page link', 'showLinks')
    .addItem('Staff access codes', 'showStaffCodes')
    .addSeparator()
    .addItem('Update validation (sheet + old forms)', 'updateValidation')
    .addItem('Refresh choice lists (old forms)', 'refreshChoices')
    .addItem('Fix routing numbers (lost leading zeros)', 'fixRoutingNumbers')
    .addItem('Close the old Google Forms', 'closeOldForms')
    .addToUi();
}

// ---- Setup ----------------------------------------------------------------

// Safe to run again: it only adds what is missing.
function setup() {
  const ss = SpreadsheetApp.getActive();
  ensureStaffTab_(ss);
  ensureLogTab_(ss);
  Object.keys(FORMS).forEach(key => ensureColumns_(mustGetSheet_(ss, FORMS[key].tab), FORMS[key]));
  refreshStaffCodes_(ss);
  applySheetValidation();
  showLinks();
}

// ---- The staff page -------------------------------------------------------

function doGet() {
  return HtmlService.createHtmlOutput(pageHtml_())
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Called by the page on load and whenever an access code is entered.
// Nothing about the sheet is sent back until the person is recognised.
function webBoot(code) {
  const ss = SpreadsheetApp.getActive();
  const staff = findStaff_(ss, code);
  if (!staff) {
    return {
      ok: false, needCode: true,
      message: code ? 'That access code was not recognised. Ask Anas / Waseem for your code.' : '',
    };
  }
  Object.keys(FORMS).forEach(key => ensureColumns_(mustGetSheet_(ss, FORMS[key].tab), FORMS[key]));
  return { ok: true, staff: { email: staff.email, name: staff.name }, data: appData_(ss) };
}

// New Sale / New Call Back.
function webSubmit(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const staff = findStaff_(ss, req && req.code);
    if (!staff) return { ok: false, needCode: true, message: 'Your access code was not recognised.' };

    const cfg = FORMS[req && req.form];
    if (!cfg) return { ok: false, message: 'Unknown entry type.' };

    const prepared = prepare_(cfg, (req && req.values) || {});
    if (prepared.errors.length) {
      return { ok: false, errors: prepared.errors, message: 'Please fix the fields marked below.' };
    }

    const where = dupSsn_(ss, cfg, prepared.values);
    if (where) {
      const last4 = ssnLast4_(ss, cfg, prepared.values);
      logAccess_(ss, staff.email, cfg.label, 'REJECTED — duplicate SSN ***-**-' + last4 + ' (already in ' + where + ')');
      return {
        ok: false,
        message: 'Not saved: the SSN ending ' + last4 + ' is already in ' + where +
          '. If it is the same customer, use "Edit a record" instead.',
      };
    }

    const row = writeNew_(ss, cfg, prepared.values, staff.email);
    logAccess_(ss, staff.email, cfg.label, 'Saved to ' + cfg.tab + ' row ' + row);
    return { ok: true, message: 'Saved to ' + cfg.tab + ' row ' + row + '.' };
  } finally {
    lock.releaseLock();
  }
}

// Edit a record: find it by full SSN. Nothing can be listed or browsed.
function webLookup(req) {
  const ss = SpreadsheetApp.getActive();
  const staff = findStaff_(ss, req && req.code);
  if (!staff) return { ok: false, needCode: true, message: 'Your access code was not recognised.' };

  const want = String((req && req.ssn) || '').replace(/\D/g, '');
  if (want.length !== 9) {
    return { ok: false, message: 'Enter the full 9-digit SSN of the record you want to edit.' };
  }

  const matches = [];
  Object.keys(FORMS).forEach(key => {
    const cfg = FORMS[key];
    const sheet = mustGetSheet_(ss, cfg.tab);
    const field = cfg.fields.find(f => f.rule === 'ssn');
    const last = sheet.getLastRow();
    if (!field || last < 2) return;
    const col = headerMap_(sheet)[norm_(field.header)];
    if (col === undefined) return;
    sheet.getRange(2, col + 1, last - 1, 1).getDisplayValues().forEach((r, i) => {
      if (String(r[0]).replace(/\D/g, '') === want) matches.push(recordAt_(ss, key, i + 2));
    });
  });

  if (!matches.length) {
    return { ok: false, message: 'No record found with that SSN on the Sales or Dupes Call backs tab.' };
  }
  logAccess_(ss, staff.email, 'Edit — search',
    'Opened SSN ***-**-' + want.slice(-4) + ' (' + matches.map(m => m.tab + ' row ' + m.row).join(', ') + ')');
  return { ok: true, matches: matches };
}

// Save an edit. Only changed fields are written; the SSN cannot be changed here.
function webSave(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const staff = findStaff_(ss, req && req.code);
    if (!staff) return { ok: false, needCode: true, message: 'Your access code was not recognised.' };

    const key = req && req.key;
    const cfg = FORMS[key];
    const row = Number(req && req.row);
    if (!cfg || !(row > 1)) return { ok: false, message: 'That record could not be opened. Search the SSN again.' };

    const sheet = mustGetSheet_(ss, cfg.tab);
    requireColumns_(sheet, cfg);
    const hdr = headerMap_(sheet);
    const ssnField = cfg.fields.find(f => f.rule === 'ssn');
    const before = recordAt_(ss, key, row);
    const digits = v => String(v).replace(/\D/g, '');
    if (!ssnField || digits(before.values[ssnField.header]) !== digits(req.ssn)) {
      return { ok: false, message: 'That row no longer holds the same SSN — rows may have moved. Search the SSN again.' };
    }

    // The SSN is the key: keep whatever the sheet already has, whatever was posted.
    const posted = Object.assign({}, (req && req.values) || {});
    posted[ssnField.header] = before.values[ssnField.header];
    const prepared = prepare_(cfg, posted);
    if (prepared.errors.length) {
      return { ok: false, errors: prepared.errors, message: 'Please fix the fields marked below.' };
    }

    // What the row holds now, put through the same checks, so a field is only written
    // when the value the sheet would store actually differs ("$52.84" and "52.84",
    // "Mississippi (MS)" and "MS" are the same value, not an edit).
    const baseline = prepare_(cfg, before.values).values;
    const tz = Session.getScriptTimeZone();
    const asText = v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v);
    const changes = [];
    cfg.fields.forEach(f => {
      if (f === ssnField) return;
      const after = prepared.values[f.header];
      if (asText(baseline[f.header]) === asText(after)) return;
      const cell = sheet.getRange(row, hdr[norm_(f.header)] + 1);
      if (TEXT_RULES.includes(f.rule)) cell.setNumberFormat('@');
      cell.setValue(after);
      changes.push({ title: f.title, from: before.values[f.header], to: asText(after), hide: TEXT_RULES.includes(f.rule) });
    });

    if (!changes.length) return { ok: true, message: 'Nothing to save — no field was changed.', record: before };
    SpreadsheetApp.flush();

    logAccess_(ss, staff.email, 'Edit — ' + cfg.tab + ' row ' + row,
      'SSN ***-**-' + digits(before.values[ssnField.header]).slice(-4) + ' | ' +
      changes.map(c => c.hide ? c.title + ': changed' : c.title + ': "' + c.from + '" -> "' + c.to + '"').join('; '));

    return {
      ok: true,
      message: 'Saved ' + changes.length + (changes.length === 1 ? ' change' : ' changes') + ' to ' + cfg.tab + ' row ' + row + '.',
      record: recordAt_(ss, key, row),
    };
  } finally {
    lock.releaseLock();
  }
}

// Everything the page needs to draw both entry screens.
function appData_(ss) {
  const rules = {};
  Object.keys(RULES).forEach(k => {
    rules[k] = { re: RULES[k].re || '', msg: RULES[k].msg, number: RULES[k].number || null };
  });
  const forms = {};
  Object.keys(FORMS).forEach(key => {
    const cfg = FORMS[key];
    const sheet = mustGetSheet_(ss, cfg.tab);
    forms[key] = {
      key: key, label: cfg.label, blurb: cfg.blurb, tab: cfg.tab,
      fields: cfg.fields.map(f => ({
        header: f.header, title: f.title, type: f.type, required: !!f.required,
        rule: f.rule || '', help: f.help || '', fixed: !!f.fixed,
        choices: f.type === 'choice' ? choicesFor_(ss, sheet, f) : [],
      })),
    };
  });
  return { order: Object.keys(FORMS), forms: forms, rules: rules, states: stateChoices_(), outside: BORN_OUTSIDE };
}

// One row, ready for the edit screen.
function recordAt_(ss, key, row) {
  const cfg = FORMS[key];
  const sheet = mustGetSheet_(ss, cfg.tab);
  const hdr = headerMap_(sheet);
  const width = sheet.getLastColumn();
  const range = sheet.getRange(row, 1, 1, width);
  const raw = range.getValues()[0];
  const shown = range.getDisplayValues()[0];
  const at = header => hdr[norm_(header)];
  const values = {};
  cfg.fields.forEach(f => {
    const i = at(f.header);
    if (i !== undefined) values[f.header] = editValue_(f, raw[i], shown[i]);
  });
  const nameField = cfg.fields.find(f => f.rule === 'name');
  const phoneField = cfg.fields.find(f => f.rule === 'phone');
  const name = nameField && at(nameField.header) !== undefined ? String(shown[at(nameField.header)]).trim() : '';
  const phone = phoneField && at(phoneField.header) !== undefined ? String(shown[at(phoneField.header)]).trim() : '';
  return {
    key: key, tab: cfg.tab, row: row, label: name || '(no name)',
    sub: [phone, cfg.tab + ' row ' + row].filter(String).join(' · '),
    values: values,
  };
}

// How a cell is shown in the edit screen (dates as yyyy-MM-dd, states as "Texas (TX)").
function editValue_(f, raw, shown) {
  const text = String(shown === undefined || shown === null ? '' : shown).trim();
  if (f.type === 'date') {
    const d = raw instanceof Date ? raw : parseLooseDate_(text);
    return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
  }
  if (f.type === 'state') {
    if (!text) return '';
    const up = text.toUpperCase();
    if (up === OUTSIDE_US.toUpperCase()) return BORN_OUTSIDE;
    const hit = US_STATES.find(s => s[0] === up);
    return hit ? hit[1] + ' (' + hit[0] + ')' : text; // unknown value is kept, not guessed
  }
  return text;
}

// ---- Shared checking and writing -----------------------------------------

// Checks one submitted record against RULES and tidies it for the sheet.
// Returns { values: { header: value }, errors: [{ header, msg }] }.
function prepare_(cfg, raw) {
  const errors = [], values = {};
  const read = f => {
    const v = raw[f.header];
    return v === undefined || v === null ? '' : String(v).replace(/\r\n/g, '\n').trim();
  };
  const stateField = cfg.fields.find(f => f.type === 'state');
  const bornOutside = stateField ? isOutside_(read(stateField)) : false;

  cfg.fields.forEach(f => {
    const v = read(f);
    if (f.type === 'country' && !bornOutside) { values[f.header] = ''; return; }
    if (!v) {
      if (f.required) errors.push({ header: f.header, msg: f.title + ' is required.' });
      values[f.header] = '';
      return;
    }
    if (f.type === 'state') {
      const code = stateCode_(v);
      if (code === OUTSIDE_US && !isOutside_(v)) {
        errors.push({ header: f.header, msg: 'Pick a state from the list.' });
      }
      values[f.header] = code;
      return;
    }
    if (f.type === 'date') {
      const d = parseIsoDate_(v);
      if (!d) { errors.push({ header: f.header, msg: 'Pick a date.' }); values[f.header] = ''; return; }
      values[f.header] = d;
      return;
    }
    if (f.fixed) {
      const hit = (f.seed || []).find(s => norm_(s) === norm_(v));
      if (!hit) {
        errors.push({ header: f.header, msg: 'Pick from the list: ' + (f.seed || []).join(', ') });
        values[f.header] = '';
        return;
      }
      values[f.header] = hit;
      return;
    }
    if (f.rule) {
      const r = RULES[f.rule];
      if (r.number) {
        const n = Number(v.replace(/[$,]/g, ''));
        if (!isFinite(n) || n < r.number[0] || n > r.number[1]) {
          errors.push({ header: f.header, msg: r.msg });
          values[f.header] = '';
          return;
        }
      } else if (!new RegExp('^ *(' + r.re + ') *$').test(v)) {
        errors.push({ header: f.header, msg: r.msg });
        values[f.header] = '';
        return;
      }
      values[f.header] = clean_(f.rule, v);
      return;
    }
    values[f.header] = v;
  });
  return { values: values, errors: errors };
}

const isOutside_ = v => /^(born outside the us|outside us)$/i.test(String(v).trim());

// Appends a checked record to the tab. Returns the row it went to.
function writeNew_(ss, cfg, values, email) {
  const sheet = mustGetSheet_(ss, cfg.tab);
  requireColumns_(sheet, cfg);
  const hdr = headerMap_(sheet);
  const width = sheet.getLastColumn();
  const row = new Array(width).fill('');
  cfg.fields.forEach(f => { row[hdr[norm_(f.header)]] = values[f.header] === undefined ? '' : values[f.header]; });

  // Sales date defaults to today
  if (cfg.tab === SALES_TAB && !row[hdr[norm_('Date')]]) row[hdr[norm_('Date')]] = stripTime_(new Date());
  row[hdr[norm_(SUBMITTED_BY_HEADER)]] = email;

  const target = firstEmptyRow_(sheet, hdr, cfg.fields);
  if (target > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), target - sheet.getMaxRows());
  cfg.fields.filter(f => TEXT_RULES.includes(f.rule))
    .forEach(f => sheet.getRange(target, hdr[norm_(f.header)] + 1).setNumberFormat('@')); // keep leading zeros
  sheet.getRange(target, 1, 1, width).setValues([row]);
  SpreadsheetApp.flush();
  return target;
}

// Where this record's SSN already is, e.g. "Sales row 12", or '' if new.
function dupSsn_(ss, cfg, values) {
  const f = cfg.fields.find(x => x.rule === 'ssn');
  const ssn = f ? values[f.header] : '';
  return ssn ? findSsn_(ss, ssn, cfg) : '';
}

function ssnLast4_(ss, cfg, values) {
  const f = cfg.fields.find(x => x.rule === 'ssn');
  return f ? String(values[f.header]).replace(/\D/g, '').slice(-4) : '';
}

// ---- Validation on the sheet columns -------------------------------------

// Menu: re-apply RULES to the sheet and to any old Google Form still in use.
function updateValidation() {
  const props = PropertiesService.getDocumentProperties();
  const ss = SpreadsheetApp.getActive();
  Object.keys(FORMS).forEach(key => {
    ensureColumns_(mustGetSheet_(ss, FORMS[key].tab), FORMS[key]);
    const id = props.getProperty(key + 'FormId');
    if (!id) return;
    const form = FormApp.openById(id).setConfirmationMessage(CONFIRMATION);
    const items = form.getItems(FormApp.ItemType.TEXT);
    FORMS[key].fields.filter(f => f.rule).forEach(f => {
      const it = items.find(i => i.getTitle() === f.title);
      if (it) applyRule_(it.asTextItem().setHelpText(f.help || ''), f);
    });
  });
  refreshChoices();
  applySheetValidation();
  alert_('Validation updated on the Sales / Dupes tabs.');
}

// Puts a field's RULES check on an old form's text item.
function applyRule_(item, f) {
  const r = RULES[f.rule];
  const v = FormApp.createTextValidation().setHelpText(r.msg);
  if (r.number) v.requireNumberBetween(r.number[0], r.number[1]);
  else v.requireTextMatchesPattern('^ *(' + r.re + ') *$');
  item.setValidation(v.build());
}

// Data validation on the sheet columns, so typing straight into the sheet is checked too.
// Existing cells that break a rule get a red corner; new bad input is refused.
function applySheetValidation() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(FORMS).forEach(key => {
    const cfg = FORMS[key];
    const sheet = mustGetSheet_(ss, cfg.tab);
    const hdr = headerMap_(sheet);
    cfg.fields.forEach(f => {
      if (!f.rule && !f.fixed && f.type !== 'state') return;
      const col = hdr[norm_(f.header)];
      if (col === undefined) return;
      const range = sheet.getRange(2, col + 1, sheet.getMaxRows() - 1, 1);
      const dv = SpreadsheetApp.newDataValidation().setAllowInvalid(false);
      if (f.type === 'state') {
        dv.requireValueInList(US_STATES.map(x => x[0]).concat([OUTSIDE_US]), true)
          .setHelpText('Pick the 2-letter state code, or ' + OUTSIDE_US + '.');
      } else if (f.fixed) {
        dv.requireValueInList(f.seed, true).setHelpText('Pick from the list: ' + f.seed.join(', '));
      } else if (RULES[f.rule].number) {
        dv.requireNumberBetween(RULES[f.rule].number[0], RULES[f.rule].number[1]).setHelpText(RULES[f.rule].msg);
      } else {
        const a1 = sheet.getRange(2, col + 1).getA1Notation();
        let formula = 'REGEXMATCH(TRIM(TO_TEXT(' + a1 + ')),"^(' + RULES[f.rule].re + ')$")';
        let help = RULES[f.rule].msg;
        if (f.rule === 'ssn') {
          formula = 'AND(' + formula + ',' + ssnCountFormula_(ss, a1, cfg) + '=1)';
          help += ' Must not already be on ' + (SSN_UNIQUE_ACROSS_TABS ? 'the Sales or Dupes tab.' : 'this tab.');
        }
        dv.requireFormulaSatisfied('=' + formula).setHelpText(help);
      }
      range.setDataValidation(dv.build());
      if (TEXT_RULES.includes(f.rule)) range.setNumberFormat('@');
    });
  });
}

// Sheet formula: how many times the SSN in cell `a1` appears (digits only compared).
function ssnCountFormula_(ss, a1, cfg) {
  const digits = x => 'REGEXREPLACE(TO_TEXT(' + x + '),"[^0-9]","")';
  return ssnTabs_(cfg).map(c => {
    const f = c.fields.find(x => x.rule === 'ssn');
    const sh = mustGetSheet_(ss, c.tab);
    const letter = sh.getRange(1, headerMap_(sh)[norm_(f.header)] + 1).getA1Notation().replace(/[0-9]/g, '');
    const range = c === cfg ? '$' + letter + '$2:$' + letter
      : 'INDIRECT("\'' + c.tab + '\'!' + letter + '2:' + letter + '")';
    return 'SUMPRODUCT(ARRAYFORMULA(--(' + digits(range) + '=' + digits(a1) + ')))';
  }).join('+');
}

// Tabs an SSN must be unique across.
function ssnTabs_(cfg) {
  return Object.values(FORMS).filter(c => c === cfg || SSN_UNIQUE_ACROSS_TABS)
    .filter(c => c.fields.some(f => f.rule === 'ssn'));
}

// Where this SSN already is, e.g. "Sales row 12", or '' if new.
// Digits only are compared, so 123-45-6789, 123 45 6789 and 123456789 are the same.
function findSsn_(ss, ssn, cfg) {
  const want = String(ssn).replace(/\D/g, '');
  for (const c of ssnTabs_(cfg)) {
    const sh = mustGetSheet_(ss, c.tab);
    const last = sh.getLastRow();
    if (last < 2) continue;
    const col = headerMap_(sh)[norm_(c.fields.find(f => f.rule === 'ssn').header)] + 1;
    const vals = sh.getRange(2, col, last - 1, 1).getDisplayValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).replace(/\D/g, '') === want) return c.tab + ' row ' + (i + 2);
    }
  }
  return '';
}

// Menu: put back the leading zeros Sheets dropped from routing numbers (74908594 -> 074908594).
// A cell is only changed when the padded number passes the bank routing-number checksum;
// anything else that is not 9 digits is listed so it can be checked by hand.
function fixRoutingNumbers() {
  const ss = SpreadsheetApp.getActive();
  const fixed = [], check = [];
  Object.keys(FORMS).forEach(key => {
    const cfg = FORMS[key];
    const f = cfg.fields.find(x => x.rule === 'routing');
    if (!f) return;
    const sheet = mustGetSheet_(ss, cfg.tab);
    const col = headerMap_(sheet)[norm_(f.header)] + 1;
    const last = sheet.getLastRow();
    if (last < 2) return;
    sheet.getRange(2, col, last - 1, 1).getDisplayValues().forEach((r, i) => {
      const raw = String(r[0]).trim();
      if (!raw || /^[0-9]{9}$/.test(raw)) return;
      const d = raw.replace(/\D/g, '');
      const padded = d.length >= 7 && d.length <= 8 ? d.padStart(9, '0') : '';
      const where = cfg.tab + ' row ' + (i + 2);
      if (padded && routingChecksumOk_(padded)) {
        sheet.getRange(i + 2, col).setNumberFormat('@').setValue(padded);
        fixed.push(where + ': ' + raw + ' -> ' + padded);
      } else {
        check.push(where + ': ' + raw);
      }
    });
  });
  const msg = 'Fixed ' + fixed.length + ':\n' + (fixed.join('\n') || '(none)') +
    '\n\nCheck by hand ' + check.length + ':\n' + (check.join('\n') || '(none)');
  Logger.log(msg);
  alert_(msg, 'Routing numbers');
}

// ABA routing-number checksum: 3*(d1+d4+d7) + 7*(d2+d5+d8) + (d3+d6+d9) is a multiple of 10.
function routingChecksumOk_(n) {
  const d = n.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

// Tidy a validated answer before it is written to the sheet.
function clean_(rule, v) {
  v = String(v).replace(/[ \t]+/g, ' ').trim();
  const d = v.replace(/\D/g, '');
  switch (rule) {
    case 'ssn': return d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5);
    case 'phone': case 'routing': case 'account': return d;
    case 'coverage': return v.replace(/ /g, '').toLowerCase();
    case 'premium': return v.replace(/[$,\s]/g, '');
    case 'email': return /^n\/a$/i.test(v) ? 'N/A' : v.toLowerCase();
    default: return v;
  }
}

// ---- Old Google Forms (kept so nothing in flight is lost) -----------------

function onSalesSubmit(e) { handleSubmit_(e, FORMS.sales); }
function onDupesSubmit(e) { handleSubmit_(e, FORMS.dupes); }

function handleSubmit_(e, cfg) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const email = (e.response.getRespondentEmail() || '').toLowerCase().trim();

    if (!staffEmails_(ss).has(email)) {
      reject_(ss, e, cfg, email, 'not on Staff Access list');
      return;
    }

    const byTitle = {};
    cfg.fields.forEach(f => byTitle[f.title] = f);
    const raw = {};
    e.response.getItemResponses().forEach(ir => {
      const f = byTitle[ir.getItem().getTitle()];
      if (f) raw[f.header] = ir.getResponse();
    });

    const prepared = prepare_(cfg, raw);
    if (prepared.errors.length) {
      reject_(ss, e, cfg, email, 'invalid answers (' + prepared.errors.length + ')',
        'Your entry on the "' + cfg.name + '" form was NOT saved:\n\n' +
        prepared.errors.map(x => '- ' + x.msg).join('\n') +
        '\n\nPlease use the staff entry page instead.');
      return;
    }

    const existing = dupSsn_(ss, cfg, prepared.values);
    if (existing) {
      const nameField = cfg.fields.find(f => f.rule === 'name');
      const name = nameField ? prepared.values[nameField.header] : '';
      const last4 = ssnLast4_(ss, cfg, prepared.values);
      reject_(ss, e, cfg, email, 'duplicate SSN ***-**-' + last4 + ' (already in ' + existing + ')',
        'Your entry for ' + (name || 'this customer') + ' on the "' + cfg.name + '" form was NOT saved.\n\n' +
        'The SSN ending ' + last4 + ' is already in ' + existing + '.\n' +
        'If it is the same customer, open the staff entry page and use "Edit a record".');
      return;
    }

    const target = writeNew_(ss, cfg, prepared.values, email);
    logAccess_(ss, email, cfg.name, 'Saved to row ' + target);
    if (DELETE_RESPONSE_AFTER_WRITE) e.source.deleteResponse(e.response.getId());
  } finally {
    lock.releaseLock();
  }
}

// Log the rejection, drop the form response, and (if `notice` is given) email the submitter.
function reject_(ss, e, cfg, email, reason, notice) {
  logAccess_(ss, email || '(no email)', cfg.name, 'REJECTED — ' + reason);
  e.source.deleteResponse(e.response.getId());
  if (notice && EMAIL_ON_REJECT && email) MailApp.sendEmail(email, cfg.name + ' — not saved', notice);
}

// Menu: stop the old forms taking new entries, once staff are on the page.
function closeOldForms() {
  const props = PropertiesService.getDocumentProperties();
  const closed = [];
  Object.keys(FORMS).forEach(key => {
    const id = props.getProperty(key + 'FormId');
    if (!id) return;
    const form = FormApp.openById(id);
    form.setAcceptingResponses(false);
    try { form.setPublished(false); } catch (err) { /* older Forms */ }
    closed.push(FORMS[key].name);
  });
  alert_(closed.length
    ? 'Closed:\n' + closed.join('\n') + '\n\nStaff must use the entry page link from now on.'
    : 'There are no Google Forms set up on this sheet — staff are already using the entry page.');
}

// ---- Choice lists ---------------------------------------------------------

// Menu: push the sheet's current values into any old Google Form still in use.
// (The staff page always reads them live, so it needs no refresh.)
function refreshChoices() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getDocumentProperties();
  Object.keys(FORMS).forEach(key => {
    const id = props.getProperty(key + 'FormId');
    if (!id) return;
    const cfg = FORMS[key];
    const sheet = mustGetSheet_(ss, cfg.tab);
    const items = FormApp.openById(id).getItems(FormApp.ItemType.MULTIPLE_CHOICE);
    cfg.fields.filter(f => f.type === 'choice').forEach(f => {
      const it = items.find(i => i.getTitle() === f.title);
      if (!it) return;
      const vals = choicesFor_(ss, sheet, f);
      it.asMultipleChoiceItem().setChoiceValues(vals.length ? vals : ['(none yet)']).showOtherOption(!f.fixed);
    });
  });
}

// Unique values already in the column (case/spacing-insensitive), most common spelling wins.
// A field with `shared` collects from every tab that has a field with the same tag.
function choicesFor_(ss, sheet, f) {
  if (f.fixed) return f.seed.slice();
  const columns = [];
  if (f.shared) {
    Object.keys(FORMS).forEach(key => {
      const cfg = FORMS[key];
      const twin = cfg.fields.find(x => x.shared === f.shared);
      if (twin) columns.push([mustGetSheet_(ss, cfg.tab), twin.header]);
    });
  }
  if (!columns.length) columns.push([sheet, f.header]);

  const vals = [];
  columns.forEach(([sh, header]) => {
    const col = headerMap_(sh)[norm_(header)];
    const last = sh.getLastRow();
    if (col === undefined || last < 2) return;
    sh.getRange(2, col + 1, last - 1, 1).getDisplayValues().forEach(r => vals.push(r[0]));
  });

  const groups = new Map();
  (f.seed || []).concat(vals).forEach(v => {
    const clean = String(v).replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const key = clean.toLowerCase().replace(/\s*\/\s*/g, '/');
    if (!groups.has(key)) groups.set(key, new Map());
    const g = groups.get(key);
    g.set(clean, (g.get(clean) || 0) + 1);
  });
  return [...groups.values()]
    .map(g => [...g.entries()].sort((a, b) => b[1] - a[1])[0][0])
    .sort((a, b) => a.localeCompare(b));
}

// ---- Staff list and access codes -----------------------------------------

// A staff member is recognised by their Google account (Workspace accounts in your own
// domain) or, failing that, by the access code on the "Staff Access" tab.
function findStaff_(ss, code) {
  const rows = staffRows_(ss);
  let email = '';
  try { email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim(); } catch (err) { email = ''; }
  if (email) {
    const byEmail = rows.find(r => r.email === email);
    if (byEmail) return byEmail;
  }
  const want = String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (want.length >= 6) {
    const byCode = rows.find(r => r.code && r.code === want);
    if (byCode) return byCode;
  }
  return null;
}

function staffRows_(ss) {
  const sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const codeCol = headerMap_(sh)[norm_(STAFF_CODE_HEADER)];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues().map(r => ({
    email: String(r[0]).toLowerCase().trim(),
    name: String(r[1] || '').trim(),
    code: codeCol === undefined ? '' : String(r[codeCol] || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
  })).filter(r => r.email);
}

function staffEmails_(ss) {
  return new Set(staffRows_(ss).map(r => r.email));
}

// Gives every staff member without one a code. Existing codes are never changed.
function refreshStaffCodes_(ss) {
  const sh = ensureStaffTab_(ss);
  const col = headerMap_(sh)[norm_(STAFF_CODE_HEADER)] + 1;
  const last = sh.getLastRow();
  if (last < 2) return;
  const emails = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  const codes = sh.getRange(2, col, last - 1, 1).getDisplayValues();
  const used = new Set(codes.map(c => String(c[0]).trim().toUpperCase()).filter(Boolean));
  let changed = false;
  emails.forEach((e, i) => {
    if (!String(e[0]).trim() || String(codes[i][0]).trim()) return;
    let code;
    do { code = randomCode_(); } while (used.has(code));
    used.add(code);
    codes[i][0] = code;
    changed = true;
  });
  if (changed) sh.getRange(2, col, last - 1, 1).setNumberFormat('@').setValues(codes);
}

// No 0/O/1/I, so codes can be read out over the phone.
function randomCode_() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}

function showStaffCodes() {
  const ss = SpreadsheetApp.getActive();
  refreshStaffCodes_(ss);
  const rows = staffRows_(ss);
  alert_(rows.length
    ? rows.map(r => (r.name ? r.name + ' — ' : '') + r.email + ': ' + (r.code || '(no code)')).join('\n') +
      '\n\nSend each person their own code with the page link. They enter it once per device.'
    : 'No staff yet. Add their Google emails on the "' + STAFF_TAB + '" tab, then run this again.',
    'Staff access codes');
}

// ---- Helpers --------------------------------------------------------------

function showLinks() {
  const url = ScriptApp.getService().getUrl();
  const props = PropertiesService.getDocumentProperties();
  const old = Object.keys(FORMS)
    .filter(key => props.getProperty(key + 'FormId'))
    .map(key => FORMS[key].name + ': ' + FormApp.openById(props.getProperty(key + 'FormId')).getPublishedUrl());
  const msg = (url
    ? 'STAFF PAGE (share this one link):\n' + url
    : 'The staff page is not deployed yet.\n\nDeploy -> New deployment -> type "Web app",\n' +
      'Execute as: Me, Who has access: Anyone with a Google account -> Deploy,\n' +
      'then run this menu item again to see the link.') +
    (old.length ? '\n\nOld Google Forms (still live):\n' + old.join('\n') +
      '\nUse "Close the old Google Forms" when staff have moved over.' : '');
  Logger.log(msg);
  alert_(msg, 'Ironclad staff entry');
}

function ensureStaffTab_(ss) {
  let sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) {
    sh = ss.insertSheet(STAFF_TAB);
    sh.getRange(1, 1, 1, 3).setValues([['Staff Email (Google account)', 'Name', STAFF_CODE_HEADER]]).setFontWeight('bold');
    sh.setColumnWidth(1, 280);
    sh.getRange(2, 1).setValue(Session.getEffectiveUser().getEmail());
  }
  ensureColumn_(sh, STAFF_CODE_HEADER);
  return sh;
}

function ensureLogTab_(ss) {
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['Time', 'Email', 'What', 'Result']]).setFontWeight('bold');
  }
  return sh;
}

function logAccess_(ss, email, what, result) {
  ensureLogTab_(ss).appendRow([new Date(), email, what, result]);
}

// Adds the columns the script owns: "Submitted By", "Country of Birth", and any field
// with `after` (Carrier on the Dupes tab).
function ensureColumns_(sheet, cfg) {
  ensureColumn_(sheet, SUBMITTED_BY_HEADER);
  cfg.fields.forEach(f => {
    if (f.after) ensureColumnAfter_(sheet, f.header, f.after);
    else if (f.type === 'country') ensureColumn_(sheet, f.header);
  });
}

function ensureColumn_(sheet, header) {
  const hdr = headerMap_(sheet);
  if (hdr[norm_(header)] !== undefined) return;
  const vals = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getDisplayValues()[0];
  let lastUsed = 0;
  vals.forEach((v, i) => { if (String(v).trim()) lastUsed = i + 1; });
  if (lastUsed >= sheet.getMaxColumns()) sheet.insertColumnAfter(lastUsed);
  sheet.getRange(1, lastUsed + 1).setValue(header).setFontWeight('bold');
}

// Inserts a new column straight after `afterHeader`, taking that header's formatting.
function ensureColumnAfter_(sheet, header, afterHeader) {
  const hdr = headerMap_(sheet);
  if (hdr[norm_(header)] !== undefined) return;
  const at = hdr[norm_(afterHeader)];
  if (at === undefined) return ensureColumn_(sheet, header);
  sheet.insertColumnAfter(at + 1);
  sheet.getRange(1, at + 1).copyTo(sheet.getRange(1, at + 2), { formatOnly: true });
  sheet.getRange(1, at + 2).setValue(header).setFontWeight('bold');
}

// Stops a half-set-up sheet writing values into the wrong columns.
function requireColumns_(sheet, cfg) {
  const hdr = headerMap_(sheet);
  const missing = cfg.fields.map(f => f.header).concat([SUBMITTED_BY_HEADER])
    .filter(h => hdr[norm_(h)] === undefined);
  if (missing.length) {
    throw new Error('Columns missing on "' + sheet.getName() + '": ' + missing.join(', ') +
      '. Run "Ironclad Forms" -> "Set up / update everything".');
  }
}

function headerMap_(sheet) {
  const vals = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const m = {};
  vals.forEach((v, i) => { const k = norm_(v); if (k && m[k] === undefined) m[k] = i; });
  return m;
}

// Row after the last row that has anything in the entry columns
// (ignores formula-only / formatted blank rows further down).
function firstEmptyRow_(sheet, hdr, fields) {
  const last = sheet.getLastRow();
  if (last < 2) return 2;
  const data = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
  const cols = fields.map(f => hdr[norm_(f.header)]).filter(c => c !== undefined);
  for (let r = data.length - 1; r >= 0; r--) {
    if (cols.some(c => String(data[r][c]).trim() !== '')) return r + 3;
  }
  return 2;
}

function mustGetSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" not found. Check the tab name matches exactly.');
  return sh;
}

function norm_(s) { return String(s).replace(/\s+/g, ' ').trim().toLowerCase(); }

function stripTime_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

// yyyy-MM-dd from a date input (falls back to the looser parser).
function parseIsoDate_(v) {
  const m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return parseLooseDate_(v);
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}

// Reads a date already in the sheet. 24/11/1947 is read day-first, 8/10/1984 month-first.
function parseLooseDate_(s) {
  const t = String(s).trim();
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!m) return null;
  const a = +m[1], b = +m[2];
  let y = +m[3];
  if (y < 100) y += y < 50 ? 2000 : 1900;
  let month = a, day = b;
  if (a > 12 && b <= 12) { month = b; day = a; }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(y, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function alert_(msg, title) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(title || 'Ironclad', msg, ui.ButtonSet.OK);
  } catch (err) {
    Logger.log(msg);
  }
}

// ---- The page itself ------------------------------------------------------

function pageHtml_() {
  return [
    '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8">',
    '<style>' + css_() + '</style></head><body>',
    '<header><h1>' + APP_TITLE + '</h1></header>',
    '<div id="note" class="note hidden"></div>',
    '<div id="busy" class="busy hidden">Working…</div>',
    '<main id="main"><p class="muted">Loading…</p></main>',
    '<script>' + clientJs_() + '</scr' + 'ipt>',
    '</body></html>',
  ].join('\n');
}

function css_() {
  return `
:root{color-scheme:light;--ink:#16181d;--muted:#6b7280;--line:#dfe3ea;--bg:#f4f6fa;--card:#fff;--brand:#1f4ed8;--good:#0f7b4f;--bad:#b4232c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
header{background:#101828;color:#fff;padding:14px 16px}
header h1{margin:0;font-size:16px;font-weight:600}
main{max-width:720px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
h2{margin:0 0 4px;font-size:18px}
.muted{color:var(--muted);margin:0 0 14px;font-size:13px}
.who{max-width:720px;margin:0 auto 12px;font-size:13px;color:var(--muted)}
.tiles{display:grid;gap:12px}
.tile{display:block;width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--brand);border-radius:10px;padding:14px 16px;font:inherit;cursor:pointer}
.tile strong{display:block;font-size:16px}
.tile span{color:var(--muted);font-size:13px}
.field{display:block;margin:0 0 12px}
.field>span{display:block;font-weight:600;font-size:13px;margin-bottom:4px}
.field em{color:var(--bad);font-style:normal;font-weight:500;font-size:12px}
input,select,textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:7px;background:#fff;font:inherit}
input:disabled,textarea:disabled,select:disabled{background:#f1f2f6;color:var(--muted)}
input.bad,select.bad,textarea.bad{border-color:var(--bad);background:#fff7f7}
.help{display:block;color:var(--muted);font-size:12px;margin-top:3px}
.err{display:block;color:var(--bad);font-size:12px;margin-top:3px}
.other{margin-top:6px}
.row{display:flex;gap:10px;align-items:center;margin-top:14px}
.crumb{margin-bottom:8px}
button.primary{background:var(--brand);color:#fff;border:0;border-radius:7px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer}
button.link{background:none;border:0;color:var(--brand);font:inherit;padding:4px;cursor:pointer}
.note{max-width:720px;margin:12px auto 0;padding:10px 12px;border-radius:8px;font-size:14px}
.note.info{background:#eef2ff;border:1px solid #d3dcfb}
.note.good{background:#e7f6ee;border:1px solid #bfe5d1;color:var(--good)}
.note.bad{background:#fdeceb;border:1px solid #f5c6c4;color:var(--bad)}
.busy{max-width:720px;margin:12px auto 0;padding:0 16px;color:var(--muted);font-size:13px}
.hidden{display:none !important}
@media(max-width:520px){main{padding:12px}}
`;
}

function clientJs_() {
  return `
var BOOT = null, CODE = '', VIEW = {};
var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
function setMain(html) { $('main').innerHTML = html; window.scrollTo(0, 0); }
function busy(on) { $('busy').className = on ? 'busy' : 'busy hidden'; }
function note(msg, kind) {
  var el = $('note');
  el.textContent = msg || '';
  el.className = msg ? 'note ' + (kind || 'info') : 'note hidden';
}
function fail(err) { busy(false); note((err && err.message) || 'Something went wrong — please try again.', 'bad'); }
function run(name, arg, done) {
  busy(true);
  google.script.run
    .withSuccessHandler(function (res) { busy(false); done(res || {}); })
    .withFailureHandler(fail)[name](arg);
}

// ---- sign in

function start() {
  try { CODE = window.localStorage.getItem('ironclad.code') || ''; } catch (e) { CODE = ''; }
  run('webBoot', CODE, onBoot);
}

function onBoot(res) {
  if (!res.ok) { renderGate(res.message); return; }
  BOOT = res;
  renderHome();
}

function renderGate(msg) {
  BOOT = null;
  note(msg, msg ? 'bad' : '');
  setMain('<div class="card"><h2>Staff sign in</h2>' +
    '<p class="muted">Enter the access code your manager gave you. This device will remember it.</p>' +
    '<label class="field"><span>Access code</span>' +
    '<input id="code" type="text" autocomplete="off" spellcheck="false"></label>' +
    '<div class="row"><button class="primary" data-go="code">Continue</button></div></div>');
  var box = $('code');
  box.value = CODE;
  box.focus();
  box.onkeydown = function (ev) { if (ev.key === 'Enter') submitCode(); };
}

function submitCode() {
  CODE = ($('code').value || '').trim().toUpperCase();
  try { window.localStorage.setItem('ironclad.code', CODE); } catch (e) {}
  note('');
  run('webBoot', CODE, onBoot);
}

function signOut() {
  CODE = '';
  try { window.localStorage.removeItem('ironclad.code'); } catch (e) {}
  renderGate('');
}

// ---- main page

function renderHome() {
  note('');
  VIEW = {};
  var tiles = BOOT.data.order.map(function (key) {
    var f = BOOT.data.forms[key];
    return tile('new:' + key, f.label, f.blurb);
  });
  tiles.push(tile('search', 'Edit a record',
    'Enter the full SSN to open that Sale or Call Back and change it.'));
  setMain('<div class="who">Signed in as ' + esc(BOOT.staff.name || BOOT.staff.email) +
    ' <button class="link" data-go="signout">change</button></div>' +
    '<div class="tiles">' + tiles.join('') + '</div>');
}

function tile(go, title, blurb) {
  return '<button class="tile" data-go="' + go + '"><strong>' + esc(title) + '</strong><span>' +
    esc(blurb) + '</span></button>';
}

// ---- entry / edit form

function fieldsFor(key) { return BOOT.data.forms[key].fields; }
function fieldBy(key, header) {
  return fieldsFor(key).filter(function (f) { return f.header === header; })[0];
}
function inputId(f) { return 'in_' + f.header.replace(/[^A-Za-z0-9]/g, '_'); }
function ssnHeader(key) {
  var hit = fieldsFor(key).filter(function (f) { return f.rule === 'ssn'; })[0];
  return hit ? hit.header : '';
}

function openNew(key) { note(''); renderForm(key, null); }

function renderForm(key, record) {
  var form = BOOT.data.forms[key];
  var values = record ? record.values : {};
  var rows = form.fields.map(function (f) {
    return fieldHtml(f, values[f.header], !!(record && f.rule === 'ssn'));
  });
  var heading = record ? 'Edit — ' + esc(record.label) : esc(form.label);
  var sub = record ? esc(record.sub) + ' · the SSN is the key and cannot be changed here'
    : esc(form.blurb);
  setMain('<div class="card">' +
    '<div class="crumb"><button class="link" data-go="home">&larr; Main page</button></div>' +
    '<h2>' + heading + '</h2><p class="muted">' + sub + '</p>' +
    rows.join('') +
    '<div class="row"><button class="primary" data-go="' + (record ? 'save' : 'submit') + '">' +
    (record ? 'Save changes' : 'Submit') + '</button>' +
    '<button class="link" data-go="home">Cancel</button></div></div>');
  VIEW = { key: key, record: record || null, matches: VIEW.matches };
  wireForm(key, values);
}

function fieldHtml(f, value, locked) {
  var id = inputId(f);
  var v = value == null ? '' : String(value);
  var dis = locked ? ' disabled' : '';
  var body;
  if (f.type === 'para') {
    body = '<textarea id="' + id + '" rows="3"' + dis + '>' + esc(v) + '</textarea>';
  } else if (f.type === 'date') {
    body = '<input id="' + id + '" type="date" value="' + esc(v) + '"' + dis + '>';
  } else if (f.type === 'state') {
    body = selectHtml(id, BOOT.data.states, v, false, locked);
  } else if (f.type === 'choice') {
    body = selectHtml(id, f.choices, v, !f.fixed, locked) +
      (f.fixed ? '' : '<input class="other hidden" id="' + id + '_other" type="text" placeholder="Type the new value">');
  } else {
    body = '<input id="' + id + '" type="text" value="' + esc(v) + '"' + dis + '>';
  }
  return '<label class="field' + (f.type === 'country' ? ' country hidden' : '') + '" id="row_' + id + '">' +
    '<span>' + esc(f.title) + (f.required ? ' <em>required</em>' : '') + '</span>' + body +
    (f.help ? '<span class="help">' + esc(f.help) + '</span>' : '') +
    '<span class="err" id="err_' + id + '"></span></label>';
}

// A value already in the sheet that is not on the list is added to it, so opening a
// record and saving it can never quietly drop what is there.
function selectHtml(id, choices, value, allowOther, locked) {
  var opts = ['<option value=""></option>'];
  var found = false;
  (choices || []).forEach(function (c) {
    if (c === value) found = true;
    opts.push('<option value="' + esc(c) + '"' + (c === value ? ' selected' : '') + '>' + esc(c) + '</option>');
  });
  if (!found && value) opts.push('<option value="' + esc(value) + '" selected>' + esc(value) + '</option>');
  if (allowOther) opts.push('<option value="__other">Other…</option>');
  return '<select id="' + id + '"' + (locked ? ' disabled' : '') + '>' + opts.join('') + '</select>';
}

function wireForm(key, values) {
  fieldsFor(key).forEach(function (f) {
    var el = $(inputId(f));
    if (!el) return;
    if (f.type === 'choice' && !f.fixed) {
      var other = $(inputId(f) + '_other');
      el.onchange = function () {
        if (el.value === '__other') { other.className = 'other'; other.focus(); }
        else { other.className = 'other hidden'; other.value = ''; }
      };
    }
    if (f.type === 'state') el.onchange = toggleCountry;
  });
  toggleCountry();
}

function toggleCountry() {
  var fields = fieldsFor(VIEW.key);
  var st = fields.filter(function (f) { return f.type === 'state'; })[0];
  var co = fields.filter(function (f) { return f.type === 'country'; })[0];
  if (!st || !co) return;
  var sel = $(inputId(st));
  var row = $('row_' + inputId(co));
  if (row) row.className = 'field country' + (sel && sel.value === BOOT.data.outside ? '' : ' hidden');
}

function collect(key) {
  var out = {};
  fieldsFor(key).forEach(function (f) {
    var el = $(inputId(f));
    if (!el) return;
    var v = el.value;
    if (f.type === 'choice' && v === '__other') {
      var other = $(inputId(f) + '_other');
      v = other ? other.value : '';
    }
    out[f.header] = v == null ? '' : String(v).trim();
  });
  return out;
}

// The same RULES the server and the sheet use, checked here first so mistakes are
// caught before anything is sent.
function clientCheck(key, values) {
  var fields = fieldsFor(key);
  var st = fields.filter(function (f) { return f.type === 'state'; })[0];
  var outside = st ? values[st.header] === BOOT.data.outside : false;
  var bad = [];
  fields.forEach(function (f) {
    clearErr(f);
    if (f.type === 'country' && !outside) return;
    var v = values[f.header] || '';
    if (!v) {
      if (f.required) bad.push({ header: f.header, msg: f.title + ' is required.' });
      return;
    }
    var r = f.rule ? BOOT.data.rules[f.rule] : null;
    if (!r) return;
    if (r.number) {
      var n = Number(v.replace(/[$,]/g, ''));
      if (!isFinite(n) || n < r.number[0] || n > r.number[1]) bad.push({ header: f.header, msg: r.msg });
    } else if (r.re && !new RegExp('^ *(' + r.re + ') *$').test(v)) {
      bad.push({ header: f.header, msg: r.msg });
    }
  });
  return bad;
}

function clearErr(f) {
  var e = $('err_' + inputId(f));
  if (e) e.textContent = '';
  var i = $(inputId(f));
  if (i) i.className = i.className.replace(/ ?bad/g, '');
}

function showErrs(key, list) {
  var first = null;
  list.forEach(function (b) {
    var f = fieldBy(key, b.header);
    if (!f) return;
    var e = $('err_' + inputId(f));
    if (e) e.textContent = b.msg;
    var i = $(inputId(f));
    if (i && i.className.indexOf('bad') < 0) i.className = (i.className + ' bad').trim();
    if (!first) first = i;
  });
  if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center' });
}

function submitNew() {
  var key = VIEW.key;
  var values = collect(key);
  var bad = clientCheck(key, values);
  if (bad.length) { showErrs(key, bad); note('Please fix the fields marked below.', 'bad'); return; }
  note('');
  run('webSubmit', { code: CODE, form: key, values: values }, function (res) {
    if (!res.ok) {
      if (res.needCode) { renderGate(res.message); return; }
      if (res.errors) showErrs(key, res.errors);
      note(res.message || 'Not saved.', 'bad');
      return;
    }
    renderForm(key, null);
    note(res.message + ' The form below is empty, ready for the next one.', 'good');
  });
}

function saveEdit() {
  var key = VIEW.key, record = VIEW.record;
  var values = collect(key);
  var bad = clientCheck(key, values);
  if (bad.length) { showErrs(key, bad); note('Please fix the fields marked below.', 'bad'); return; }
  note('');
  run('webSave', { code: CODE, key: key, row: record.row, ssn: values[ssnHeader(key)], values: values },
    function (res) {
      if (!res.ok) {
        if (res.needCode) { renderGate(res.message); return; }
        if (res.errors) showErrs(key, res.errors);
        note(res.message || 'Not saved.', 'bad');
        return;
      }
      renderForm(key, res.record || record);
      note(res.message, 'good');
    });
}

// ---- find a record by SSN

function openSearch() {
  note('');
  VIEW = { key: null, record: null, matches: null };
  setMain('<div class="card">' +
    '<div class="crumb"><button class="link" data-go="home">&larr; Main page</button></div>' +
    '<h2>Edit a record</h2>' +
    '<p class="muted">Records are found by SSN only — enter all 9 digits of the customer whose row you want to change.</p>' +
    '<label class="field"><span>SSN</span>' +
    '<input id="ssn" type="text" inputmode="numeric" autocomplete="off" placeholder="123-45-6789"></label>' +
    '<div class="row"><button class="primary" data-go="lookup">Find record</button>' +
    '<button class="link" data-go="home">Cancel</button></div></div>');
  var box = $('ssn');
  box.focus();
  box.onkeydown = function (ev) { if (ev.key === 'Enter') doLookup(); };
}

function doLookup() {
  note('');
  run('webLookup', { code: CODE, ssn: ($('ssn').value || '').trim() }, function (res) {
    if (!res.ok) {
      if (res.needCode) { renderGate(res.message); return; }
      note(res.message, 'bad');
      return;
    }
    VIEW.matches = res.matches;
    if (res.matches.length === 1) openRecord(0);
    else renderPicker();
  });
}

function renderPicker() {
  var items = VIEW.matches.map(function (m, i) { return tile('pick:' + i, m.label, m.sub); });
  setMain('<div class="card">' +
    '<div class="crumb"><button class="link" data-go="search">&larr; Search again</button></div>' +
    '<h2>That SSN is on more than one row</h2><p class="muted">Pick the record to edit.</p>' +
    '<div class="tiles">' + items.join('') + '</div></div>');
}

function openRecord(i) {
  var m = VIEW.matches[i];
  note('');
  renderForm(m.key, m);
}

// ---- wiring

document.addEventListener('click', function (ev) {
  var el = ev.target && ev.target.closest ? ev.target.closest('[data-go]') : null;
  if (!el) return;
  var p = el.getAttribute('data-go').split(':');
  if (p[0] === 'new') openNew(p[1]);
  else if (p[0] === 'home') renderHome();
  else if (p[0] === 'search') openSearch();
  else if (p[0] === 'pick') openRecord(Number(p[1]));
  else if (p[0] === 'lookup') doLookup();
  else if (p[0] === 'submit') submitNew();
  else if (p[0] === 'save') saveEdit();
  else if (p[0] === 'code') submitCode();
  else if (p[0] === 'signout') signOut();
});

window.addEventListener('load', start);
`;
}
