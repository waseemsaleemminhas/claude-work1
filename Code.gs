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
 *    via the "Ironclad Forms" menu -> Refresh choice lists).
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

// type: text | para | date | choice ;  header = exact column header in the sheet
const SALES_FIELDS = [
  { header: 'Date', title: 'Sale Date', type: 'date', help: 'Leave blank to use today.' },
  { header: 'Full Name', title: 'Full Name', type: 'text', required: true },
  { header: 'Phone', title: 'Phone', type: 'text', required: true },
  { header: 'Address', title: 'Address', type: 'para' },
  { header: 'Email', title: 'Email', type: 'text' },
  { header: 'Gender', title: 'Gender', type: 'choice', seed: ['Male', 'Female'] },
  { header: 'State Born in', title: 'State Born In', type: 'text' },
  { header: 'Date Of Birth', title: 'Date of Birth', type: 'date' },
  { header: 'Coverage', title: 'Coverage', type: 'text', help: 'e.g. 5k' },
  { header: 'Carrier', title: 'Carrier', type: 'choice' },
  { header: 'Policy Type', title: 'Policy Type', type: 'choice' },
  { header: 'Premium', title: 'Premium (monthly $)', type: 'text', number: true, help: 'Numbers only, e.g. 45.50 — feeds the Summary totals.' },
  { header: 'Existing insurance', title: 'Existing Insurance', type: 'text' },
  { header: 'Medications', title: 'Medications', type: 'para' },
  { header: 'Health Issues', title: 'Health Issues', type: 'para' },
  { header: 'Beneficary Names', title: 'Beneficiary Name(s)', type: 'para' },
  { header: 'Relation', title: 'Beneficiary Relation', type: 'text' },
  { header: 'Beficiary DOB', title: 'Beneficiary DOB', type: 'text' },
  { header: 'SSN', title: 'SSN', type: 'text' },
  { header: 'Bank Name', title: 'Bank Name', type: 'text' },
  { header: 'Routing Number', title: 'Routing Number', type: 'text' },
  { header: 'Account Nmumber', title: 'Account Number', type: 'text' },
  { header: 'Gets Paid On', title: 'Gets Paid On', type: 'text' },
  { header: 'Closer Name', title: 'Closer Name', type: 'choice', required: true },
  { header: 'Licensed Agent', title: 'Licensed Agent', type: 'choice' },
  { header: 'Status', title: 'Status', type: 'choice' },
  { header: 'Driving_L', title: 'Driving License', type: 'text' },
  { header: 'Draft 1st and Onwards', title: 'Draft 1st and Onwards', type: 'text' },
  // "Remarks - Anas/ Waseem" is intentionally left off: management fills it in the sheet.
];

const DUPES_FIELDS = [
  { header: 'NAME', title: 'Name', type: 'text', required: true },
  { header: 'ADDRESS', title: 'Address', type: 'para' },
  { header: 'PHONE', title: 'Phone', type: 'text', required: true },
  { header: 'E-MAIL', title: 'Email', type: 'text' },
  { header: 'GENDER', title: 'Gender', type: 'choice', seed: ['Male', 'Female'] },
  { header: 'BORN ST', title: 'State Born In', type: 'text' },
  { header: 'DOB', title: 'Date of Birth', type: 'date' },
  { header: 'EXISTING INS', title: 'Existing Insurance', type: 'text' },
  { header: 'HEIGHT/WEIGHT', title: 'Height / Weight', type: 'text', help: 'e.g. 5.9/138' },
  { header: 'SMOKER/NON SMOKER', title: 'Smoker / Non Smoker', type: 'choice', seed: ['Smoker', 'Non smoker'] },
  { header: 'HEALTH ISSUES', title: 'Health Issues', type: 'para' },
  { header: 'BENEFICIARY', title: 'Beneficiary', type: 'para' },
  { header: 'SSN', title: 'SSN', type: 'text' },
  { header: 'BANK NAME', title: 'Bank Name', type: 'text' },
  { header: 'ACC TYPE', title: 'Account Type', type: 'choice', seed: ['Checking', 'Savings'] },
  { header: 'ROUTING NO', title: 'Routing Number', type: 'text' },
  { header: 'ACC NO', title: 'Account Number', type: 'text' },
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
      .setConfirmationMessage('Saved. Thank you!');
    try { form.setPublished(true); } catch (e) { /* older Forms: already live */ }

    buildItems_(form, cfg.fields, sheet);
    DriveApp.getFileById(form.getId()).moveTo(DriveApp.getFileById(ss.getId()).getParents().next());

    ScriptApp.newTrigger(cfg.handler).forForm(form).onFormSubmit().create();
    props.setProperty(key + 'FormId', form.getId());
  });

  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'refreshChoices')) {
    ScriptApp.newTrigger('refreshChoices').timeBased().everyDays(1).atHour(2).create();
  }
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
      case 'choice':
        item = form.addMultipleChoiceItem();
        item.setChoiceValues(choicesFor_(sheet, f)).showOtherOption(true);
        break;
      default: item = form.addTextItem();
    }
    item.setTitle(f.title).setRequired(!!f.required);
    if (f.help) item.setHelpText(f.help);
    if (f.number) item.setValidation(FormApp.createTextValidation().requireNumber().setHelpText('Numbers only').build());
  });
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
      ss.getSheetByName(LOG_TAB).appendRow([new Date(), email || '(no email)', cfg.name, 'REJECTED — not on Staff Access list']);
      form.deleteResponse(e.response.getId());
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
      row[hdr[norm_(f.header)]] = v;
    });

    // Sales date defaults to today
    if (cfg.tab === SALES_TAB && !row[hdr[norm_('Date')]]) row[hdr[norm_('Date')]] = stripTime_(new Date());
    row[hdr[norm_(SUBMITTED_BY_HEADER)]] = email;

    const target = firstEmptyRow_(sheet, hdr, cfg.fields);
    sheet.getRange(target, 1, 1, width).setValues([row]);
    SpreadsheetApp.flush();

    ss.getSheetByName(LOG_TAB).appendRow([new Date(), email, cfg.name, 'Saved to row ' + target]);
    if (DELETE_RESPONSE_AFTER_WRITE) form.deleteResponse(e.response.getId());
  } finally {
    lock.releaseLock();
  }
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
      if (it) it.asMultipleChoiceItem().setChoiceValues(choicesFor_(sheet, f)).showOtherOption(true);
    });
  });
}

// Unique values already in the column (case/spacing-insensitive), most common spelling wins.
function choicesFor_(sheet, f) {
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
