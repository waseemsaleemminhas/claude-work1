/**
 * Monefy-style money tracker — a Google Sheet is the whole backend.
 *
 * ==> THIS GOES IN ITS OWN, BRAND-NEW SPREADSHEET. <==
 * Do not paste it into the Sales / "Dupes Call backs" spreadsheet that runs Code.gs,
 * or the recruitment one that runs Recruitment.gs. Separate sheet, separate Apps
 * Script project, separate deployment.
 *
 * What you get
 *   ONE link that opens a phone-sized app, the way Monefy works:
 *     - a ring chart of where the money went, with the balance in the middle
 *     - a grid of category buttons; tap one, punch the amount into the keypad, done
 *     - the big "-" and "+" buttons for an expense or some income
 *     - Records: every entry, newest first, tap to change or delete it
 *     - Accounts: cash, card, savings... each with its own running balance
 *     - Transfers between accounts, which move money without counting as spending
 *     - Categories with icons, colours and an optional monthly budget
 *   Nothing is installed and nothing is stored anywhere but your own Google Sheet:
 *   every entry is one row on the "Transactions" tab, so you can sort it, chart it,
 *   or hand it to your accountant whenever you like.
 *
 * ---- Set up (once) -------------------------------------------------------------
 *  1. Google Drive -> New -> Google Sheet. Name it "Money".
 *  2. Extensions -> Apps Script. Delete the stub, paste this whole file, Save.
 *  3. Run `setup` and approve the permission prompts. It builds every tab, two
 *     accounts (Cash and Bank card), the usual categories, the Summary tab and
 *     your own access code.
 *  4. Deploy -> New deployment -> type "Web app"
 *       Execute as:      Me
 *       Who has access:  Only myself          <-- for a private, one-person app
 *                        Anyone with a Google account   <-- if you share it with
 *                                                           family; they then need
 *                                                           an access code from the
 *                                                           "People" tab
 *     Deploy, then copy the web app URL. Open it on your phone and
 *     "Add to Home screen" — it behaves like an app from then on.
 *  5. "Money" menu -> "Access codes" to see (and send) the codes.
 *
 *  After pasting a NEW version of this file: Deploy -> Manage deployments -> edit ->
 *  Version: New version -> Deploy. The URL does not change.
 *
 *  Money stays in one currency (Settings tab). Each person you add can see and change
 *  everything — this is a household ledger, not a bank with separate logins.
 */

// ---- Settings -------------------------------------------------------------

const ACCOUNTS_TAB = 'Accounts';
const CATEGORIES_TAB = 'Categories';
const TX_TAB = 'Transactions';
const PEOPLE_TAB = 'People';
const SETTINGS_TAB = 'Settings';
const SUMMARY_TAB = 'Summary';
const MONEY_LOG_TAB = 'Money Log';

const MONEY_TITLE = 'Money';

// How many of the newest entries the app loads. Balances always use every row,
// so an older entry still counts even when it is past this window.
const TX_PAGE = 4000;

const EXPENSE = 'Expense';
const INCOME = 'Income';
const TRANSFER = 'Transfer';
const TX_KINDS = [EXPENSE, INCOME, TRANSFER];
const ACCOUNT_TYPES = ['Cash', 'Card', 'Bank', 'Savings', 'Wallet', 'Other'];

const ACCOUNT_HEADERS = ['ID', 'Name', 'Type', 'Starting Balance', 'Icon', 'Colour', 'Archived', 'Created'];
const CATEGORY_HEADERS = ['ID', 'Name', 'Kind', 'Icon', 'Colour', 'Monthly Budget', 'Archived', 'Created'];
const TX_HEADERS = ['ID', 'Date', 'Kind', 'Amount', 'Account', 'To Account', 'Category', 'Note', 'Entered By', 'Entered At', 'Changed At'];
const PEOPLE_HEADERS = ['Name', 'Email', 'Access Code', 'Added'];
const SETTINGS_HEADERS = ['Key', 'Value', 'Notes'];
const MONEY_LOG_HEADERS = ['When', 'Who', 'What'];

const DEFAULT_ACCOUNTS = [
  // Name, Type, Starting balance, Icon, Colour
  ['Cash', 'Cash', 0, '💵', '#43A047'],
  ['Bank card', 'Card', 0, '💳', '#1E88E5'],
];

const DEFAULT_CATEGORIES = [
  // Name, Kind, Icon, Colour, Monthly budget ('' for none)
  ['Groceries', EXPENSE, '🛒', '#43A047', ''],
  ['Eating out', EXPENSE, '🍽️', '#FB8C00', ''],
  ['Transport', EXPENSE, '🚌', '#1E88E5', ''],
  ['Fuel', EXPENSE, '⛽', '#6D4C41', ''],
  ['Bills', EXPENSE, '💡', '#FDD835', ''],
  ['Rent', EXPENSE, '🏠', '#7E57C2', ''],
  ['Health', EXPENSE, '💊', '#E53935', ''],
  ['Shopping', EXPENSE, '🛍️', '#EC407A', ''],
  ['Fun', EXPENSE, '🎬', '#AB47BC', ''],
  ['Family', EXPENSE, '🧸', '#26C6DA', ''],
  ['Learning', EXPENSE, '📚', '#5C6BC0', ''],
  ['Gifts', EXPENSE, '🎁', '#FF7043', ''],
  ['Charity', EXPENSE, '🤲', '#26A69A', ''],
  ['Other', EXPENSE, '➖', '#90A4AE', ''],
  ['Salary', INCOME, '💼', '#2E7D32', ''],
  ['Bonus', INCOME, '🎉', '#7CB342', ''],
  ['Business', INCOME, '📈', '#00897B', ''],
  ['Interest', INCOME, '🏦', '#0277BD', ''],
  ['Gift', INCOME, '🎀', '#F9A825', ''],
  ['Other income', INCOME, '➕', '#90A4AE', ''],
];

const DEFAULT_SETTINGS = [
  ['Currency', '$', 'The symbol shown in the app, e.g. $  £  €  Rs  PKR'],
  ['Week starts on', 'Monday', 'Monday or Sunday — used by the Week view.'],
  ['Show decimals', 'Yes', 'No rounds every amount shown to whole numbers.'],
];

// ---- Menu -----------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu(MONEY_TITLE)
    .addItem('Set up / update everything (safe to re-run)', 'setup')
    .addItem('Show the app link', 'showMoneyLink')
    .addItem('Access codes', 'showMoneyCodes')
    .addSeparator()
    .addItem('Rebuild the Summary tab', 'rebuildSummary')
    .addToUi();
}

// ---- Setup ----------------------------------------------------------------

// Safe to run again: it only adds what is missing and leaves your rows alone.
function setup() {
  const ss = SpreadsheetApp.getActive();
  ensureTab_(ss, ACCOUNTS_TAB, ACCOUNT_HEADERS);
  ensureTab_(ss, CATEGORIES_TAB, CATEGORY_HEADERS);
  ensureTab_(ss, TX_TAB, TX_HEADERS);
  ensureTab_(ss, PEOPLE_TAB, PEOPLE_HEADERS);
  ensureTab_(ss, SETTINGS_TAB, SETTINGS_HEADERS);
  ensureTab_(ss, MONEY_LOG_TAB, MONEY_LOG_HEADERS);

  seedAccounts_(ss);
  seedCategories_(ss);
  seedSettings_(ss);
  ensureMe_(ss);
  applyMoneyFormats_(ss);
  rebuildSummary();
  dropStubSheet_(ss);
  showMoneyLink();
}

function ensureTab_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(v => String(v).trim());
  const missing = headers.filter(h => head.indexOf(h) === -1);
  if (head.join('') === '') {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
  }
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).setFontWeight('bold');
  return sh;
}

// A brand-new spreadsheet opens with an empty "Sheet1" — tidy it away once the
// real tabs exist, but never touch a sheet somebody has typed in.
function dropStubSheet_(ss) {
  const sh = ss.getSheetByName('Sheet1');
  if (sh && ss.getSheets().length > 1 && sh.getLastRow() === 0 && sh.getLastColumn() === 0) {
    ss.deleteSheet(sh);
  }
}

function seedAccounts_(ss) {
  const t = table_(ss, ACCOUNTS_TAB);
  if (t.rows.length) return;
  const now = new Date();
  const rows = DEFAULT_ACCOUNTS.map(a => rowFor_(t, {
    'ID': newId_('a'), 'Name': a[0], 'Type': a[1], 'Starting Balance': a[2],
    'Icon': a[3], 'Colour': a[4], 'Archived': '', 'Created': now,
  }));
  t.sh.getRange(2, 1, rows.length, t.head.length).setValues(rows);
}

function seedCategories_(ss) {
  const t = table_(ss, CATEGORIES_TAB);
  if (t.rows.length) return;
  const now = new Date();
  const rows = DEFAULT_CATEGORIES.map(c => rowFor_(t, {
    'ID': newId_('c'), 'Name': c[0], 'Kind': c[1], 'Icon': c[2], 'Colour': c[3],
    'Monthly Budget': c[4], 'Archived': '', 'Created': now,
  }));
  t.sh.getRange(2, 1, rows.length, t.head.length).setValues(rows);
}

function seedSettings_(ss) {
  const t = table_(ss, SETTINGS_TAB);
  const have = {};
  t.rows.forEach(r => { have[String(t.get(r, 'Key')).trim()] = true; });
  const add = DEFAULT_SETTINGS.filter(s => !have[s[0]]);
  if (!add.length) return;
  const rows = add.map(s => rowFor_(t, { 'Key': s[0], 'Value': s[1], 'Notes': s[2] }));
  t.sh.getRange(t.rows.length + 2, 1, rows.length, t.head.length).setValues(rows);
}

// Whoever runs setup is the first person on the "People" tab.
function ensureMe_(ss) {
  const email = myEmail_();
  const t = table_(ss, PEOPLE_TAB);
  if (t.rows.some(r => String(t.get(r, 'Email')).trim().toLowerCase() === email.toLowerCase())) return;
  const name = email ? email.split('@')[0] : 'Me';
  const row = rowFor_(t, { 'Name': name, 'Email': email, 'Access Code': newCode_(), 'Added': new Date() });
  t.sh.getRange(t.rows.length + 2, 1, 1, t.head.length).setValues([row]);
}

function applyMoneyFormats_(ss) {
  const tx = table_(ss, TX_TAB);
  tx.sh.getRange(2, tx.col('Date'), Math.max(tx.sh.getMaxRows() - 1, 1), 1).setNumberFormat('yyyy-mm-dd');
  tx.sh.getRange(2, tx.col('Amount'), Math.max(tx.sh.getMaxRows() - 1, 1), 1).setNumberFormat('#,##0.00');
  setChoices_(tx, 'Kind', TX_KINDS);

  const ac = table_(ss, ACCOUNTS_TAB);
  ac.sh.getRange(2, ac.col('Starting Balance'), Math.max(ac.sh.getMaxRows() - 1, 1), 1).setNumberFormat('#,##0.00');
  setChoices_(ac, 'Type', ACCOUNT_TYPES);

  const ct = table_(ss, CATEGORIES_TAB);
  ct.sh.getRange(2, ct.col('Monthly Budget'), Math.max(ct.sh.getMaxRows() - 1, 1), 1).setNumberFormat('#,##0.00');
  setChoices_(ct, 'Kind', [EXPENSE, INCOME]);
}

