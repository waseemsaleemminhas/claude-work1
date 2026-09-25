/**
 * Ironclad Tech — Staff entry forms for the Sales and "Dupes Call backs" tabs.
 *
 * Paste this whole file into the Google Sheet: Extensions -> Apps Script -> Code.gs,
 * Save, then run `setup` once (approve the permission prompts).
 *
 * What it does
 *  - Builds two Google Forms: "Ironclad — Sales Entry" and "Ironclad — Dupes / Call Back Entry".
 *  - Respondents must sign in with Google (verified email).
 *  - Each submission is checked against the "Staff Access" tab. Only listed emails
 *    get written; anyone else is logged to "Access Log" (email + time only) and dropped.
 *  - Accepted submissions are appended to the Sales / Dupes Call backs tab under the
 *    matching headers, so Summary formulas keep working. No "Form Responses" tab is created.
 *  - Choice questions list the values already in the sheet, plus an "Other" box for new
 *    entries. New entries are added to the list automatically every night (and on demand
 *    via the "Ironclad Forms" menu -> Refresh choice lists). Gender, Smoker and Account Type
 *    are fixed lists with no "Other" box.
 *  - Validation (see RULES): the forms refuse badly formatted phone, SSN, email, routing /
 *    account numbers etc. before they can be submitted, and the same rules are put on the
 *    sheet columns (Data validation) so direct typing in the sheet is checked too.
 *  - Duplicate SSN: a submission whose SSN is already on the tab is NOT saved. It is logged
 *    in "Access Log" (last 4 digits only) and the staff member gets an email saying why.
 *
 *  - State Born In is a dropdown of US states and territories (stored as the 2-letter code),
 *    plus "Born outside the US" (stored as "Outside US").
 *
 * Already set up? After pasting this version, run "Ironclad Forms" -> "Update validation"
 * once (approve the new email permission). It updates the existing forms in place;
 * the form links do not change.
 */

// ---- Settings -------------------------------------------------------------

const SALES_TAB = 'Sales';
const DUPES_TAB = 'Dupes Call backs';
const STAFF_TAB = 'Staff Access';
const LOG_TAB = 'Access Log';
const SUBMITTED_BY_HEADER = 'Submitted By';

// Delete each response from the Form after it is safely written to the sheet,
// so SSN/bank data is stored in one place only (the sheet).
const DELETE_RESPONSE_AFTER_WRITE = true;

// false: each tab is checked on its own (a Call Back can later become a Sale).
// true:  an SSN already on either tab is rejected.
const SSN_UNIQUE_ACROSS_TABS = false;

// Email the staff member when their submission is rejected as a duplicate SSN.
const EMAIL_ON_REJECT = true;

const CONFIRMATION = 'Submitted. If it could not be saved (for example a duplicate SSN) you will get an email within a minute.';

// Format checks. `re` must match the whole answer (spaces at the ends are ignored).
// Used by the forms (checked before submit) and by the sheet's Data validation.
const RULES = {
  name: { re: "[A-Za-z][A-Za-z .,'-]*[A-Za-z.]", msg: 'Letters only (spaces, . , \' - allowed).' },
  phone: { re: '[(]?[2-9][0-9]{2}[)]?[ .-]?[0-9]{3}[ .-]?[0-9]{4}', msg: 'US phone, 10 digits, e.g. 2107257036 or (210) 725-7036.' },
  email: { re: 'N/A|n/a|[^@ ]+@[^@ ]+[.][A-Za-z]{2,}', msg: 'A valid email, or N/A if none.' },
  coverage: { re: '[0-9]+([.][0-9]+)? ?[kK]', msg: 'Amount in thousands, e.g. 5k or 15k.' },
  premium: { number: [1, 10000], msg: 'Monthly premium in dollars, numbers only, e.g. 45.50.' },
  ssn: { re: '[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{4}', msg: 'SSN: 9 digits, e.g. 123-45-6789.' },
  routing: { re: '[0-9]{9}', msg: 'Routing number: exactly 9 digits (keep leading zeros).' },
  account: { re: '[0-9]{4,17}', msg: 'Account number: 4 to 17 digits, numbers only.' },
  heightWeight: { re: '[3-7]([.][0-9]{1,2})?/[0-9]{2,3}', msg: 'Feet.inches/pounds, e.g. 5.9/138 or 5.11/260.' },
};