function setChoices_(t, header, choices) {
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(choices, true).setAllowInvalid(false).build();
  t.sh.getRange(2, t.col(header), Math.max(t.sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

// ---- The Summary tab (plain sheet formulas, so it keeps working on its own) ----

function rebuildSummary() {
  const ss = SpreadsheetApp.getActive();
  const sh = ensureTab_(ss, SUMMARY_TAB, ['Summary']);
  const tx = table_(ss, TX_TAB);
  const ac = table_(ss, ACCOUNTS_TAB);
  const ct = table_(ss, CATEGORIES_TAB);

  const amount = ref_(TX_TAB, tx, 'Amount');
  const date = ref_(TX_TAB, tx, 'Date');
  const kind = ref_(TX_TAB, tx, 'Kind');
  const from = ref_(TX_TAB, tx, 'Account');
  const to = ref_(TX_TAB, tx, 'To Account');
  const cat = ref_(TX_TAB, tx, 'Category');
  const acName = ref_(ACCOUNTS_TAB, ac, 'Name');
  const acStart = ref_(ACCOUNTS_TAB, ac, 'Starting Balance');
  const ctName = ref_(CATEGORIES_TAB, ct, 'Name');
  const ctKind = ref_(CATEGORIES_TAB, ct, 'Kind');
  const monthStart = 'DATE(YEAR(TODAY()),MONTH(TODAY()),1)';
  const monthEnd = 'EOMONTH(TODAY(),0)';

  sh.clear();
  sh.getRange('A1').setValue('Account balances').setFontWeight('bold');
  sh.getRange('A2:B2').setValues([['Account', 'Balance']]).setFontWeight('bold');
  sh.getRange('A3').setFormula('=ARRAYFORMULA(IF(' + acName + '="",,' + acName + '))');
  sh.getRange('B3').setFormula('=ARRAYFORMULA(IF(' + acName + '="",,' +
    acStart + '+SUMIFS(' + amount + ',' + from + ',' + acName + ',' + kind + ',"' + INCOME + '")' +
    '-SUMIFS(' + amount + ',' + from + ',' + acName + ',' + kind + ',"' + EXPENSE + '")' +
    '-SUMIFS(' + amount + ',' + from + ',' + acName + ',' + kind + ',"' + TRANSFER + '")' +
    '+SUMIFS(' + amount + ',' + to + ',' + acName + ',' + kind + ',"' + TRANSFER + '")))');

  sh.getRange('D1').setValue('This month by category').setFontWeight('bold');
  sh.getRange('D2:G2').setValues([['Category', 'Kind', 'Spent / earned', 'Monthly budget']]).setFontWeight('bold');
  sh.getRange('D3').setFormula('=ARRAYFORMULA(IF(' + ctName + '="",,' + ctName + '))');
  sh.getRange('E3').setFormula('=ARRAYFORMULA(IF(' + ctName + '="",,' + ctKind + '))');
  sh.getRange('F3').setFormula('=ARRAYFORMULA(IF(' + ctName + '="",,SUMIFS(' + amount + ',' + cat + ',' + ctName +
    ',' + date + ',">="&' + monthStart + ',' + date + ',"<="&' + monthEnd + ')))');
  sh.getRange('G3').setFormula('=ARRAYFORMULA(IF(' + ctName + '="",,' + ref_(CATEGORIES_TAB, ct, 'Monthly Budget') + '))');

  sh.getRange('I1').setValue('This month').setFontWeight('bold');
  sh.getRange('I2:J5').setValues([
    ['Income', ''],
    ['Expenses', ''],
    ['Left over', ''],
    ['Entries', ''],
  ]);
  sh.getRange('J2').setFormula('=SUMIFS(' + amount + ',' + kind + ',"' + INCOME + '",' + date + ',">="&' + monthStart + ',' + date + ',"<="&' + monthEnd + ')');
  sh.getRange('J3').setFormula('=SUMIFS(' + amount + ',' + kind + ',"' + EXPENSE + '",' + date + ',">="&' + monthStart + ',' + date + ',"<="&' + monthEnd + ')');
  sh.getRange('J4').setFormula('=J2-J3');
  sh.getRange('J5').setFormula('=COUNTIFS(' + date + ',">="&' + monthStart + ',' + date + ',"<="&' + monthEnd + ')');
  sh.getRange('I2:I5').setFontWeight('bold');

  sh.getRange('B3:B').setNumberFormat('#,##0.00');
  sh.getRange('F3:G').setNumberFormat('#,##0.00');
  sh.getRange('J2:J4').setNumberFormat('#,##0.00');
  sh.setColumnWidth(1, 150);
  sh.setColumnWidth(4, 150);
  sh.setColumnWidth(9, 110);
  sh.setFrozenRows(2);
}

// "Transactions!D2:D" for the given column — a whole-column reference the
// ARRAYFORMULA versions above can lean on.
function ref_(tab, t, header) {
  const letter = colLetter_(t.col(header));
  return "'" + tab + "'!" + letter + '2:' + letter;
}

function colLetter_(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - 1 - r) / 26;
  }
  return s;
}

// ---- Links and codes ------------------------------------------------------

function showMoneyLink() {
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { url = ''; }
  const msg = url
    ? 'Your app link:\n\n' + url + '\n\nOpen it on your phone and use "Add to Home screen".'
    : 'Not deployed yet. Deploy -> New deployment -> Web app (Execute as: Me), then this menu shows the link.';
  moneyAlert_(msg, MONEY_TITLE);
}

function showMoneyCodes() {
  const ss = SpreadsheetApp.getActive();
  const t = table_(ss, PEOPLE_TAB);
  const lines = t.rows
    .filter(r => String(t.get(r, 'Name')).trim() || String(t.get(r, 'Email')).trim())
    .map(r => (String(t.get(r, 'Name')).trim() || String(t.get(r, 'Email')).trim()) + ' — ' + String(t.get(r, 'Access Code')).trim());
  moneyAlert_(lines.length
    ? 'Access codes:\n\n' + lines.join('\n') + '\n\nSomeone opening the link with their own Google account is let in without a code; anyone else types theirs.\n\nTo add a person: put their name, email and any code you like on the "People" tab.'
    : 'Nobody on the "People" tab yet. Run "Set up / update everything".', MONEY_TITLE);
}

// ---- Reading and writing the tabs ----------------------------------------

// One place that knows how a tab is laid out. Columns are found by their header
// name, so adding a column of your own next to them does not break the app.
function table_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('The "' + name + '" tab is missing. Run "Set up / update everything" from the ' + MONEY_TITLE + ' menu.');
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(v => String(v).trim());
  const idx = {};
  head.forEach((h, i) => { if (h && idx[h] === undefined) idx[h] = i; });
  const last = sh.getLastRow();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, width).getValues();
  return {
    sh: sh, head: head, idx: idx, rows: rows,
    col: function (h) {
      const i = idx[h];
      if (i === undefined) throw new Error('Column "' + h + '" is missing on the "' + name + '" tab. Run "Set up / update everything".');
      return i + 1;
    },
    get: function (row, h) {
      const i = idx[h];
      return i === undefined ? '' : row[i];
    },
    set: function (row, h, value) {
      const i = idx[h];
      if (i !== undefined) row[i] = value;
      return row;
    },
  };
}

// Lay values out in the order the live header row happens to be in.
function rowFor_(t, values) {
  const row = new Array(t.head.length).fill('');
  Object.keys(values).forEach(h => {
    const i = t.idx[h];
    if (i !== undefined) row[i] = values[h];
  });
  return row;
}

function writeRow_(t, rowNumber, row) {
  t.sh.getRange(rowNumber, 1, 1, t.head.length).setValues([row]);
}

function appendRow_(t, values) {
  const row = rowFor_(t, values);
  const at = t.sh.getLastRow() + 1;
  if (at > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), 20);
  writeRow_(t, at, row);
  return at;
}

// The sheet row a record lives on, or 0. Row 1 is the header, so data starts at 2.
function rowOfId_(t, id) {
  const want = String(id).trim();
  if (!want) return 0;
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.get(t.rows[i], 'ID')).trim() === want) return i + 2;
  }
  return 0;
}

function log_(ss, person, what) {
  try {
    const t = table_(ss, MONEY_LOG_TAB);
    appendRow_(t, { 'When': new Date(), 'Who': (person && person.email) || (person && person.name) || '', 'What': what });
  } catch (err) {
    Logger.log('log: ' + err);
  }
}

// ---- Who is allowed in ----------------------------------------------------

// Recognised by Google account if we can see it, otherwise by access code.
// Nothing about the sheet goes back to the page until one of those matches.
function person_(ss, code) {
  const t = table_(ss, PEOPLE_TAB);
  const email = myEmail_().toLowerCase();
  const typed = String(code || '').trim().toLowerCase();
  let byCode = null;
  for (let i = 0; i < t.rows.length; i++) {
    const r = t.rows[i];
    const rowEmail = String(t.get(r, 'Email')).trim();
    const rowCode = String(t.get(r, 'Access Code')).trim();
    const out = { name: String(t.get(r, 'Name')).trim() || rowEmail, email: rowEmail, code: rowCode };
    if (email && rowEmail && rowEmail.toLowerCase() === email) return out;
    if (typed && rowCode && rowCode.toLowerCase() === typed) byCode = out;
  }
  return byCode;
}

function myEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

function newCode_() {
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY34679';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return out;
}

function newId_(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

// ---- Small helpers --------------------------------------------------------

function toNum_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

function isoDate_(v, tz) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

// Midday, so a timezone or daylight-saving shift can never move it to another day.
function dateFromIso_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

function moneyAlert_(msg, title) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(title || MONEY_TITLE, msg, ui.ButtonSet.OK);
  } catch (err) {
    Logger.log(msg);
  }
}

// ---- The app --------------------------------------------------------------

function doGet() {
  return HtmlService.createHtmlOutput(moneyPageHtml_())
    .setTitle(MONEY_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .addMetaTag('theme-color', '#19202b')
    .setFaviconUrl('https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico');
}

// Every write goes through here: one at a time, and only for someone we know.
function guarded_(req, fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return { ok: false, message: 'The sheet was busy. Try that again.' };
  }
  try {
    const ss = SpreadsheetApp.getActive();
    const person = person_(ss, req && req.code);
    if (!person) return { ok: false, needCode: true, message: 'Your access code was not recognised.' };
    return fn(ss, person);
  } catch (err) {
    Logger.log(err && err.stack ? err.stack : err);
    return { ok: false, message: String((err && err.message) || err) };
  } finally {
    try { lock.releaseLock(); } catch (err) { /* already gone */ }
  }
}

// Called on load, and again whenever an access code is typed.
function webMoneyBoot(code) {
  const ss = SpreadsheetApp.getActive();
  const person = person_(ss, code);
  if (!person) {
    return {
      ok: false, needCode: true,
      message: code ? 'That access code was not recognised.' : '',
    };
  }
  return { ok: true, person: { name: person.name, email: person.email }, data: payload_(ss) };
}