// "State Born In" dropdown. The form shows "Texas (TX)"; the sheet stores the code "TX".
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
const stateChoices_ = () => US_STATES.map(([c, n]) => n + ' (' + c + ')').concat(['Born outside the US']);
const stateCode_ = v => (String(v).match(/\(([A-Z]{2})\)$/) || [])[1] || OUTSIDE_US;

// Stored as plain text in the sheet so leading zeros are kept.
const TEXT_RULES = ['ssn', 'routing', 'account'];

// type: text | para | date | choice ;  header = exact column header in the sheet
const SALES_FIELDS = [
  { header: 'Date', title: 'Sale Date', type: 'date', help: 'Leave blank to use today.' },
  { header: 'Full Name', title: 'Full Name', type: 'text', required: true, rule: 'name' },
  { header: 'Phone', title: 'Phone', type: 'text', required: true, rule: 'phone' },
  { header: 'Address', title: 'Address', type: 'para' },
  { header: 'Email', title: 'Email', type: 'text', rule: 'email', help: 'Write N/A if none.' },
  { header: 'Gender', title: 'Gender', type: 'choice', seed: ['Male', 'Female'], fixed: true },
  { header: 'State Born in', title: 'State Born In', type: 'state' },
  { header: 'Date Of Birth', title: 'Date of Birth', type: 'date' },
  { header: 'Coverage', title: 'Coverage', type: 'text', rule: 'coverage', help: 'e.g. 5k' },
  { header: 'Carrier', title: 'Carrier', type: 'choice' },
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
  { header: 'DOB', title: 'Date of Birth', type: 'date' },
  { header: 'EXISTING INS', title: 'Existing Insurance', type: 'text' },
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
  sales: { tab: SALES_TAB, fields: SALES_FIELDS, name: 'Ironclad — Sales Entry', handler: 'onSalesSubmit' },
  dupes: { tab: DUPES_TAB, fields: DUPES_FIELDS, name: 'Ironclad — Dupes / Call Back Entry', handler: 'onDupesSubmit' },
};

// ---- Menu -----------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ironclad Forms')
    .addItem('Set up forms (run once)', 'setup')
    .addItem('Refresh choice lists', 'refreshChoices')
    .addItem('Update validation (forms + sheet)', 'updateValidation')
    .addItem('Fix routing numbers (lost leading zeros)', 'fixRoutingNumbers')
    .addItem('Show form links', 'showLinks')
    .addToUi();
}

// ---- Setup ----------------------------------------------------------------

function setup() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getDocumentProperties();
  ensureStaffTab_(ss);
  ensureLogTab_(ss);

  Object.keys(FORMS).forEach(key => {
    const cfg = FORMS[key];
    const sheet = mustGetSheet_(ss, cfg.tab);
    ensureSubmittedByColumn_(sheet);
    if (props.getProperty(key + 'FormId')) return; // already built

    const form = FormApp.create(cfg.name);
    form.setDescription('Ironclad Tech staff only. You must be signed in with the Google account on the staff list.')
      .setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED)
      .setAllowResponseEdits(false)
      .setPublishingSummary(false) // never show other people's answers
      .setShowLinkToRespondAgain(true)
      .setConfirmationMessage(CONFIRMATION);
    try { form.setPublished(true); } catch (e) { /* older Forms: already live */ }

    buildItems_(form, cfg.fields, sheet);
    DriveApp.getFileById(form.getId()).moveTo(DriveApp.getFileById(ss.getId()).getParents().next());

    ScriptApp.newTrigger(cfg.handler).forForm(form).onFormSubmit().create();
    props.setProperty(key + 'FormId', form.getId());
  });

  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'refreshChoices')) {
    ScriptApp.newTrigger('refreshChoices').timeBased().everyDays(1).atHour(2).create();
  }
  applySheetValidation();
  showLinks();
}

function buildItems_(form, fields, sheet) {
  const hdr = headerMap_(sheet);
  fields.forEach(f => {
    if (hdr[norm_(f.header)] === undefined) throw new Error('Column "' + f.header + '" not found on ' + sheet.getName());
    let item;
    switch (f.type) {
      case 'para': item = form.addParagraphTextItem(); break;
      case 'date': item = form.addDateItem(); break;
      case 'state': item = form.addListItem().setChoiceValues(stateChoices_()); break;
      case 'choice':
        item = form.addMultipleChoiceItem();
        item.setChoiceValues(choicesFor_(sheet, f)).showOtherOption(!f.fixed);
        break;
      default: item = form.addTextItem();
    }
    item.setTitle(f.title).setRequired(!!f.required);
    if (f.help) item.setHelpText(f.help);
    if (f.rule) applyRule_(item, f);
  });
}

// Puts the field's RULES check on a form text item.
function applyRule_(item, f) {
  const r = RULES[f.rule];
  const v = FormApp.createTextValidation().setHelpText(r.msg);
  if (r.number) v.requireNumberBetween(r.number[0], r.number[1]);
  else v.requireTextMatchesPattern('^ *(' + r.re + ') *$');
  item.setValidation(v.build());
}

// ---- Validation -----------------------------------------------------------

// Menu: re-apply RULES to the already-built forms and to the sheet. Safe to run again.
function updateValidation() {
  const props = PropertiesService.getDocumentProperties();
  Object.keys(FORMS).forEach(key => {
    const id = props.getProperty(key + 'FormId');
    if (!id) return;
    const form = FormApp.openById(id).setConfirmationMessage(CONFIRMATION);
    const items = form.getItems(FormApp.ItemType.TEXT);
    FORMS[key].fields.filter(f => f.rule).forEach(f => {
      const it = items.find(i => i.getTitle() === f.title);
      if (it) applyRule_(it.asTextItem().setHelpText(f.help || ''), f);
    });
    FORMS[key].fields.filter(f => f.type === 'state').forEach(f => makeStateDropdown_(form, f));
  });
  refreshChoices(); // removes "Other" from the fixed lists
  applySheetValidation();
  try { SpreadsheetApp.getUi().alert('Validation updated on both forms and the Sales / Dupes tabs.'); } catch (e) {}
}