// Everything the page needs in one trip: settings, accounts with their balances,
// categories, and the newest entries.
function payload_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const settings = settings_(ss);
  const accounts = accounts_(ss);
  const categories = categories_(ss);

  const all = scanTx_(ss, accounts, tz);

  let url = '';
  try { url = ss.getUrl(); } catch (err) { url = ''; }

  return {
    settings: settings,
    accounts: accounts,
    categories: categories,
    tx: all.slice(Math.max(0, all.length - TX_PAGE)),
    total: all.length,
    today: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
    sheetUrl: url,
    accountTypes: ACCOUNT_TYPES,
  };
}

// Walks every transaction row once: fills in each account's balance (every row
// counts, however old) and hands back the entries themselves, oldest first.
function scanTx_(ss, accounts, tz) {
  const t = table_(ss, TX_TAB);
  const balance = {};
  accounts.forEach(a => { balance[a.name] = a.start; });
  const all = [];
  t.rows.forEach(row => {
    const id = String(t.get(row, 'ID')).trim();
    if (!id) return;
    const kind = String(t.get(row, 'Kind')).trim();
    if (TX_KINDS.indexOf(kind) === -1) return;
    const amount = round2_(toNum_(t.get(row, 'Amount')));
    const from = clean_(t.get(row, 'Account'), 80);
    const to = clean_(t.get(row, 'To Account'), 80);
    if (kind === INCOME && balance[from] !== undefined) balance[from] += amount;
    else if (kind === EXPENSE && balance[from] !== undefined) balance[from] -= amount;
    else if (kind === TRANSFER) {
      if (balance[from] !== undefined) balance[from] -= amount;
      if (balance[to] !== undefined) balance[to] += amount;
    }
    const at = t.get(row, 'Entered At');
    all.push({
      id: id,
      date: isoDate_(t.get(row, 'Date'), tz),
      kind: kind,
      amount: amount,
      account: from,
      to: to,
      category: clean_(t.get(row, 'Category'), 80),
      note: clean_(t.get(row, 'Note'), 200),
      by: clean_(t.get(row, 'Entered By'), 120),
      at: at instanceof Date ? at.getTime() : 0,
    });
  });
  accounts.forEach(a => { a.balance = round2_(balance[a.name] || 0); });
  return all;
}

// Accounts with their balances brought up to date, for the page to swap in
// after a write.
function balanceList_(ss) {
  const accounts = accounts_(ss);
  scanTx_(ss, accounts, ss.getSpreadsheetTimeZone());
  return accounts;
}

function settings_(ss) {
  const t = table_(ss, SETTINGS_TAB);
  const map = {};
  t.rows.forEach(r => {
    const k = clean_(t.get(r, 'Key'), 60);
    if (k) map[k] = clean_(t.get(r, 'Value'), 60);
  });
  return {
    currency: map['Currency'] || '$',
    weekStart: /^sun/i.test(map['Week starts on'] || '') ? 0 : 1,
    decimals: /^n/i.test(map['Show decimals'] || 'Yes') ? 0 : 2,
  };
}

function accounts_(ss) {
  const t = table_(ss, ACCOUNTS_TAB);
  return t.rows.map(r => ({
    id: String(t.get(r, 'ID')).trim(),
    name: clean_(t.get(r, 'Name'), 80),
    type: clean_(t.get(r, 'Type'), 40) || 'Other',
    start: round2_(toNum_(t.get(r, 'Starting Balance'))),
    icon: clean_(t.get(r, 'Icon'), 8) || '💰',
    colour: clean_(t.get(r, 'Colour'), 20) || '#1E88E5',
    archived: !!clean_(t.get(r, 'Archived'), 10),
    balance: 0,
  })).filter(a => a.id && a.name);
}

function categories_(ss) {
  const t = table_(ss, CATEGORIES_TAB);
  return t.rows.map(r => ({
    id: String(t.get(r, 'ID')).trim(),
    name: clean_(t.get(r, 'Name'), 80),
    kind: String(t.get(r, 'Kind')).trim() === INCOME ? INCOME : EXPENSE,
    icon: clean_(t.get(r, 'Icon'), 8) || '•',
    colour: clean_(t.get(r, 'Colour'), 20) || '#90A4AE',
    budget: round2_(toNum_(t.get(r, 'Monthly Budget'))),
    archived: !!clean_(t.get(r, 'Archived'), 10),
  })).filter(c => c.id && c.name);
}

// ---- Adding, changing and deleting an entry -------------------------------

// Checked here as well as in the page, because the page can be anything.
function prepareTx_(raw, accounts, categories, today) {
  const req = raw || {};
  const kind = TX_KINDS.indexOf(String(req.kind || '').trim()) === -1 ? '' : String(req.kind).trim();
  if (!kind) return { error: 'Pick expense, income or transfer.' };

  const amount = round2_(toNum_(req.amount));
  if (!(amount > 0)) return { error: 'Put in an amount above zero.' };
  if (amount > 1e12) return { error: 'That amount is too large.' };

  const given = String(req.date == null ? '' : req.date).trim();
  const date = given ? isoDate_(given, Session.getScriptTimeZone()) : today;
  if (!dateFromIso_(date)) return { error: 'That date does not look right.' };

  const account = byName_(accounts, req.account);
  if (!account) return { error: 'Pick an account that is on the Accounts tab.' };

  let to = '';
  let category = '';
  if (kind === TRANSFER) {
    const target = byName_(accounts, req.to);
    if (!target) return { error: 'Pick the account the money goes to.' };
    if (target.name === account.name) return { error: 'A transfer needs two different accounts.' };
    to = target.name;
  } else {
    const cat = byName_(categories, req.category);
    if (!cat) return { error: 'Pick a category.' };
    if (cat.kind !== kind) return { error: '"' + cat.name + '" is a ' + cat.kind.toLowerCase() + ' category.' };
    category = cat.name;
  }

  return {
    value: {
      date: date, kind: kind, amount: amount, account: account.name,
      to: to, category: category, note: clean_(req.note, 200),
    },
  };
}

function byName_(list, name) {
  const want = clean_(name, 80).toLowerCase();
  if (!want) return null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].name.toLowerCase() === want) return list[i];
  }
  return null;
}