// Turns the form's old "State Born In" text box into the dropdown, in the same position.
function makeStateDropdown_(form, f) {
  const old = form.getItems().find(i => i.getTitle() === f.title);
  if (old && old.getType() === FormApp.ItemType.LIST) {
    old.asListItem().setChoiceValues(stateChoices_());
    return;
  }
  const item = form.addListItem().setTitle(f.title).setRequired(!!f.required).setChoiceValues(stateChoices_());
  if (f.help) item.setHelpText(f.help);
  if (!old) return;
  const index = old.getIndex();
  form.deleteItem(old);
  form.moveItem(item, index);
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
      const col = hdr[norm_(f.header)] + 1;
      const range = sheet.getRange(2, col, sheet.getMaxRows() - 1, 1);
      const dv = SpreadsheetApp.newDataValidation().setAllowInvalid(false);
      if (f.type === 'state') {
        dv.requireValueInList(US_STATES.map(x => x[0]).concat([OUTSIDE_US]), true)
          .setHelpText('Pick the 2-letter state code, or ' + OUTSIDE_US + '.');
      } else if (f.fixed) {
        dv.requireValueInList(f.seed, true).setHelpText('Pick from the list: ' + f.seed.join(', '));
      } else if (RULES[f.rule].number) {
        dv.requireNumberBetween(RULES[f.rule].number[0], RULES[f.rule].number[1]).setHelpText(RULES[f.rule].msg);
      } else {
        const a1 = sheet.getRange(2, col).getA1Notation();
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

// Forms whose tabs an SSN must be unique across.
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
  try { SpreadsheetApp.getUi().alert('Routing numbers', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}

// ABA routing-number checksum: 3*(d1+d4+d7) + 7*(d2+d5+d8) + (d3+d6+d9) is a multiple of 10.
function routingChecksumOk_(n) {
  const d = n.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

// Tidy a validated answer before it is written to the sheet.
function clean_(rule, v) {
  v = String(v).replace(/\s+/g, ' ').trim();
  const d = v.replace(/\D/g, '');
  switch (rule) {
    case 'ssn': return d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5);
    case 'phone': case 'routing': case 'account': return d;
    case 'coverage': return v.replace(/ /g, '').toLowerCase();
    case 'email': return /^n\/a$/i.test(v) ? 'N/A' : v.toLowerCase();
    default: return v;
  }
}

// ---- Submit handlers ------------------------------------------------------

function onSalesSubmit(e) { handleSubmit_(e, FORMS.sales); }
function onDupesSubmit(e) { handleSubmit_(e, FORMS.dupes); }

function handleSubmit_(e, cfg) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const email = (e.response.getRespondentEmail() || '').toLowerCase().trim();
    const form = e.source;

    if (!staffEmails_(ss).has(email)) {
      reject_(ss, e, cfg, email, 'not on Staff Access list');
      return;
    }

    const sheet = mustGetSheet_(ss, cfg.tab);
    const hdr = headerMap_(sheet);
    const width = sheet.getLastColumn();
    const row = new Array(width).fill('');
    const byTitle = {};
    cfg.fields.forEach(f => byTitle[f.title] = f);

    e.response.getItemResponses().forEach(ir => {
      const f = byTitle[ir.getItem().getTitle()];
      if (!f) return;
      let v = ir.getResponse();
      if (f.type === 'date' && v) v = toDate_(v);
      if (f.type === 'state' && v) v = stateCode_(v);
      if (f.rule && v) v = clean_(f.rule, v);
      row[hdr[norm_(f.header)]] = v;
    });

    const ssnField = cfg.fields.find(f => f.rule === 'ssn');
    const ssn = ssnField ? row[hdr[norm_(ssnField.header)]] : '';
    const existing = ssn ? findSsn_(ss, ssn, cfg) : '';
    if (existing) {
      const nameField = cfg.fields.find(f => f.rule === 'name');
      const name = nameField ? row[hdr[norm_(nameField.header)]] : '';
      const last4 = String(ssn).slice(-4);
      reject_(ss, e, cfg, email, 'duplicate SSN ***-**-' + last4 + ' (already in ' + existing + ')',
        'Your entry for ' + (name || 'this customer') + ' on the "' + cfg.name + '" form was NOT saved.\n\n' +
        'The SSN ending ' + last4 + ' is already in ' + existing + '.\n' +
        'If it is the same customer, update that row instead. If it is a different person, ' +
        'check the SSN and submit the form again.');
      return;
    }

    // Sales date defaults to today
    if (cfg.tab === SALES_TAB && !row[hdr[norm_('Date')]]) row[hdr[norm_('Date')]] = stripTime_(new Date());
    row[hdr[norm_(SUBMITTED_BY_HEADER)]] = email;

    const target = firstEmptyRow_(sheet, hdr, cfg.fields);
    if (target > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), target - sheet.getMaxRows());
    cfg.fields.filter(f => TEXT_RULES.includes(f.rule))
      .forEach(f => sheet.getRange(target, hdr[norm_(f.header)] + 1).setNumberFormat('@')); // keep leading zeros
    sheet.getRange(target, 1, 1, width).setValues([row]);
    SpreadsheetApp.flush();

    ss.getSheetByName(LOG_TAB).appendRow([new Date(), email, cfg.name, 'Saved to row ' + target]);
    if (DELETE_RESPONSE_AFTER_WRITE) form.deleteResponse(e.response.getId());
  } finally {
    lock.releaseLock();
  }
}

// Log the rejection, drop the form response, and (if `notice` is given) email the submitter.
function reject_(ss, e, cfg, email, reason, notice) {
  ss.getSheetByName(LOG_TAB).appendRow([new Date(), email || '(no email)', cfg.name, 'REJECTED — ' + reason]);
  e.source.deleteResponse(e.response.getId());
  if (notice && EMAIL_ON_REJECT && email) MailApp.sendEmail(email, cfg.name + ' — not saved', notice);
}

// ---- Choice lists ---------------------------------------------------------

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
      if (it) it.asMultipleChoiceItem().setChoiceValues(choicesFor_(sheet, f)).showOtherOption(!f.fixed);
    });
  });
}

// Unique values already in the column (case/spacing-insensitive), most common spelling wins.
function choicesFor_(sheet, f) {
  if (f.fixed) return f.seed.slice();
  const col = headerMap_(sheet)[norm_(f.header)] + 1;
  const last = sheet.getLastRow();
  const vals = last > 1 ? sheet.getRange(2, col, last - 1, 1).getDisplayValues().map(r => r[0]) : [];
  const groups = new Map();
  (f.seed || []).concat(vals).forEach(v => {
    const clean = String(v).replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const key = clean.toLowerCase().replace(/\s*\/\s*/g, '/');
    if (!groups.has(key)) groups.set(key, new Map());
    const g = groups.get(key);
    g.set(clean, (g.get(clean) || 0) + 1);
  });
  const out = [...groups.values()].map(g => [...g.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out.length ? out.sort((a, b) => a.localeCompare(b)) : ['(none yet)'];
}

// ---- Helpers --------------------------------------------------------------

function showLinks() {
  const props = PropertiesService.getDocumentProperties();
  const lines = Object.keys(FORMS).map(key => {
    const id = props.getProperty(key + 'FormId');
    if (!id) return FORMS[key].name + ': not set up yet';
    const f = FormApp.openById(id);
    return FORMS[key].name + '\n  Staff link: ' + f.getPublishedUrl() + '\n  Edit link (you only): ' + f.getEditUrl();
  });
  const msg = lines.join('\n\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Ironclad Forms', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}

function ensureStaffTab_(ss) {
  let sh = ss.getSheetByName(STAFF_TAB);
  if (!sh) {
    sh = ss.insertSheet(STAFF_TAB);
    sh.getRange(1, 1, 1, 2).setValues([['Staff Email (Google account)', 'Name']]).setFontWeight('bold');
    sh.setColumnWidth(1, 280);
    sh.getRange(2, 1).setValue(Session.getEffectiveUser().getEmail());
  }
}

function ensureLogTab_(ss) {
  if (!ss.getSheetByName(LOG_TAB)) {
    ss.insertSheet(LOG_TAB).getRange(1, 1, 1, 4)
      .setValues([['Time', 'Email', 'Form', 'Result']]).setFontWeight('bold');
  }
}

function ensureSubmittedByColumn_(sheet) {
  const hdr = headerMap_(sheet);
  if (hdr[norm_(SUBMITTED_BY_HEADER)] !== undefined) return;
  const vals = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getDisplayValues()[0];
  let lastUsed = 0;
  vals.forEach((v, i) => { if (String(v).trim()) lastUsed = i + 1; });
  if (lastUsed >= sheet.getMaxColumns()) sheet.insertColumnAfter(lastUsed);
  sheet.getRange(1, lastUsed + 1).setValue(SUBMITTED_BY_HEADER).setFontWeight('bold');
}

function staffEmails_(ss) {
  const sh = ss.getSheetByName(STAFF_TAB);
  const last = sh.getLastRow();
  if (last < 2) return new Set();
  return new Set(sh.getRange(2, 1, last - 1, 1).getValues()
    .map(r => String(r[0]).toLowerCase().trim()).filter(Boolean));
}

function headerMap_(sheet) {
  const vals = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const m = {};
  vals.forEach((v, i) => { const k = norm_(v); if (k && m[k] === undefined) m[k] = i; });
  return m;
}

// Row after the last row that has anything in the form's own columns
// (ignores formula-only / formatted blank rows further down).
function firstEmptyRow_(sheet, hdr, fields) {
  const last = sheet.getLastRow();
  if (last < 2) return 2;
  const data = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
  const cols = fields.map(f => hdr[norm_(f.header)]);
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

function toDate_(v) { const [y, m, d] = String(v).split('-').map(Number); return new Date(y, m - 1, d); }

function stripTime_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