function webMoneySave(req) {
  return guarded_(req, function (ss, person) {
    const tz = ss.getSpreadsheetTimeZone();
    const accounts = accounts_(ss);
    const categories = categories_(ss);
    const prepared = prepareTx_(req && req.tx, accounts, categories, Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
    if (prepared.error) return { ok: false, message: prepared.error };

    const v = prepared.value;
    const t = table_(ss, TX_TAB);
    const now = new Date();
    const id = String((req.tx && req.tx.id) || '').trim();
    let rowNumber = id ? rowOfId_(t, id) : 0;
    if (id && !rowNumber) return { ok: false, message: 'That entry is no longer on the sheet.' };

    const old = rowNumber ? t.rows[rowNumber - 2] : null;
    const values = {
      'ID': id || newId_('t'),
      'Date': dateFromIso_(v.date),
      'Kind': v.kind,
      'Amount': v.amount,
      'Account': v.account,
      'To Account': v.to,
      'Category': v.category,
      'Note': v.note,
      'Entered By': old ? (clean_(t.get(old, 'Entered By'), 120) || person.email) : person.email,
      'Entered At': old && t.get(old, 'Entered At') instanceof Date ? t.get(old, 'Entered At') : now,
      'Changed At': old ? now : '',
    };

    if (rowNumber) writeRow_(t, rowNumber, rowFor_(t, values));
    else rowNumber = appendRow_(t, values);
    t.sh.getRange(rowNumber, t.col('Date')).setNumberFormat('yyyy-mm-dd');
    t.sh.getRange(rowNumber, t.col('Amount')).setNumberFormat('#,##0.00');

    log_(ss, person, (old ? 'Changed ' : 'Added ') + v.kind.toLowerCase() + ' ' + v.amount +
      ' on ' + v.date + ' — ' + (v.category || v.account + ' -> ' + v.to));

    return {
      ok: true,
      tx: {
        id: values['ID'], date: v.date, kind: v.kind, amount: v.amount, account: v.account,
        to: v.to, category: v.category, note: v.note, by: values['Entered By'],
        at: values['Entered At'] instanceof Date ? values['Entered At'].getTime() : now.getTime(),
      },
      accounts: balanceList_(ss),
    };
  });
}

function webMoneyDelete(req) {
  return guarded_(req, function (ss, person) {
    const id = String((req && req.id) || '').trim();
    const t = table_(ss, TX_TAB);
    const rowNumber = rowOfId_(t, id);
    if (!rowNumber) return { ok: false, message: 'That entry is already gone.' };
    const row = t.rows[rowNumber - 2];
    const what = String(t.get(row, 'Kind')).trim() + ' ' + toNum_(t.get(row, 'Amount')) +
      ' on ' + isoDate_(t.get(row, 'Date'), ss.getSpreadsheetTimeZone()) +
      ' — ' + (clean_(t.get(row, 'Category'), 80) || clean_(t.get(row, 'Account'), 80));
    t.sh.deleteRow(rowNumber);
    log_(ss, person, 'Deleted ' + what);
    return { ok: true, id: id, accounts: balanceList_(ss) };
  });
}

// ---- Accounts and categories ---------------------------------------------

function webMoneyAccount(req) {
  return guarded_(req, function (ss, person) {
    const input = (req && req.account) || {};
    const name = clean_(input.name, 80);
    if (!name) return { ok: false, message: 'An account needs a name.' };

    const t = table_(ss, ACCOUNTS_TAB);
    const id = String(input.id || '').trim();
    const rowNumber = id ? rowOfId_(t, id) : 0;
    if (id && !rowNumber) return { ok: false, message: 'That account is no longer on the sheet.' };

    const clash = t.rows.some((r, i) => clean_(t.get(r, 'Name'), 80).toLowerCase() === name.toLowerCase() && i + 2 !== rowNumber);
    if (clash) return { ok: false, message: 'There is already an account called "' + name + '".' };

    const type = ACCOUNT_TYPES.indexOf(clean_(input.type, 40)) === -1 ? 'Other' : clean_(input.type, 40);
    const values = {
      'ID': id || newId_('a'),
      'Name': name,
      'Type': type,
      'Starting Balance': round2_(toNum_(input.start)),
      'Icon': clean_(input.icon, 8) || '💰',
      'Colour': clean_(input.colour, 20) || '#1E88E5',
      'Archived': input.archived ? 'Yes' : '',
      'Created': rowNumber && t.get(t.rows[rowNumber - 2], 'Created') ? t.get(t.rows[rowNumber - 2], 'Created') : new Date(),
    };

    if (rowNumber) {
      const was = clean_(t.get(t.rows[rowNumber - 2], 'Name'), 80);
      writeRow_(t, rowNumber, rowFor_(t, values));
      if (was && was !== name) {
        const moved = renameInTx_(ss, ['Account', 'To Account'], was, name);
        log_(ss, person, 'Renamed account "' + was + '" to "' + name + '" (' + moved + ' entries updated)');
      } else {
        log_(ss, person, 'Changed account "' + name + '"' + (values['Archived'] ? ' (hidden)' : ''));
      }
    } else {
      const at = appendRow_(t, values);
      t.sh.getRange(at, t.col('Starting Balance')).setNumberFormat('#,##0.00');
      log_(ss, person, 'Added account "' + name + '"');
    }

    return { ok: true, accounts: balanceList_(ss) };
  });
}

function webMoneyCategory(req) {
  return guarded_(req, function (ss, person) {
    const input = (req && req.category) || {};
    const name = clean_(input.name, 80);
    if (!name) return { ok: false, message: 'A category needs a name.' };
    const kind = String(input.kind || '').trim() === INCOME ? INCOME : EXPENSE;

    const t = table_(ss, CATEGORIES_TAB);
    const id = String(input.id || '').trim();
    const rowNumber = id ? rowOfId_(t, id) : 0;
    if (id && !rowNumber) return { ok: false, message: 'That category is no longer on the sheet.' };

    const clash = t.rows.some((r, i) => clean_(t.get(r, 'Name'), 80).toLowerCase() === name.toLowerCase() && i + 2 !== rowNumber);
    if (clash) return { ok: false, message: 'There is already a category called "' + name + '".' };

    const was = rowNumber ? clean_(t.get(t.rows[rowNumber - 2], 'Name'), 80) : '';
    const wasKind = rowNumber ? String(t.get(t.rows[rowNumber - 2], 'Kind')).trim() : kind;
    if (rowNumber && wasKind !== kind && countInTx_(ss, 'Category', was) > 0) {
      return { ok: false, message: '"' + was + '" is already used by entries, so it has to stay a ' + wasKind.toLowerCase() + ' category. Make a new one instead.' };
    }

    const values = {
      'ID': id || newId_('c'),
      'Name': name,
      'Kind': kind,
      'Icon': clean_(input.icon, 8) || '•',
      'Colour': clean_(input.colour, 20) || '#90A4AE',
      'Monthly Budget': toNum_(input.budget) > 0 ? round2_(toNum_(input.budget)) : '',
      'Archived': input.archived ? 'Yes' : '',
      'Created': rowNumber && t.get(t.rows[rowNumber - 2], 'Created') ? t.get(t.rows[rowNumber - 2], 'Created') : new Date(),
    };

    if (rowNumber) {
      writeRow_(t, rowNumber, rowFor_(t, values));
      if (was && was !== name) {
        const moved = renameInTx_(ss, ['Category'], was, name);
        log_(ss, person, 'Renamed category "' + was + '" to "' + name + '" (' + moved + ' entries updated)');
      } else {
        log_(ss, person, 'Changed category "' + name + '"' + (values['Archived'] ? ' (hidden)' : ''));
      }
    } else {
      const at = appendRow_(t, values);
      t.sh.getRange(at, t.col('Monthly Budget')).setNumberFormat('#,##0.00');
      log_(ss, person, 'Added ' + kind.toLowerCase() + ' category "' + name + '"');
    }

    return { ok: true, categories: categories_(ss) };
  });
}

function webMoneySettings(req) {
  return guarded_(req, function (ss, person) {
    const input = (req && req.settings) || {};
    const wanted = {
      'Currency': clean_(input.currency, 8) || '$',
      'Week starts on': Number(input.weekStart) === 0 ? 'Sunday' : 'Monday',
      'Show decimals': Number(input.decimals) === 0 ? 'No' : 'Yes',
    };
    const t = table_(ss, SETTINGS_TAB);
    Object.keys(wanted).forEach(key => {
      let at = 0;
      for (let i = 0; i < t.rows.length; i++) {
        if (clean_(t.get(t.rows[i], 'Key'), 60).toLowerCase() === key.toLowerCase()) { at = i + 2; break; }
      }
      if (at) t.sh.getRange(at, t.col('Value')).setValue(wanted[key]);
      else appendRow_(t, { 'Key': key, 'Value': wanted[key] });
    });
    log_(ss, person, 'Changed settings: ' + Object.keys(wanted).map(k => k + ' = ' + wanted[k]).join(', '));
    return { ok: true, settings: settings_(ss) };
  });
}

// Pull-to-refresh, and what the page falls back on if a write left it unsure.
function webMoneyRefresh(req) {
  return guarded_(req, function (ss) {
    return { ok: true, data: payload_(ss) };
  });
}

// A rename has to carry the old name out of the entries too, or history breaks.
function renameInTx_(ss, headers, from, to) {
  const t = table_(ss, TX_TAB);
  if (!t.rows.length || from === to) return 0;
  let changed = 0;
  headers.forEach(header => {
    const range = t.sh.getRange(2, t.col(header), t.rows.length, 1);
    const values = range.getValues();
    let touched = false;
    for (let i = 0; i < values.length; i++) {
      if (clean_(values[i][0], 80) === from) { values[i][0] = to; touched = true; changed++; }
    }
    if (touched) range.setValues(values);
  });
  return changed;
}

function countInTx_(ss, header, name) {
  if (!name) return 0;
  const t = table_(ss, TX_TAB);
  const want = name.toLowerCase();
  return t.rows.filter(r => clean_(t.get(r, header), 80).toLowerCase() === want).length;
}

// ---- The page itself ------------------------------------------------------

function moneyPageHtml_() {
  return [
    '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8">',
    '<style>' + moneyCss_() + '</style></head><body>',
    '<div id="app"><div class="loading">Loading…</div></div>',
    '<div id="sheet" class="sheet hidden"></div>',
    '<div id="toast" class="toast hidden"></div>',
    '<div id="busy" class="busy hidden"></div>',
    '<script>' + moneyJs_() + '</scr' + 'ipt>',
    '</body></html>',
  ].join('\n');
}

function moneyCss_() {
  return `
:root{color-scheme:dark;--bg:#141a22;--card:#1c2431;--card2:#232d3c;--ink:#eef2f7;--muted:#8b98a9;--line:#2b3644;--good:#2fbf71;--bad:#ff5f5f;--brand:#3d7dff}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;overscroll-behavior:none}
button,input,select{font:inherit;color:inherit}
.hidden{display:none!important}
.loading{padding:40px 16px;text-align:center;color:var(--muted)}
#app{max-width:520px;margin:0 auto;min-height:100%;display:flex;flex-direction:column}

/* top bars */
.bar{display:flex;align-items:center;gap:8px;padding:10px 12px 4px}
.bar .grow{flex:1}
.icon{background:none;border:0;padding:8px;border-radius:10px;font-size:18px;line-height:1;cursor:pointer}
.icon:active{background:var(--card2)}
.chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;max-width:60vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.period{display:flex;align-items:center;justify-content:center;gap:4px;padding:2px 12px 8px}
.period b{font-size:15px;font-weight:600;min-width:150px;text-align:center}

/* hero: the ring */
.hero{position:relative;padding:4px 12px 10px}
.pills{display:flex;gap:8px;margin-bottom:6px}
.pill{flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px;text-align:left;cursor:pointer;display:block}
.pill span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.pill b{font-size:16px;font-weight:600}
.pill.on{border-color:currentColor}
.pill.inc{color:var(--good)}
.pill.exp{color:var(--bad)}
.ringwrap{position:relative;width:100%;max-width:280px;margin:0 auto}
.ringwrap svg{display:block;width:100%;height:auto}
.centre{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}
.centre small{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.centre strong{font-size:26px;font-weight:650;line-height:1.1;margin-top:2px;word-break:break-all;padding:0 34px}
.centre em{font-style:normal;color:var(--muted);font-size:11px;margin-top:4px}

/* category grid */
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:6px 12px 16px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:9px 4px 8px;text-align:center;cursor:pointer;display:block;overflow:hidden}
.tile .em{font-size:20px;line-height:1.1}
.tile .nm{font-size:10.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .am{font-size:11.5px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile.flat .am{color:var(--muted);font-weight:400}

/* bottom dock */
.dock{position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(20,26,34,0),var(--bg) 40%)}
.round{width:58px;height:58px;border-radius:50%;border:0;font-size:30px;font-weight:300;line-height:1;cursor:pointer;color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.35)}
.round.spend{background:var(--bad)}
.round.earn{background:var(--good)}
.dockmid{flex:1;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:12px;text-align:center;font-size:13px;cursor:pointer}

/* plain views */
.view{padding:0 12px 24px}
.head{display:flex;align-items:center;gap:6px;padding:10px 0 6px}
.head h2{margin:0;font-size:17px;font-weight:600;flex:1}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px}
.row{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:8px;width:100%;text-align:left;cursor:pointer}
.row .em{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;flex:0 0 auto}
.row .mid{flex:1;min-width:0}
.row .mid b{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .mid span{display:block;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .amt{font-size:14px;font-weight:600;white-space:nowrap}
.good{color:var(--good)}
.bad{color:var(--bad)}
.dim{color:var(--muted)}
.daysep{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;padding:10px 4px 6px}
.empty{text-align:center;color:var(--muted);padding:28px 12px;font-size:14px}
.bars{height:5px;border-radius:3px;background:var(--card2);margin-top:6px;overflow:hidden}
.bars i{display:block;height:100%;border-radius:3px}
.sum{display:flex;gap:8px;margin:4px 0 10px}
.sum div{flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px}
.sum small{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.sum b{font-size:15px}

/* forms */
label.f{display:block;margin:0 0 10px}
label.f span{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
input[type=text],input[type=number],input[type=date],select{width:100%;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.btn{display:block;width:100%;background:var(--brand);border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:600;color:#fff;cursor:pointer;margin-top:4px}
.btn.ghost{background:var(--card2);color:var(--ink);border:1px solid var(--line)}
.btn.danger{background:transparent;color:var(--bad);border:1px solid var(--bad)}
.two{display:flex;gap:8px}
.two .btn{margin-top:0}
.picks{display:flex;flex-wrap:wrap;gap:6px}
.pick{background:var(--card2);border:1px solid var(--line);border-radius:999px;padding:7px 11px;font-size:13px;cursor:pointer}
.pick.on{border-color:var(--brand);background:rgba(61,125,255,.18)}
.swatch{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
.swatch.on{border-color:#fff}
.emoji{width:38px;height:38px;border-radius:10px;background:var(--card2);border:1px solid var(--line);font-size:19px;cursor:pointer;padding:0}
.emoji.on{border-color:var(--brand)}

/* bottom sheet */
.sheet{position:fixed;inset:0;background:rgba(6,9,13,.6);display:flex;align-items:flex-end;justify-content:center;z-index:30}
.sheet .inner{background:var(--bg);width:100%;max-width:520px;max-height:94vh;overflow:auto;border-radius:18px 18px 0 0;border-top:1px solid var(--line);padding:10px 12px calc(14px + env(safe-area-inset-bottom))}
.handle{width:40px;height:4px;border-radius:2px;background:var(--line);margin:2px auto 10px}
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tabs button{flex:1;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px;font-size:13px;cursor:pointer}
.tabs button.on{background:var(--card2);border-color:var(--brand)}
.amount{display:flex;align-items:baseline;justify-content:flex-end;gap:8px;padding:8px 6px 10px;font-size:34px;font-weight:650;min-height:58px;word-break:break-all}
.amount .op{font-size:16px;color:var(--muted)}
.cats{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:10px;max-height:168px;overflow:auto}
.cats button{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 2px;cursor:pointer;overflow:hidden}
.cats button.on{border-color:var(--brand);background:var(--card2)}
.cats .em{font-size:18px;line-height:1.1}
.cats .nm{font-size:9.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.keys{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
.keys button{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 0;font-size:19px;cursor:pointer}
.keys button.op{background:var(--card2);color:var(--muted);font-size:17px}
.inline{display:flex;gap:8px;margin-bottom:10px}
.inline label.f{flex:1;margin:0}
.toast{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);background:#0b1016;border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-size:13px;z-index:40;max-width:88vw;text-align:center}
.busy{position:fixed;top:0;left:0;right:0;height:3px;background:var(--brand);z-index:50;animation:slide 1.1s linear infinite}
@keyframes slide{0%{opacity:.35}50%{opacity:1}100%{opacity:.35}}
.note{color:var(--muted);font-size:12.5px;margin:2px 0 10px}
a{color:var(--brand)}
`;
}

function moneyJs_() {
  return `
var BOOT = null, CODE = '', D = null;
var S = { view: 'home', mode: 'Expense', unit: 'month', anchor: '', acct: '' };
var M = null;     // the entry being filled in
var EDIT = null;  // the account or category being edited
var CALC = { cur: '', acc: null, op: null };
var ARMED = '';   // what a second tap would delete

var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var UNITS = [['day','Day'],['week','Week'],['month','Month'],['year','Year'],['all','All time']];
var COLOURS = ['#43A047','#FB8C00','#1E88E5','#6D4C41','#FDD835','#7E57C2','#E53935','#EC407A','#AB47BC','#26C6DA','#5C6BC0','#FF7043','#26A69A','#90A4AE','#2E7D32','#0277BD'];
var EMOJI = ['🛒','🍽️','☕','🚌','🚗','⛽','💡','🏠','💊','🛍️','🎬','🧸','📚','🎁','🤲','✈️','📱','🐾','💅','🧾','💼','📈','🏦','🎀','💵','💳','🪙','🏧','➕','➖','💰','🎯'];

// ---- tiny helpers

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setApp(html) { $('app').innerHTML = html; }

function busy(on) { $('busy').className = on ? 'busy' : 'busy hidden'; }

var toastTimer = null;
function toast(msg) {
  var el = $('toast');
  el.textContent = msg;
  el.className = 'toast';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = 'toast hidden'; }, 3200);
}

function call(fn, arg, done) {
  busy(true);
  var runner = google.script.run
    .withSuccessHandler(function (res) {
      busy(false);
      if (!res || !res.ok) {
        if (res && res.needCode) { forget(); renderCode(res.message); return; }
        toast((res && res.message) || 'That did not work.');
        return;
      }
      done(res);
    })
    .withFailureHandler(function (err) {
      busy(false);
      toast(String((err && err.message) || err));
    });
  runner[fn](arg);
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseIso(s) { var p = String(s || '').split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function fmt(n) {
  var dec = D.settings.decimals;
  var s = Math.abs(Number(n) || 0).toFixed(dec);
  var bits = s.split('.');
  bits[0] = bits[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return (Number(n) < -0.0000001 ? '-' : '') + D.settings.currency + bits.join('.');
}

function signed(n, kind) {
  if (kind === 'Transfer') return fmt(n);
  return (kind === 'Income' ? '+' : '-') + fmt(n);
}

function dayLabel(isoDate) {
  var d = parseIso(isoDate);
  var t = parseIso(D.today);
  if (isoDate === D.today) return 'Today';
  if (isoDate === iso(addDays(t, -1))) return 'Yesterday';
  return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + SHORT[d.getMonth()] +
    (d.getFullYear() === t.getFullYear() ? '' : ' ' + d.getFullYear());
}

// ---- the period on show

function range() {
  var a = parseIso(S.anchor || D.today);
  if (S.unit === 'day') return { from: iso(a), to: iso(a), label: dayLabel(iso(a)) };
  if (S.unit === 'week') {
    var back = (a.getDay() - D.settings.weekStart + 7) % 7;
    var s = addDays(a, -back), e = addDays(s, 6);
    return { from: iso(s), to: iso(e), label: s.getDate() + ' ' + SHORT[s.getMonth()] + ' – ' + e.getDate() + ' ' + SHORT[e.getMonth()] };
  }
  if (S.unit === 'month') {
    var ms = new Date(a.getFullYear(), a.getMonth(), 1);
    var me = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { from: iso(ms), to: iso(me), label: MONTHS[a.getMonth()] + ' ' + a.getFullYear() };
  }
  if (S.unit === 'year') {
    return { from: a.getFullYear() + '-01-01', to: a.getFullYear() + '-12-31', label: String(a.getFullYear()) };
  }
  return { from: '0000-01-01', to: '9999-12-31', label: 'All time' };
}

function step(dir) {
  var a = parseIso(S.anchor || D.today);
  if (S.unit === 'day') S.anchor = iso(addDays(a, dir));
  else if (S.unit === 'week') S.anchor = iso(addDays(a, dir * 7));
  else if (S.unit === 'month') S.anchor = iso(addMonths(a, dir));
  else if (S.unit === 'year') S.anchor = iso(new Date(a.getFullYear() + dir, a.getMonth(), 1));
  render();
}

// ---- what to add up

function inAccount(t) {
  if (!S.acct) return true;
  return t.account === S.acct || (t.kind === 'Transfer' && t.to === S.acct);
}

function visible() {
  var r = range();
  return D.tx.filter(function (t) { return t.date >= r.from && t.date <= r.to && inAccount(t); });
}

function totals(list) {
  var out = { inc: 0, exp: 0 };
  list.forEach(function (t) {
    if (t.kind === 'Income') out.inc += t.amount;
    else if (t.kind === 'Expense') out.exp += t.amount;
  });
  return out;
}

function byCategory(list, kind) {
  var map = {};
  list.forEach(function (t) {
    if (t.kind !== kind) return;
    map[t.category] = (map[t.category] || 0) + t.amount;
  });
  return map;
}

function catsOf(kind, withHidden) {
  return D.categories.filter(function (c) { return c.kind === kind && (withHidden || !c.archived); });
}

function cat(name) {
  for (var i = 0; i < D.categories.length; i++) if (D.categories[i].name === name) return D.categories[i];
  return { name: name, icon: '•', colour: '#90A4AE', kind: 'Expense', budget: 0 };
}

function account(name) {
  for (var i = 0; i < D.accounts.length; i++) if (D.accounts[i].name === name) return D.accounts[i];
  return null;
}

function liveAccounts() { return D.accounts.filter(function (a) { return !a.archived; }); }

function balance() {
  if (S.acct) { var a = account(S.acct); return a ? a.balance : 0; }
  var sum = 0;
  liveAccounts().forEach(function (a) { sum += a.balance; });
  return sum;
}

function monthSpend(name, kind) {
  var a = parseIso(D.today);
  var from = iso(new Date(a.getFullYear(), a.getMonth(), 1));
  var to = iso(new Date(a.getFullYear(), a.getMonth() + 1, 0));
  var sum = 0;
  D.tx.forEach(function (t) {
    if (t.category === name && t.kind === kind && t.date >= from && t.date <= to) sum += t.amount;
  });
  return sum;
}

// ---- screens

function render() {
  closeSheet();
  if (!D) return;
  if (S.view === 'records') return renderRecords();
  if (S.view === 'accounts') return renderAccounts();
  if (S.view === 'categories') return renderCategories();
  if (S.view === 'settings') return renderSettings();
  renderHome();
}

function renderCode(message) {
  setApp('<div class="view"><div class="head"><h2>' + 'Money' + '</h2></div>' +
    '<div class="card"><p class="note">Type the access code from the sheet\\'s "People" tab. ' +
    'If the sheet is shared with the Google account you are signed in with, you are let straight in.</p>' +
    (message ? '<p class="note bad">' + esc(message) + '</p>' : '') +
    '<label class="f"><span>Access code</span><input type="text" id="code" autocapitalize="characters" autocomplete="off"></label>' +
    '<button class="btn" data-go="code">Open</button></div></div>');
  var box = $('code');
  if (box) box.focus();
}

function renderHome() {
  var r = range();
  var list = visible();
  var tot = totals(list);
  var sums = byCategory(list, S.mode);
  var mine = catsOf(S.mode, false).slice();
  var extra = Object.keys(sums).filter(function (n) {
    return !mine.some(function (c) { return c.name === n; });
  }).map(function (n) { return cat(n); });
  mine = mine.concat(extra);
  mine.sort(function (a, b) { return (sums[b.name] || 0) - (sums[a.name] || 0) || a.name.localeCompare(b.name); });

  var modeTotal = S.mode === 'Income' ? tot.inc : tot.exp;
  var slices = mine.filter(function (c) { return (sums[c.name] || 0) > 0; })
    .map(function (c) { return { value: sums[c.name], colour: c.colour }; });

  var acc = S.acct ? account(S.acct) : null;
  var accLabel = acc ? acc.icon + ' ' + acc.name : '👝 All accounts';

  var tiles = mine.map(function (c) {
    var v = sums[c.name] || 0;
    return '<button class="tile' + (v ? '' : ' flat') + '" data-go="add:' + esc(c.name) + '">' +
      '<div class="em" style="color:' + esc(c.colour) + '">' + esc(c.icon) + '</div>' +
      '<div class="nm">' + esc(c.name) + '</div>' +
      '<div class="am">' + (v ? esc(fmt(v)) : '—') + '</div></button>';
  }).join('');

  setApp(
    '<div class="bar">' +
      '<button class="icon" data-go="menu">☰</button>' +
      '<button class="chip" data-go="pickacct">' + esc(accLabel) + ' ▾</button>' +
      '<div class="grow"></div>' +
      '<button class="chip" data-go="pickunit">' + esc(unitName()) + ' ▾</button>' +
    '</div>' +
    '<div class="period">' +
      (S.unit === 'all' ? '' : '<button class="icon" data-go="back1">‹</button>') +
      '<b>' + esc(r.label) + '</b>' +
      (S.unit === 'all' ? '' : '<button class="icon" data-go="fwd1">›</button>') +
    '</div>' +
    '<div class="hero">' +
      '<div class="pills">' +
        '<button class="pill inc' + (S.mode === 'Income' ? ' on' : '') + '" data-go="mode:Income"><span>Income</span><b>' + esc(fmt(tot.inc)) + '</b></button>' +
        '<button class="pill exp' + (S.mode === 'Expense' ? ' on' : '') + '" data-go="mode:Expense"><span>Expenses</span><b>' + esc(fmt(tot.exp)) + '</b></button>' +
      '</div>' +
      '<div class="ringwrap">' + ring(slices, modeTotal) +
        '<div class="centre"><small>' + (S.acct ? esc(S.acct) : 'Balance') + '</small>' +
        '<strong class="' + (balance() < 0 ? 'bad' : '') + '">' + esc(fmt(balance())) + '</strong>' +
        '<em>' + (modeTotal ? esc(S.mode === 'Income' ? 'earned ' + fmt(modeTotal) : 'spent ' + fmt(modeTotal)) : 'nothing yet') + '</em></div>' +
      '</div>' +
    '</div>' +
    '<div class="grid">' + tiles + '</div>' +
    dock()
  );
}

function unitName() {
  for (var i = 0; i < UNITS.length; i++) if (UNITS[i][0] === S.unit) return UNITS[i][1];
  return 'Month';
}

function dock() {
  var mid = S.view === 'records'
    ? '<button class="dockmid" data-go="menu">Menu</button>'
    : '<button class="dockmid" data-go="view:records">Records</button>';
  return '<div class="dock">' +
    '<button class="round spend" data-go="new:Expense" title="Expense">−</button>' + mid +
    '<button class="round earn" data-go="new:Income" title="Income">+</button>' +
    '</div>';
}

function ring(slices, total) {
  var C = 2 * Math.PI * 40, off = 0, out = '';
  out += '<circle cx="50" cy="50" r="40" fill="none" stroke="#232d3c" stroke-width="14"/>';
  if (total > 0) {
    slices.forEach(function (s) {
      var len = C * (s.value / total);
      if (!(len > 0)) return;
      var shown = slices.length > 1 && len > 1.4 ? len - 0.8 : len;
      out += '<circle cx="50" cy="50" r="40" fill="none" stroke="' + esc(s.colour) + '" stroke-width="14"' +
        ' stroke-dasharray="' + shown + ' ' + (C - shown) + '" stroke-dashoffset="' + (-off) + '"/>';
      off += len;
    });
  }
  return '<svg viewBox="0 0 100 100"><g transform="rotate(-90 50 50)">' + out + '</g></svg>';
}

// ---- records

function renderRecords() {
  var r = range();
  var list = visible().slice();
  list.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.at || 0) - (a.at || 0);
  });
  var tot = totals(list);
  var out = '';
  var day = '';
  list.forEach(function (t) {
    if (t.date !== day) {
      day = t.date;
      var net = 0;
      list.forEach(function (x) {
        if (x.date !== day) return;
        if (x.kind === 'Income') net += x.amount;
        else if (x.kind === 'Expense') net -= x.amount;
      });
      out += '<div class="daysep"><span>' + esc(dayLabel(day)) + '</span><span>' + (net ? esc((net > 0 ? '+' : '') + fmt(net)) : '') + '</span></div>';
    }
    out += txRow(t);
  });

  setApp(
    '<div class="bar">' +
      '<button class="icon" data-go="view:home">‹</button>' +
      '<button class="chip" data-go="pickacct">' + esc(S.acct ? account(S.acct).icon + ' ' + S.acct : '👝 All accounts') + ' ▾</button>' +
      '<div class="grow"></div>' +
      '<button class="chip" data-go="pickunit">' + esc(unitName()) + ' ▾</button>' +
    '</div>' +
    '<div class="period">' +
      (S.unit === 'all' ? '' : '<button class="icon" data-go="back1">‹</button>') +
      '<b>' + esc(r.label) + '</b>' +
      (S.unit === 'all' ? '' : '<button class="icon" data-go="fwd1">›</button>') +
    '</div>' +
    '<div class="view">' +
      '<div class="sum">' +
        '<div><small>Income</small><b class="good">' + esc(fmt(tot.inc)) + '</b></div>' +
        '<div><small>Expenses</small><b class="bad">' + esc(fmt(tot.exp)) + '</b></div>' +
        '<div><small>Left</small><b class="' + (tot.inc - tot.exp < 0 ? 'bad' : 'good') + '">' + esc(fmt(tot.inc - tot.exp)) + '</b></div>' +
      '</div>' +
      (list.length ? out : '<div class="empty">Nothing in this period yet.<br>Tap − or + to put something in.</div>') +
    '</div>' + dock()
  );
}

function txRow(t) {
  var c = t.kind === 'Transfer' ? { icon: '🔁', colour: '#8b98a9' } : cat(t.category);
  var title = t.kind === 'Transfer' ? 'Transfer' : t.category;
  var sub = t.kind === 'Transfer'
    ? t.account + ' → ' + t.to
    : (t.note ? t.note + ' · ' + t.account : t.account);
  var cls = t.kind === 'Income' ? 'good' : (t.kind === 'Expense' ? 'bad' : 'dim');
  if (t.kind === 'Transfer' && t.note) sub += ' · ' + t.note;
  return '<button class="row" data-go="open:' + esc(t.id) + '">' +
    '<div class="em" style="background:' + esc(c.colour) + '2e;color:' + esc(c.colour) + '">' + esc(c.icon) + '</div>' +
    '<div class="mid"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div>' +
    '<div class="amt ' + cls + '">' + esc(signed(t.amount, t.kind)) + '</div></button>';
}

// ---- accounts

function renderAccounts() {
  var rows = D.accounts.map(function (a) {
    return '<button class="row" data-go="editacct:' + esc(a.id) + '">' +
      '<div class="em" style="background:' + esc(a.colour) + '2e;color:' + esc(a.colour) + '">' + esc(a.icon) + '</div>' +
      '<div class="mid"><b>' + esc(a.name) + (a.archived ? ' <span class="dim">(hidden)</span>' : '') + '</b>' +
      '<span>' + esc(a.type) + ' · starts at ' + esc(fmt(a.start)) + '</span></div>' +
      '<div class="amt ' + (a.balance < 0 ? 'bad' : '') + '">' + esc(fmt(a.balance)) + '</div></button>';
  }).join('');
  var total = 0;
  liveAccounts().forEach(function (a) { total += a.balance; });

  setApp(
    '<div class="view">' +
      '<div class="head"><button class="icon" data-go="view:home">‹</button><h2>Accounts</h2><button class="icon" data-go="menu">☰</button></div>' +
      '<div class="sum"><div><small>Everything together</small><b class="' + (total < 0 ? 'bad' : '') + '">' + esc(fmt(total)) + '</b></div></div>' +
      (rows || '<div class="empty">No accounts yet.</div>') +
      '<div class="two" style="margin-top:10px">' +
        '<button class="btn" data-go="newacct">New account</button>' +
        '<button class="btn ghost" data-go="new:Transfer">Move money</button>' +
      '</div>' +
      '<p class="note">Hiding an account keeps its entries and its balance on the sheet, but takes it out of the pickers.</p>' +
    '</div>' + dock()
  );
}

function accountSheet() {
  var a = EDIT;
  var types = (D.accountTypes || ['Cash', 'Card', 'Bank', 'Savings', 'Wallet', 'Other']).map(function (t) {
    return '<button class="pick' + (a.type === t ? ' on' : '') + '" data-go="atype:' + esc(t) + '">' + esc(t) + '</button>';
  }).join('');
  openSheet(
    '<h3 style="margin:0 0 10px">' + (a.id ? 'Edit account' : 'New account') + '</h3>' +
    '<label class="f"><span>Name</span><input type="text" id="a_name" value="' + esc(a.name) + '"></label>' +
    '<label class="f"><span>Kind</span></label><div class="picks" style="margin:-6px 0 10px">' + types + '</div>' +
    '<label class="f"><span>Icon</span></label><div class="picks" style="margin:-6px 0 10px">' + emojiPicks(a.icon, 'aicon') + '</div>' +
    '<label class="f"><span>Colour</span></label><div class="picks" style="margin:-6px 0 10px">' + colourPicks(a.colour, 'acolour') + '</div>' +
    '<label class="f"><span>Balance it started with</span><input type="text" id="a_start" inputmode="decimal" value="' + esc(a.start) + '"></label>' +
    '<button class="pick' + (a.archived ? ' on' : '') + '" data-go="ahide" style="margin-bottom:12px">' + (a.archived ? '✓ Hidden' : 'Hide this account') + '</button>' +
    '<div class="two"><button class="btn ghost" data-go="close">Cancel</button><button class="btn" data-go="saveacct">Save</button></div>'
  );
}

function grabAccount() {
  if (!EDIT) return;
  if ($('a_name')) EDIT.name = $('a_name').value;
  if ($('a_start')) EDIT.start = $('a_start').value;
}

// ---- categories

function renderCategories() {
  var list = catsOf(S.mode, true);
  var rows = list.map(function (c) {
    var spent = monthSpend(c.name, c.kind);
    var bar = '';
    if (c.budget > 0) {
      var pct = Math.min(100, Math.round(spent / c.budget * 100));
      bar = '<div class="bars"><i style="width:' + pct + '%;background:' + (spent > c.budget ? '#ff5f5f' : esc(c.colour)) + '"></i></div>';
    }
    return '<button class="row" data-go="editcat:' + esc(c.id) + '">' +
      '<div class="em" style="background:' + esc(c.colour) + '2e;color:' + esc(c.colour) + '">' + esc(c.icon) + '</div>' +
      '<div class="mid"><b>' + esc(c.name) + (c.archived ? ' <span class="dim">(hidden)</span>' : '') + '</b>' +
      '<span>this month ' + esc(fmt(spent)) + (c.budget > 0 ? ' of ' + esc(fmt(c.budget)) : '') + '</span>' + bar + '</div></button>';
  }).join('');

  setApp(
    '<div class="view">' +
      '<div class="head"><button class="icon" data-go="view:home">‹</button><h2>Categories</h2><button class="icon" data-go="menu">☰</button></div>' +
      '<div class="tabs">' +
        '<button class="' + (S.mode === 'Expense' ? 'on' : '') + '" data-go="mode:Expense">Spending</button>' +
        '<button class="' + (S.mode === 'Income' ? 'on' : '') + '" data-go="mode:Income">Income</button>' +
      '</div>' +
      (rows || '<div class="empty">No categories here yet.</div>') +
      '<button class="btn" style="margin-top:10px" data-go="newcat">New ' + (S.mode === 'Income' ? 'income' : 'spending') + ' category</button>' +
      '<p class="note">A monthly budget is optional — leave it at 0 and no bar is shown. Renaming a category renames it on every entry too.</p>' +
    '</div>' + dock()
  );
}

function categorySheet() {
  var c = EDIT;
  openSheet(
    '<h3 style="margin:0 0 10px">' + (c.id ? 'Edit category' : 'New category') + '</h3>' +
    '<div class="tabs">' +
      '<button class="' + (c.kind === 'Expense' ? 'on' : '') + '" data-go="ckind:Expense">Spending</button>' +
      '<button class="' + (c.kind === 'Income' ? 'on' : '') + '" data-go="ckind:Income">Income</button>' +
    '</div>' +
    '<label class="f"><span>Name</span><input type="text" id="c_name" value="' + esc(c.name) + '"></label>' +
    '<label class="f"><span>Icon</span></label><div class="picks" style="margin:-6px 0 10px">' + emojiPicks(c.icon, 'cicon') + '</div>' +
    '<label class="f"><span>Colour</span></label><div class="picks" style="margin:-6px 0 10px">' + colourPicks(c.colour, 'ccolour') + '</div>' +
    '<label class="f"><span>Monthly budget (0 for none)</span><input type="text" id="c_budget" inputmode="decimal" value="' + esc(c.budget || 0) + '"></label>' +
    '<button class="pick' + (c.archived ? ' on' : '') + '" data-go="chide" style="margin-bottom:12px">' + (c.archived ? '✓ Hidden' : 'Hide this category') + '</button>' +
    '<div class="two"><button class="btn ghost" data-go="close">Cancel</button><button class="btn" data-go="savecat">Save</button></div>'
  );
}

function grabCategory() {
  if (!EDIT) return;
  if ($('c_name')) EDIT.name = $('c_name').value;
  if ($('c_budget')) EDIT.budget = $('c_budget').value;
}

function emojiPicks(current, verb) {
  var list = EMOJI.slice();
  if (current && list.indexOf(current) === -1) list.unshift(current);
  return list.map(function (e) {
    return '<button class="emoji' + (e === current ? ' on' : '') + '" data-go="' + verb + ':' + esc(e) + '">' + esc(e) + '</button>';
  }).join('');
}

function colourPicks(current, verb) {
  var list = COLOURS.slice();
  if (current && list.indexOf(current) === -1) list.unshift(current);
  return list.map(function (c) {
    return '<button class="swatch' + (c === current ? ' on' : '') + '" style="background:' + esc(c) + '" data-go="' + verb + ':' + esc(c) + '"></button>';
  }).join('');
}

// ---- settings

function renderSettings() {
  var who = BOOT && BOOT.person ? (BOOT.person.name || BOOT.person.email) : '';
  setApp(
    '<div class="view">' +
      '<div class="head"><button class="icon" data-go="view:home">‹</button><h2>Settings</h2><button class="icon" data-go="menu">☰</button></div>' +
      '<div class="card">' +
        '<label class="f"><span>Currency symbol</span><input type="text" id="s_cur" value="' + esc(D.settings.currency) + '" maxlength="4"></label>' +
        '<label class="f"><span>Week starts on</span><select id="s_week">' +
          '<option value="1"' + (D.settings.weekStart === 1 ? ' selected' : '') + '>Monday</option>' +
          '<option value="0"' + (D.settings.weekStart === 0 ? ' selected' : '') + '>Sunday</option>' +
        '</select></label>' +
        '<label class="f"><span>Amounts</span><select id="s_dec">' +
          '<option value="2"' + (D.settings.decimals === 2 ? ' selected' : '') + '>With decimals (12.50)</option>' +
          '<option value="0"' + (D.settings.decimals === 0 ? ' selected' : '') + '>Whole numbers (13)</option>' +
        '</select></label>' +
        '<button class="btn" data-go="savesettings">Save settings</button>' +
      '</div>' +
      '<div class="card">' +
        '<p class="note">Signed in as <b>' + esc(who || 'someone with the access code') + '</b>.<br>' +
        esc(D.total) + ' entries on the sheet' + (D.total > D.tx.length ? ', newest ' + esc(D.tx.length) + ' loaded here' : '') + '.</p>' +
        (D.sheetUrl ? '<a href="' + esc(D.sheetUrl) + '" target="_blank">Open the spreadsheet</a>' : '') +
      '</div>' +
      '<div class="two">' +
        '<button class="btn ghost" data-go="refresh">Reload from the sheet</button>' +
        '<button class="btn danger" data-go="forgetcode">Forget my code</button>' +
      '</div>' +
    '</div>' + dock()
  );
}

// ---- the entry sheet: category, keypad, account, date, note

function defaultAccount() {
  if (S.acct) return S.acct;
  var live = liveAccounts();
  if (live.length) return live[0].name;
  return D.accounts.length ? D.accounts[0].name : '';
}

function otherAccount(not) {
  var live = liveAccounts();
  for (var i = 0; i < live.length; i++) if (live[i].name !== not) return live[i].name;
  return '';
}

function openEntry(opts) {
  var o = opts || {};
  M = {
    id: o.id || '',
    kind: o.kind || 'Expense',
    date: o.date || D.today,
    account: o.account || defaultAccount(),
    to: o.to || '',
    category: o.category || '',
    note: o.note || '',
  };
  if (M.kind === 'Transfer' && !M.to) M.to = otherAccount(M.account);
  CALC = { cur: o.amount ? trimNum(o.amount) : '', acc: null, op: null };
  ARMED = '';
  entrySheet();
}

function openTx(id) {
  for (var i = 0; i < D.tx.length; i++) {
    if (D.tx[i].id === id) return openEntry(D.tx[i]);
  }
  toast('That entry is not loaded any more.');
}

function entrySheet() {
  if (!M) return;
  var isTransfer = M.kind === 'Transfer';

  var list = catsOf(M.kind, false);
  if (M.category && !list.some(function (c) { return c.name === M.category; })) list = [cat(M.category)].concat(list);
  var cats = list.map(function (c) {
    return '<button class="' + (M.category === c.name ? 'on' : '') + '" data-go="cat:' + esc(c.name) + '">' +
      '<div class="em" style="color:' + esc(c.colour) + '">' + esc(c.icon) + '</div>' +
      '<div class="nm">' + esc(c.name) + '</div></button>';
  }).join('');

  var accounts = liveAccounts();
  if (M.account && !accounts.some(function (a) { return a.name === M.account; })) {
    var kept = account(M.account);
    if (kept) accounts = [kept].concat(accounts);
  }
  var fromChips = accounts.map(function (a) {
    return '<button class="pick' + (M.account === a.name ? ' on' : '') + '" data-go="from:' + esc(a.name) + '">' + esc(a.icon + ' ' + a.name) + '</button>';
  }).join('');
  var toChips = accounts.map(function (a) {
    return '<button class="pick' + (M.to === a.name ? ' on' : '') + '" data-go="to:' + esc(a.name) + '">' + esc(a.icon + ' ' + a.name) + '</button>';
  }).join('');

  var keys = [['7', '8', '9', '÷'], ['4', '5', '6', '×'], ['1', '2', '3', '−'], ['.', '0', '⌫', '+']];
  var keypad = keys.map(function (row) {
    return row.map(function (k) {
      if (k === '⌫') return '<button class="op" data-go="back">⌫</button>';
      if (k === '÷') return '<button class="op" data-go="op:/">÷</button>';
      if (k === '×') return '<button class="op" data-go="op:*">×</button>';
      if (k === '−') return '<button class="op" data-go="op:-">−</button>';
      if (k === '+') return '<button class="op" data-go="op:+">+</button>';
      return '<button data-go="key:' + k + '">' + k + '</button>';
    }).join('');
  }).join('');

  var saveLabel = CALC.op ? '=' : (M.id ? 'Save changes' : (isTransfer ? 'Move the money' : 'Add ' + M.kind.toLowerCase()));

  openSheet(
    '<div class="handle"></div>' +
    '<div class="tabs">' +
      '<button class="' + (M.kind === 'Expense' ? 'on' : '') + '" data-go="kind:Expense">Expense</button>' +
      '<button class="' + (M.kind === 'Income' ? 'on' : '') + '" data-go="kind:Income">Income</button>' +
      '<button class="' + (isTransfer ? 'on' : '') + '" data-go="kind:Transfer">Transfer</button>' +
    '</div>' +
    '<div class="amount"><span class="op">' + esc(calcPending()) + '</span>' +
      '<span>' + esc(D.settings.currency + ' ' + calcShown()) + '</span></div>' +
    (isTransfer
      ? '<label class="f"><span>From</span></label><div class="picks" style="margin:-6px 0 10px">' + fromChips + '</div>' +
        '<label class="f"><span>To</span></label><div class="picks" style="margin:-6px 0 10px">' + toChips + '</div>'
      : '<div class="cats">' + cats + '</div>' +
        '<div class="picks" style="margin-bottom:10px">' + fromChips + '</div>') +
    '<div class="inline">' +
      '<label class="f"><span>Date</span><input type="date" id="e_date" data-field="date" value="' + esc(M.date) + '"></label>' +
      '<label class="f"><span>Note</span><input type="text" id="e_note" data-field="note" value="' + esc(M.note) + '" placeholder="optional"></label>' +
    '</div>' +
    '<div class="keys">' + keypad + '</div>' +
    '<button class="btn" style="margin-top:10px" data-go="save">' + esc(saveLabel) + '</button>' +
    (M.id ? '<button class="btn danger" style="margin-top:8px" data-go="del">' + (ARMED === M.id ? 'Tap again to delete it' : 'Delete this entry') + '</button>' : '') +
    '<button class="btn ghost" style="margin-top:8px" data-go="close">Close</button>'
  );
}

// ---- the keypad is a little calculator, the way Monefy's is

function trimNum(v) { return String(Math.round((Number(v) || 0) * 100) / 100); }
function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

function applyOp(a, op, b) {
  a = Number(a) || 0; b = Number(b) || 0;
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') return b ? a / b : 0;
  return b;
}

function calcShown() { return CALC.cur === '' ? (CALC.op ? '0' : '0') : CALC.cur; }

function calcPending() {
  if (!CALC.op) return '';
  var sign = CALC.op === '*' ? '×' : (CALC.op === '/' ? '÷' : CALC.op);
  return trimNum(CALC.acc) + ' ' + sign;
}

function calcKey(k) {
  if (k === '.') {
    if (CALC.cur.indexOf('.') > -1) return;
    CALC.cur = (CALC.cur || '0') + '.';
  } else {
    if (CALC.cur.replace(/[^0-9]/g, '').length >= 12) return;
    CALC.cur = (CALC.cur === '0' ? '' : CALC.cur) + k;
  }
  entrySheet();
}

function calcOp(op) {
  if (CALC.op && CALC.cur !== '') CALC.acc = applyOp(CALC.acc, CALC.op, Number(CALC.cur) || 0);
  else if (CALC.cur !== '') CALC.acc = Number(CALC.cur) || 0;
  else if (CALC.acc === null) CALC.acc = 0;
  CALC.op = op;
  CALC.cur = '';
  entrySheet();
}

function calcBack() {
  if (CALC.cur !== '') CALC.cur = CALC.cur.slice(0, -1);
  else if (CALC.op) { CALC.cur = CALC.acc === null ? '' : trimNum(CALC.acc); CALC.op = null; CALC.acc = null; }
  entrySheet();
}

// Returns true when it only worked out the sum, the way "=" does.
function calcEquals() {
  if (!CALC.op) return false;
  var v = applyOp(CALC.acc, CALC.op, CALC.cur === '' ? 0 : Number(CALC.cur));
  CALC.acc = null; CALC.op = null;
  CALC.cur = trimNum(v < 0 ? 0 : v);
  entrySheet();
  return true;
}

function amountNow() {
  if (CALC.op) return round2(applyOp(CALC.acc, CALC.op, CALC.cur === '' ? 0 : Number(CALC.cur)));
  return round2(Number(CALC.cur) || 0);
}

// ---- saving

function saveEntry() {
  if (!M) return;
  if (calcEquals()) return;
  var amount = amountNow();
  if (!(amount > 0)) { toast('Put in an amount above zero.'); return; }
  if (M.kind === 'Transfer') {
    if (!M.account || !M.to) { toast('Pick both accounts.'); return; }
    if (M.account === M.to) { toast('A transfer needs two different accounts.'); return; }
  } else if (!M.category) {
    toast('Pick a category.'); return;
  }
  if (!M.account) { toast('Pick an account.'); return; }

  var editing = !!M.id;
  var tx = {
    id: M.id, kind: M.kind, amount: amount, date: M.date,
    account: M.account, to: M.kind === 'Transfer' ? M.to : '',
    category: M.kind === 'Transfer' ? '' : M.category, note: M.note,
  };
  call('webMoneySave', { code: CODE, tx: tx }, function (res) {
    applyTx(res.tx);
    D.accounts = res.accounts;
    closeSheet();
    toast(editing ? 'Saved.' : (res.tx.kind === 'Transfer' ? 'Moved ' + fmt(res.tx.amount) : signed(res.tx.amount, res.tx.kind) + ' — ' + res.tx.category));
    render();
  });
}

function applyTx(tx) {
  for (var i = 0; i < D.tx.length; i++) {
    if (D.tx[i].id === tx.id) { D.tx[i] = tx; return; }
  }
  D.tx.push(tx);
  D.total = (D.total || 0) + 1;
}

function deleteEntry() {
  if (!M || !M.id) return;
  if (ARMED !== M.id) { ARMED = M.id; entrySheet(); return; }
  call('webMoneyDelete', { code: CODE, id: M.id }, function (res) {
    D.tx = D.tx.filter(function (t) { return t.id !== res.id; });
    D.total = Math.max(0, (D.total || 1) - 1);
    D.accounts = res.accounts;
    closeSheet();
    toast('Deleted.');
    render();
  });
}

function reload(done) {
  call('webMoneyRefresh', { code: CODE }, function (res) {
    D = res.data;
    render();
    if (done) done();
  });
}

// ---- sheets, pickers and the menu

function openSheet(html) {
  $('sheet').innerHTML = '<div class="inner">' + html + '</div>';
  $('sheet').className = 'sheet';
}

function closeSheet() {
  $('sheet').className = 'sheet hidden';
  $('sheet').innerHTML = '';
  M = null; EDIT = null; ARMED = '';
}

function menuSheet() {
  openSheet('<div class="handle"></div>' +
    '<button class="row" data-go="view:records"><div class="em">🧾</div><div class="mid"><b>Records</b><span>every entry, newest first</span></div></button>' +
    '<button class="row" data-go="view:accounts"><div class="em">👝</div><div class="mid"><b>Accounts</b><span>balances, new accounts</span></div></button>' +
    '<button class="row" data-go="new:Transfer"><div class="em">🔁</div><div class="mid"><b>Move money</b><span>between two accounts</span></div></button>' +
    '<button class="row" data-go="view:categories"><div class="em">🏷️</div><div class="mid"><b>Categories</b><span>icons, colours, budgets</span></div></button>' +
    '<button class="row" data-go="view:settings"><div class="em">⚙️</div><div class="mid"><b>Settings</b><span>currency, week, the sheet</span></div></button>' +
    '<button class="btn ghost" style="margin-top:6px" data-go="close">Close</button>');
}

function acctSheet() {
  var total = 0;
  liveAccounts().forEach(function (a) { total += a.balance; });
  var rows = '<button class="row" data-go="acct:"><div class="em">👝</div>' +
    '<div class="mid"><b>All accounts</b><span>everything together</span></div>' +
    '<div class="amt">' + esc(fmt(total)) + '</div></button>';
  rows += liveAccounts().map(function (a) {
    return '<button class="row" data-go="acct:' + esc(a.name) + '">' +
      '<div class="em" style="background:' + esc(a.colour) + '2e;color:' + esc(a.colour) + '">' + esc(a.icon) + '</div>' +
      '<div class="mid"><b>' + esc(a.name) + '</b><span>' + esc(a.type) + '</span></div>' +
      '<div class="amt ' + (a.balance < 0 ? 'bad' : '') + '">' + esc(fmt(a.balance)) + '</div></button>';
  }).join('');
  openSheet('<div class="handle"></div>' + rows +
    '<button class="btn ghost" style="margin-top:6px" data-go="view:accounts">Manage accounts</button>');
}

function unitSheet() {
  var rows = UNITS.map(function (u) {
    return '<button class="row" data-go="unit:' + u[0] + '"><div class="mid"><b>' + u[1] + '</b></div>' +
      (S.unit === u[0] ? '<div class="amt">✓</div>' : '') + '</button>';
  }).join('');
  openSheet('<div class="handle"></div>' + rows);
}

// ---- wiring

function go(verb, arg) {
  if (verb === 'code') return submitCode();
  if (!D) return;

  if (verb === 'menu') return menuSheet();
  if (verb === 'pickacct') return acctSheet();
  if (verb === 'pickunit') return unitSheet();
  if (verb === 'acct') { S.acct = arg; return render(); }
  if (verb === 'unit') { S.unit = arg; S.anchor = D.today; return render(); }
  if (verb === 'back1') return step(-1);
  if (verb === 'fwd1') return step(1);
  if (verb === 'mode') { S.mode = arg === 'Income' ? 'Income' : 'Expense'; return render(); }
  if (verb === 'view') { S.view = arg; return render(); }
  if (verb === 'close') return closeSheet();
  if (verb === 'refresh') return reload(function () { toast('Up to date.'); });
  if (verb === 'forgetcode') { forget(); BOOT = null; D = null; return renderCode(''); }

  if (verb === 'add') return openEntry({ kind: cat(arg).kind, category: arg });
  if (verb === 'new') return openEntry({ kind: arg });
  if (verb === 'open') return openTx(arg);

  if (verb === 'kind' && M) {
    M.kind = arg;
    if (arg === 'Transfer') { if (!M.to || M.to === M.account) M.to = otherAccount(M.account); }
    else if (M.category && cat(M.category).kind !== arg) M.category = '';
    return entrySheet();
  }
  if (verb === 'cat' && M) { M.category = arg; return entrySheet(); }
  if (verb === 'from' && M) {
    M.account = arg;
    if (M.kind === 'Transfer' && M.to === arg) M.to = otherAccount(arg);
    return entrySheet();
  }
  if (verb === 'to' && M) {
    M.to = arg;
    if (M.account === arg) M.account = otherAccount(arg);
    return entrySheet();
  }
  if (verb === 'key' && M) return calcKey(arg);
  if (verb === 'op' && M) return calcOp(arg);
  if (verb === 'back' && M) return calcBack();
  if (verb === 'save' && M) return saveEntry();
  if (verb === 'del' && M) return deleteEntry();

  if (verb === 'newacct') { EDIT = { id: '', name: '', type: 'Cash', start: 0, icon: '💰', colour: '#1E88E5', archived: false }; return accountSheet(); }
  if (verb === 'editacct') {
    var a = null;
    D.accounts.forEach(function (x) { if (x.id === arg) a = x; });
    if (!a) return;
    EDIT = { id: a.id, name: a.name, type: a.type, start: a.start, icon: a.icon, colour: a.colour, archived: a.archived };
    return accountSheet();
  }
  if (verb === 'atype' && EDIT) { grabAccount(); EDIT.type = arg; return accountSheet(); }
  if (verb === 'aicon' && EDIT) { grabAccount(); EDIT.icon = arg; return accountSheet(); }
  if (verb === 'acolour' && EDIT) { grabAccount(); EDIT.colour = arg; return accountSheet(); }
  if (verb === 'ahide' && EDIT) { grabAccount(); EDIT.archived = !EDIT.archived; return accountSheet(); }
  if (verb === 'saveacct' && EDIT) {
    grabAccount();
    if (!String(EDIT.name).trim()) { toast('An account needs a name.'); return; }
    return call('webMoneyAccount', { code: CODE, account: EDIT }, function () {
      closeSheet();
      reload(function () { toast('Saved.'); });
    });
  }

  if (verb === 'newcat') { EDIT = { id: '', name: '', kind: S.mode, icon: '🏷️', colour: COLOURS[0], budget: 0, archived: false }; return categorySheet(); }
  if (verb === 'editcat') {
    var c = null;
    D.categories.forEach(function (x) { if (x.id === arg) c = x; });
    if (!c) return;
    EDIT = { id: c.id, name: c.name, kind: c.kind, icon: c.icon, colour: c.colour, budget: c.budget, archived: c.archived };
    return categorySheet();
  }
  if (verb === 'ckind' && EDIT) { grabCategory(); EDIT.kind = arg; return categorySheet(); }
  if (verb === 'cicon' && EDIT) { grabCategory(); EDIT.icon = arg; return categorySheet(); }
  if (verb === 'ccolour' && EDIT) { grabCategory(); EDIT.colour = arg; return categorySheet(); }
  if (verb === 'chide' && EDIT) { grabCategory(); EDIT.archived = !EDIT.archived; return categorySheet(); }
  if (verb === 'savecat' && EDIT) {
    grabCategory();
    if (!String(EDIT.name).trim()) { toast('A category needs a name.'); return; }
    return call('webMoneyCategory', { code: CODE, category: EDIT }, function () {
      closeSheet();
      reload(function () { toast('Saved.'); });
    });
  }

  if (verb === 'savesettings') {
    var wanted = {
      currency: ($('s_cur') && $('s_cur').value) || '$',
      weekStart: Number($('s_week') && $('s_week').value),
      decimals: Number($('s_dec') && $('s_dec').value),
    };
    return call('webMoneySettings', { code: CODE, settings: wanted }, function (res) {
      D.settings = res.settings;
      toast('Settings saved.');
      render();
    });
  }
}

function submitCode() {
  var box = $('code');
  CODE = ((box && box.value) || '').trim().toUpperCase();
  if (!CODE) { toast('Type your access code.'); return; }
  try { window.localStorage.setItem('money.code', CODE); } catch (e) { /* private mode */ }
  boot(CODE);
}

function forget() {
  CODE = '';
  try { window.localStorage.removeItem('money.code'); } catch (e) { /* private mode */ }
}

function boot(code) {
  busy(true);
  google.script.run
    .withSuccessHandler(function (res) {
      busy(false);
      if (!res || !res.ok) { renderCode(res && res.message); return; }
      BOOT = res;
      D = res.data;
      if (!S.anchor) S.anchor = D.today;
      S.view = 'home';
      render();
    })
    .withFailureHandler(function (err) {
      busy(false);
      setApp('<div class="empty">' + esc(String((err && err.message) || err)) + '</div>');
    })
    .webMoneyBoot(code || '');
}

function start() {
  try { CODE = window.localStorage.getItem('money.code') || ''; } catch (e) { CODE = ''; }
  boot(CODE);
}

document.addEventListener('click', function (ev) {
  var el = ev.target && ev.target.closest ? ev.target.closest('[data-go]') : null;
  if (!el) {
    if (ev.target && ev.target.id === 'sheet') closeSheet();
    return;
  }
  var raw = el.getAttribute('data-go') || '';
  var at = raw.indexOf(':');
  go(at < 0 ? raw : raw.slice(0, at), at < 0 ? '' : raw.slice(at + 1));
});

function fieldChanged(ev) {
  var el = ev.target;
  if (!el || !el.getAttribute) return;
  var field = el.getAttribute('data-field');
  if (!field || !M) return;
  if (field === 'date') M.date = el.value || D.today;
  if (field === 'note') M.note = el.value;
}
document.addEventListener('input', fieldChanged);
document.addEventListener('change', fieldChanged);

// A real keyboard, for when the app is open on a laptop.
document.addEventListener('keydown', function (ev) {
  if (!M) return;
  var t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
  var k = ev.key;
  if (k >= '0' && k <= '9') { calcKey(k); ev.preventDefault(); }
  else if (k === '.' || k === ',') { calcKey('.'); ev.preventDefault(); }
  else if (k === 'Backspace') { calcBack(); ev.preventDefault(); }
  else if (k === '+' || k === '-' || k === '*' || k === '/') { calcOp(k); ev.preventDefault(); }
  else if (k === 'Enter' || k === '=') { saveEntry(); ev.preventDefault(); }
  else if (k === 'Escape') { closeSheet(); ev.preventDefault(); }
});

window.addEventListener('load', start);
`;
}
