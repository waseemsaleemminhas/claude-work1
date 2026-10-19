/**
 * Ironclad Tech Ledger — the company expense book, on a phone.
 *
 * www.getironcladtech.com
 *
 * ==> THIS GOES IN ITS OWN, BRAND-NEW SPREADSHEET. <==
 * Not the Sales sheet (Code.gs), not the Recruitment sheet (Recruitment.gs), not
 * the personal Money sheet. Its own spreadsheet, its own Apps Script project, its
 * own deployment.
 *
 * What the team gets
 *   ONE link that opens a phone app. Adding a cost is tap, tap, type, done:
 *     tap the category -> type the amount -> Add. The campaign is already filled in.
 *   Everything the floor actually spends on is in it: one bill can carry several
 *   line items (5 headsets + 2 keyboards on one receipt), and every line is split
 *   across the campaigns it belongs to. Overhead splits itself — electricity by
 *   seats, rent by seats — so nobody has to do arithmetic at a fuel pump.
 *
 * The rules this app keeps
 *   - Every line is fully allocated to campaigns, to the last paisa. An entry that
 *     cannot be allocated yet is saved as a DRAFT: the money still comes off the
 *     account (it really did leave), but it sits in the "Needs a campaign" queue
 *     and stays out of the campaign reports until someone finishes it.
 *   - Categories can be added by anyone, mid-entry. A category added that way is
 *     marked "new" so an admin can tidy or merge it later. Merging keeps history.
 *   - Nothing is deleted. Wrong entries are voided, with who and when.
 *   - Cash carried by a person is an account of its own ("Float — Ali"), so an
 *     advance is a transfer, what is left is his balance, and nobody has to
 *     remember who is holding company money.
 *
 * Where the numbers live
 *   The "Entries" tab is the record: one row per voucher, with its lines and
 *   their campaign splits kept exactly (integer paisa) in the Detail column.
 *   The "Lines" and "Allocations" tabs are flat, pivot-ready copies for whoever
 *   does the books — rebuilt nightly, by the Export button in the app, and from
 *   the menu. Saving an entry touches one tab only, which is what keeps the app
 *   quick on a phone.
 *
 * ---- Set up (once) -------------------------------------------------------------
 *  1. Google Drive -> New -> Google Sheet. Name it "Ironclad Ledger".
 *  2. Extensions -> Apps Script. Delete the stub, paste this whole file, Save.
 *  3. Run `setup` and approve the permission prompts. It builds every tab, the BPO
 *     chart of accounts, the allocation rules, your accounts, and your own access
 *     code, and installs the nightly rebuild.
 *  4. Deploy -> New deployment -> type "Web app"
 *       Execute as:      Me
 *       Who has access:  Anyone with a Google account   <-- if the team only uses
 *                                                           the web page
 *                        Anyone                         <-- REQUIRED if the team
 *                                                           uses the Android app
 *     The Android app signs in with its access code, not with a Google account, so
 *     it cannot reach a deployment set to "Anyone with a Google account". With
 *     "Anyone", the link plus a code is what gets someone in: give each person
 *     their own code, keep the link off WhatsApp groups, and change a code the day
 *     somebody leaves.
 *     Deploy, copy the URL, send it to the team. On the phone: open it in Chrome
 *     and use "Add to Home screen", or install the app and paste the link into
 *     Settings.
 *  5. "Ledger" menu -> "People and access codes" to add the team. Anyone opening
 *     the link with a Google account that is on the People tab is let straight in;
 *     everyone else types their code.
 *  6. "Ledger" menu -> "Campaigns" (or the app) to put in your real campaigns and
 *     their seat counts. Seats are what the overhead split divides by.
 *
 *  After pasting a NEW version of this file: Deploy -> Manage deployments -> edit ->
 *  Version: New version -> Deploy. The URL does not change.
 */

// ---- Tabs and fixed lists -------------------------------------------------

const LG_TITLE = 'Ironclad Tech Ledger';

const LG_ENTRIES = 'Entries';
const LG_LINES = 'Lines';
const LG_ALLOCS = 'Allocations';
const LG_CATS = 'Categories';
const LG_GROUPS = 'Category Groups';
const LG_CAMPAIGNS = 'Campaigns';
const LG_ACCOUNTS = 'Accounts';
const LG_RULES = 'Allocation Rules';
const LG_CENTRES = 'Cost Centres';
const LG_VENDORS = 'Vendors';
const LG_PEOPLE = 'People';
const LG_SETTINGS = 'Settings';
const LG_LOG = 'Ledger Log';

const EXPENSE = 'Expense';
const INCOME = 'Income';
const TRANSFER = 'Transfer';
const ENTRY_TYPES = [EXPENSE, INCOME, TRANSFER];

const ST_DRAFT = 'Draft';
const ST_RECORDED = 'Recorded';
const ST_APPROVED = 'Approved';
const ST_VOID = 'Void';

const ROLE_ADMIN = 'Admin';
const ROLE_MANAGER = 'Manager';
const ROLE_MEMBER = 'Member';
const ROLES = [ROLE_ADMIN, ROLE_MANAGER, ROLE_MEMBER];

const ACCOUNT_KINDS = ['Cash', 'Bank', 'Mobile wallet', 'Card', 'Float'];
const CAMPAIGN_KINDS = ['Client', 'Internal'];
const RULE_METHODS = ['Seats', 'Agents', 'Equal'];

// How many of the newest vouchers the app loads. Balances always use every row.
const LG_PAGE = 3000;

// Sheet columns. Found by name, so your own extra columns are left alone.
const H_ENTRIES = ['ID', 'Date', 'Type', 'Status', 'Total', 'Account', 'To Account', 'Vendor',
  'Reference', 'Note', 'Campaigns', 'Categories', 'Entered By', 'Entered At', 'Changed At',
  'Voided By', 'Voided At', 'Detail', 'Receipt'];
const H_LINES = ['Entry ID', 'Line', 'Date', 'Status', 'Type', 'Vendor', 'Paid From', 'Group',
  'Category', 'Cost Centre', 'Description', 'Qty', 'Unit Price', 'Amount', 'Entered By'];
const H_ALLOCS = ['Entry ID', 'Line', 'Date', 'Status', 'Type', 'Group', 'Category', 'Campaign',
  'Campaign Kind', 'Basis', 'Share %', 'Amount', 'Entered By'];
const H_CATS = ['ID', 'Name', 'Group', 'Kind', 'Icon', 'Colour', 'Default Rule', 'Cost Centre',
  'Monthly Budget', 'New', 'Merged Into', 'Archived', 'Sort', 'Added By', 'Added At'];
const H_GROUPS = ['ID', 'Name', 'Kind', 'Sort'];
const H_CAMPAIGNS = ['ID', 'Name', 'Client', 'Code', 'Kind', 'Status', 'Seats', 'Agents',
  'Icon', 'Colour', 'Started', 'Closed'];
const H_ACCOUNTS = ['ID', 'Name', 'Kind', 'Held By', 'Opening Balance', 'Icon', 'Colour', 'Archived'];
const H_RULES = ['ID', 'Name', 'Method', 'Version', 'Archived'];
const H_CENTRES = ['ID', 'Name', 'Archived'];
const H_VENDORS = ['ID', 'Name', 'First Seen', 'Last Seen'];
const H_PEOPLE = ['Name', 'Email', 'Access Code', 'Role', 'Default Campaign', 'Default Account',
  'Active', 'Added'];
const H_SETTINGS = ['Key', 'Value', 'Notes'];
const H_LOG = ['When', 'Who', 'What'];

// ---- What a new ledger starts with ---------------------------------------

const SEED_GROUPS = [
  ['Payroll & people', EXPENSE], ['Facilities', EXPENSE], ['Technology', EXPENSE],
  ['Sales & marketing', EXPENSE], ['Admin & financial', EXPENSE], ['Income', INCOME],
];

// Name, Group, Kind, Icon, Colour, Default allocation rule ('' = pick one campaign)
const SEED_CATS = [
  ['Agent salaries', 'Payroll & people', EXPENSE, '👥', '#43A047', ''],
  ['Supervisor salaries', 'Payroll & people', EXPENSE, '🧑‍💼', '#388E3C', ''],
  ['Management salaries', 'Payroll & people', EXPENSE, '🧑‍💻', '#2E7D32', 'By seats'],
  ['Commissions & bonuses', 'Payroll & people', EXPENSE, '🏆', '#7CB342', ''],
  ['Overtime', 'Payroll & people', EXPENSE, '⏱️', '#9CCC65', ''],
  ['EOBI & social security', 'Payroll & people', EXPENSE, '🏛️', '#689F38', 'By agents'],
  ['Recruitment & ads', 'Payroll & people', EXPENSE, '📢', '#8BC34A', ''],
  ['Training', 'Payroll & people', EXPENSE, '🎓', '#AED581', ''],
  ['Staff meals & tea', 'Payroll & people', EXPENSE, '☕', '#6D4C41', 'By agents'],
  ['Night transport', 'Payroll & people', EXPENSE, '🚐', '#795548', 'By agents'],

  ['Office rent', 'Facilities', EXPENSE, '🏢', '#7E57C2', 'By seats'],
  ['Electricity', 'Facilities', EXPENSE, '⚡', '#FDD835', 'By seats'],
  ['Generator fuel', 'Facilities', EXPENSE, '⛽', '#6D4C41', 'By seats'],
  ['Generator maintenance', 'Facilities', EXPENSE, '🔧', '#8D6E63', 'By seats'],
  ['UPS & batteries', 'Facilities', EXPENSE, '🔋', '#FFB300', 'By seats'],
  ['Water', 'Facilities', EXPENSE, '💧', '#29B6F6', 'By seats'],
  ['Janitorial & supplies', 'Facilities', EXPENSE, '🧹', '#26A69A', 'By seats'],
  ['Security guard', 'Facilities', EXPENSE, '💂', '#546E7A', 'By seats'],
  ['Repairs & maintenance', 'Facilities', EXPENSE, '🛠️', '#78909C', 'By seats'],
  ['Furniture & fixtures', 'Facilities', EXPENSE, '🪑', '#A1887F', 'By seats'],

  ['Internet — primary', 'Technology', EXPENSE, '🌐', '#1E88E5', 'By seats'],
  ['Internet — backup', 'Technology', EXPENSE, '📶', '#42A5F5', 'By seats'],
  ['Dialer / VoIP minutes', 'Technology', EXPENSE, '☎️', '#0277BD', ''],
  ['DIDs & numbers', 'Technology', EXPENSE, '📞', '#039BE5', ''],
  ['CRM subscription', 'Technology', EXPENSE, '🗂️', '#5C6BC0', ''],
  ['Software licences', 'Technology', EXPENSE, '💿', '#3949AB', 'By agents'],
  ['Cloud hosting', 'Technology', EXPENSE, '☁️', '#7986CB', 'By seats'],
  ['Computers & laptops', 'Technology', EXPENSE, '💻', '#455A64', ''],
  ['Headsets', 'Technology', EXPENSE, '🎧', '#00897B', ''],
  ['Peripherals', 'Technology', EXPENSE, '🖱️', '#26C6DA', ''],
  ['IT repairs', 'Technology', EXPENSE, '🔌', '#00ACC1', ''],

  ['Lead purchase', 'Sales & marketing', EXPENSE, '🎯', '#E53935', ''],
  ['Advertising', 'Sales & marketing', EXPENSE, '📣', '#EC407A', ''],
  ['Client entertainment', 'Sales & marketing', EXPENSE, '🍽️', '#FB8C00', ''],
  ['Travel', 'Sales & marketing', EXPENSE, '✈️', '#F4511E', ''],

  ['Bank charges', 'Admin & financial', EXPENSE, '🏦', '#90A4AE', 'By seats'],
  ['Wire & gateway fees', 'Admin & financial', EXPENSE, '💱', '#B0BEC5', ''],
  ['FX loss', 'Admin & financial', EXPENSE, '📉', '#9E9E9E', ''],
  ['Taxes & government fees', 'Admin & financial', EXPENSE, '🧾', '#757575', 'By seats'],
  ['Legal & professional', 'Admin & financial', EXPENSE, '⚖️', '#607D8B', 'By seats'],
  ['Accounting', 'Admin & financial', EXPENSE, '📊', '#546E7A', 'By seats'],
  ['Insurance', 'Admin & financial', EXPENSE, '🛡️', '#78909C', 'By seats'],
  ['Courier', 'Admin & financial', EXPENSE, '📦', '#8D6E63', ''],
  ['Printing & stationery', 'Admin & financial', EXPENSE, '🖨️', '#A1887F', 'By seats'],
  ['Miscellaneous', 'Admin & financial', EXPENSE, '➖', '#90A4AE', ''],

  ['Client payment', 'Income', INCOME, '💵', '#2E7D32', ''],
  ['Commission income', 'Income', INCOME, '💰', '#00897B', ''],
  ['Other income', 'Income', INCOME, '➕', '#90A4AE', ''],
];

const SEED_RULES = [
  ['By seats', 'Seats'],
  ['By agents', 'Agents'],
  ['Equal split', 'Equal'],
];

// A new ledger starts with no campaigns, which means one book for the whole
// company. Add a client campaign here (or in the app) and the splitting turns
// itself back on.
// Name, Client, Code, Kind, Seats, Agents, Icon, Colour
const SEED_CAMPAIGNS = [];

const SEED_ACCOUNTS = [
  ['Petty cash', 'Cash', '', 0, '💵', '#43A047'],
  ['Bank — main', 'Bank', '', 0, '🏦', '#1E88E5'],
  ['JazzCash', 'Mobile wallet', '', 0, '📱', '#7E57C2'],
];

const SEED_CENTRES = ['Operations', 'Sales', 'HR', 'IT', 'Admin', 'Finance'];

const SEED_SETTINGS = [
  ['Currency', 'Rs', 'The symbol shown in the app.'],
  ['Show decimals', 'No', 'No rounds every amount shown to whole rupees. The paisa are still kept.'],
  ['Week starts on', 'Monday', 'Monday or Sunday — used by the Week view.'],
  ['Block saving without a campaign', 'No',
    'No  = an entry with no campaign saves as a Draft and waits in "Needs a campaign".\n' +
    'Yes = the app refuses to save it at all.'],
];

// ---- Menu -----------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ledger')
    .addItem('Set up / update everything (safe to re-run)', 'setup')
    .addItem('Show the app link', 'lgShowLink')
    .addItem('People and access codes', 'lgShowCodes')
    .addSeparator()
    .addItem('Rebuild the Lines and Allocations tabs', 'rebuildReportTabs')
    .addItem('Check the books add up', 'checkLedger')
    .addToUi();
}

// ---- Setup ----------------------------------------------------------------

// Safe to run again: it only adds what is missing and leaves your rows alone.
function setup() {
  const ss = SpreadsheetApp.getActive();
  lgTab_(ss, LG_ENTRIES, H_ENTRIES);
  lgTab_(ss, LG_LINES, H_LINES);
  lgTab_(ss, LG_ALLOCS, H_ALLOCS);
  lgTab_(ss, LG_GROUPS, H_GROUPS);
  lgTab_(ss, LG_CATS, H_CATS);
  lgTab_(ss, LG_CAMPAIGNS, H_CAMPAIGNS);
  lgTab_(ss, LG_ACCOUNTS, H_ACCOUNTS);
  lgTab_(ss, LG_RULES, H_RULES);
  lgTab_(ss, LG_CENTRES, H_CENTRES);
  lgTab_(ss, LG_VENDORS, H_VENDORS);
  lgTab_(ss, LG_PEOPLE, H_PEOPLE);
  lgTab_(ss, LG_SETTINGS, H_SETTINGS);
  lgTab_(ss, LG_LOG, H_LOG);

  lgSeed_(ss, LG_GROUPS, SEED_GROUPS.map((g, i) => ({
    'ID': uid_('g'), 'Name': g[0], 'Kind': g[1], 'Sort': (i + 1) * 10,
  })));
  lgSeed_(ss, LG_RULES, SEED_RULES.map(r => ({
    'ID': uid_('r'), 'Name': r[0], 'Method': r[1], 'Version': 1, 'Archived': '',
  })));
  lgSeed_(ss, LG_CATS, SEED_CATS.map((c, i) => ({
    'ID': uid_('c'), 'Name': c[0], 'Group': c[1], 'Kind': c[2], 'Icon': c[3], 'Colour': c[4],
    'Default Rule': c[5], 'Cost Centre': '', 'Monthly Budget': '', 'New': '', 'Merged Into': '',
    'Archived': '', 'Sort': (i + 1) * 10, 'Added By': 'setup', 'Added At': new Date(),
  })));
  lgSeed_(ss, LG_CAMPAIGNS, SEED_CAMPAIGNS.map(c => ({
    'ID': uid_('p'), 'Name': c[0], 'Client': c[1], 'Code': c[2], 'Kind': c[3], 'Status': 'Active',
    'Seats': c[4], 'Agents': c[5], 'Icon': c[6], 'Colour': c[7], 'Started': new Date(), 'Closed': '',
  })));
  lgSeed_(ss, LG_ACCOUNTS, SEED_ACCOUNTS.map(a => ({
    'ID': uid_('a'), 'Name': a[0], 'Kind': a[1], 'Held By': a[2], 'Opening Balance': a[3],
    'Icon': a[4], 'Colour': a[5], 'Archived': '',
  })));
  lgSeed_(ss, LG_CENTRES, SEED_CENTRES.map(n => ({ 'ID': uid_('k'), 'Name': n, 'Archived': '' })));

  lgSeedSettings_(ss);
  lgEnsureMe_(ss);
  lgFormats_(ss);
  lgInstallNightly_();
  rebuildReportTabs();
  lgDropStub_(ss);
  lgShowLink();
}

function lgTab_(ss, name, headers) {
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

// Only fills a tab that is still empty, so re-running setup never doubles it up.
function lgSeed_(ss, name, records) {
  const t = lgTable_(ss, name);
  if (t.rows.length || !records.length) return;
  const rows = records.map(r => lgRow_(t, r));
  t.sh.getRange(2, 1, rows.length, t.head.length).setValues(rows);
}

function lgSeedSettings_(ss) {
  const t = lgTable_(ss, LG_SETTINGS);
  const have = {};
  t.rows.forEach(r => { have[txt_(t.get(r, 'Key'), 60)] = true; });
  const add = SEED_SETTINGS.filter(s => !have[s[0]]);
  if (!add.length) return;
  const rows = add.map(s => lgRow_(t, { 'Key': s[0], 'Value': s[1], 'Notes': s[2] }));
  t.sh.getRange(t.rows.length + 2, 1, rows.length, t.head.length).setValues(rows);
}

// Whoever runs setup is the first admin.
function lgEnsureMe_(ss) {
  const email = whoami_();
  const t = lgTable_(ss, LG_PEOPLE);
  if (t.rows.some(r => txt_(t.get(r, 'Email'), 120).toLowerCase() === email.toLowerCase())) return;
  lgAppend_(t, {
    'Name': email ? email.split('@')[0] : 'Me', 'Email': email, 'Access Code': newCode_(),
    'Role': ROLE_ADMIN, 'Default Campaign': '', 'Default Account': '', 'Active': 'Yes',
    'Added': new Date(),
  });
}

function lgFormats_(ss) {
  const money = '#,##0.00';
  const pairs = [
    [LG_ENTRIES, 'Total', money], [LG_ENTRIES, 'Date', 'yyyy-mm-dd'],
    [LG_LINES, 'Amount', money], [LG_LINES, 'Unit Price', money], [LG_LINES, 'Date', 'yyyy-mm-dd'],
    [LG_ALLOCS, 'Amount', money], [LG_ALLOCS, 'Date', 'yyyy-mm-dd'],
    [LG_CATS, 'Monthly Budget', money], [LG_ACCOUNTS, 'Opening Balance', money],
  ];
  pairs.forEach(p => {
    const t = lgTable_(ss, p[0]);
    t.sh.getRange(2, t.col(p[1]), Math.max(t.sh.getMaxRows() - 1, 1), 1).setNumberFormat(p[2]);
  });
  lgChoices_(ss, LG_ENTRIES, 'Type', ENTRY_TYPES);
  lgChoices_(ss, LG_ENTRIES, 'Status', [ST_DRAFT, ST_RECORDED, ST_APPROVED, ST_VOID]);
  lgChoices_(ss, LG_CATS, 'Kind', [EXPENSE, INCOME]);
  lgChoices_(ss, LG_ACCOUNTS, 'Kind', ACCOUNT_KINDS);
  lgChoices_(ss, LG_CAMPAIGNS, 'Kind', CAMPAIGN_KINDS);
  lgChoices_(ss, LG_CAMPAIGNS, 'Status', ['Active', 'Paused', 'Closed']);
  lgChoices_(ss, LG_RULES, 'Method', RULE_METHODS);
  lgChoices_(ss, LG_PEOPLE, 'Role', ROLES);
}

function lgChoices_(ss, tab, header, choices) {
  const t = lgTable_(ss, tab);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(choices, true)
    .setAllowInvalid(false).build();
  t.sh.getRange(2, t.col(header), Math.max(t.sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

function lgInstallNightly_() {
  const have = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'rebuildReportTabs');
  if (have) return;
  ScriptApp.newTrigger('rebuildReportTabs').timeBased().atHour(3).everyDays(1).create();
}

function lgDropStub_(ss) {
  const sh = ss.getSheetByName('Sheet1');
  if (sh && ss.getSheets().length > 1 && sh.getLastRow() === 0 && sh.getLastColumn() === 0) {
    ss.deleteSheet(sh);
  }
}

// ---- Reading and writing a tab -------------------------------------------

function lgTable_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('The "' + name + '" tab is missing. Run "Set up / update everything" from the Ledger menu.');
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(v => String(v).trim());
  const idx = {};
  head.forEach((h, i) => { if (h && idx[h] === undefined) idx[h] = i; });
  const last = sh.getLastRow();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, width).getValues();
  return {
    sh: sh, name: name, head: head, idx: idx, rows: rows,
    col: function (h) {
      const i = idx[h];
      if (i === undefined) throw new Error('Column "' + h + '" is missing on the "' + name + '" tab. Run "Set up / update everything".');
      return i + 1;
    },
    get: function (row, h) {
      const i = idx[h];
      return i === undefined ? '' : row[i];
    },
  };
}

function lgRow_(t, values) {
  const row = new Array(t.head.length).fill('');
  Object.keys(values).forEach(h => {
    const i = t.idx[h];
    if (i !== undefined) row[i] = values[h];
  });
  return row;
}

function lgWrite_(t, rowNumber, values) {
  t.sh.getRange(rowNumber, 1, 1, t.head.length).setValues([lgRow_(t, values)]);
  return rowNumber;
}

function lgAppend_(t, values) {
  const at = t.sh.getLastRow() + 1;
  if (at > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), 50);
  return lgWrite_(t, at, values);
}

function lgRowOf_(t, id) {
  const want = String(id).trim();
  if (!want) return 0;
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.get(t.rows[i], 'ID')).trim() === want) return i + 2;
  }
  return 0;
}

function note_(ss, person, what) {
  try {
    lgAppend_(lgTable_(ss, LG_LOG), {
      'When': new Date(), 'Who': (person && (person.email || person.name)) || '', 'What': what,
    });
  } catch (err) {
    Logger.log('log: ' + err);
  }
}

// ---- Small helpers --------------------------------------------------------

function txt_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

// Everything is counted in paisa, as whole numbers. Money never touches a float.
function minor_(v) {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : 0;
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? Math.round(n * 100) : 0;
}

function rupees_(minorUnits) {
  return Math.round(Number(minorUnits) || 0) / 100;
}

function uid_(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
}

function newCode_() {
  const alphabet = 'ACDEFGHJKLMNPQRTUVWXY34679';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return out;
}

function whoami_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

function isoD_(v, tz) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

// Midday, so no timezone or daylight-saving shift can move it to another day.
function dateOf_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function lgAlert_(msg) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(LG_TITLE, msg, ui.ButtonSet.OK);
  } catch (err) {
    Logger.log(msg);
  }
}

function lgShowLink() {
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { url = ''; }
  lgAlert_(url
    ? 'The app link:\n\n' + url + '\n\nOpen it in Chrome on the phone and use "Add to Home screen".'
    : 'Not deployed yet. Deploy -> New deployment -> Web app (Execute as: Me), then this menu shows the link.');
}

function lgShowCodes() {
  const t = lgTable_(SpreadsheetApp.getActive(), LG_PEOPLE);
  const lines = t.rows
    .filter(r => txt_(t.get(r, 'Name'), 80) || txt_(t.get(r, 'Email'), 120))
    .map(r => (txt_(t.get(r, 'Name'), 80) || txt_(t.get(r, 'Email'), 120)) +
      '  —  ' + txt_(t.get(r, 'Access Code'), 12) + '  (' + txt_(t.get(r, 'Role'), 20) + ')');
  lgAlert_(lines.length
    ? 'Who can use the app:\n\n' + lines.join('\n') +
      '\n\nTo add someone: put their name, email, any code you like, and a role on the "People" tab.\n' +
      'Admin can do everything. Manager can fix anyone\'s entries. Member adds and fixes their own.'
    : 'Nobody on the "People" tab yet. Run "Set up / update everything".');
}

// ---- Who is allowed in ----------------------------------------------------

function person_(ss, code) {
  const t = lgTable_(ss, LG_PEOPLE);
  const email = whoami_().toLowerCase();
  const typed = txt_(code, 12).toLowerCase();
  let byCode = null;
  for (let i = 0; i < t.rows.length; i++) {
    const r = t.rows[i];
    if (/^no$/i.test(txt_(t.get(r, 'Active'), 10))) continue;
    const rowEmail = txt_(t.get(r, 'Email'), 120);
    const rowCode = txt_(t.get(r, 'Access Code'), 12);
    const out = {
      name: txt_(t.get(r, 'Name'), 80) || rowEmail,
      email: rowEmail,
      code: rowCode,
      role: ROLES.indexOf(txt_(t.get(r, 'Role'), 20)) === -1 ? ROLE_MEMBER : txt_(t.get(r, 'Role'), 20),
      campaign: txt_(t.get(r, 'Default Campaign'), 80),
      account: txt_(t.get(r, 'Default Account'), 80),
    };
    if (email && rowEmail && rowEmail.toLowerCase() === email) return out;
    if (typed && rowCode && rowCode.toLowerCase() === typed) byCode = out;
  }
  return byCode;
}

function canEdit_(person, entry) {
  if (!person) return false;
  if (person.role === ROLE_ADMIN || person.role === ROLE_MANAGER) return true;
  return !entry || entry.enteredBy === person.email || entry.enteredBy === person.name;
}

// ---- Splitting a line across campaigns -----------------------------------

/**
 * Hands out `amountMinor` paisa over the given weights so the parts add up to the
 * whole, exactly. Largest remainder, and ties broken by campaign NAME — the key the
 * data itself carries — so the sheet, the page and the Android app all land on the
 * same paisa when two of them work out the same entry.
 */
function splitExact_(amountMinor, weights) {
  const useful = weights.filter(w => Number(w.weight) > 0);
  if (!useful.length || !amountMinor) return [];
  const total = useful.reduce((sum, w) => sum + Number(w.weight), 0);
  const parts = useful.map(w => {
    const raw = amountMinor * Number(w.weight) / total;
    const base = Math.floor(raw);
    return { campaignId: w.campaignId, amountMinor: base, remainder: raw - base };
  });
  let left = amountMinor - parts.reduce((sum, p) => sum + p.amountMinor, 0);
  parts.slice()
    .sort((a, b) => (b.remainder - a.remainder) || (a.campaignId < b.campaignId ? -1 : 1))
    .forEach(p => { if (left > 0) { p.amountMinor += 1; left--; } });
  return parts
    .filter(p => p.amountMinor > 0)
    .map(p => ({
      campaignId: p.campaignId,
      bp: Math.round(p.amountMinor * 10000 / amountMinor),
      amountMinor: p.amountMinor,
    }));
}

// Overhead is shared out over the campaigns that are actually running. Internal
// campaigns are a place to put company spending, not somewhere rent lands.
function ruleWeights_(rule, campaigns) {
  const live = campaigns.filter(c => c.status === 'Active' && c.kind === 'Client');
  if (rule.method === 'Seats') return live.map(c => ({ campaignId: c.name, weight: c.seats }));
  if (rule.method === 'Agents') return live.map(c => ({ campaignId: c.name, weight: c.agents }));
  return live.map(c => ({ campaignId: c.name, weight: 1 }));
}

/**
 * Works out one line's allocations. Returns [] when it cannot be settled yet —
 * that is what makes the entry a draft rather than a guess.
 */
// A campaign by its id or its name, whichever the page sent.
function campOf_(ctx, key) {
  const want = txt_(key, 80);
  if (!want) return null;
  return ctx.campaignById[want] || ctx.campaignByName[want.toLowerCase()] || null;
}

function allocateLine_(line, ctx) {
  const amount = line.amountMinor;
  const method = line.allocationMethod;

  if (method === 'direct') {
    const campaign = campOf_(ctx, line.campaignId);
    if (!campaign) return { allocations: [], basis: 'direct' };
    return {
      basis: 'direct',
      allocations: [{ campaignId: campaign.name, bp: 10000, amountMinor: amount }],
    };
  }

  if (method === 'split') {
    const wanted = (line.allocations || [])
      .map(a => ({ campaign: campOf_(ctx, a.campaignId || a.campaign), bp: Number(a.bp) }))
      .filter(a => a.campaign && a.bp > 0);
    if (!wanted.length) return { allocations: [], basis: 'direct' };
    const seen = {};
    for (let i = 0; i < wanted.length; i++) {
      if (seen[wanted[i].campaign.id]) return { allocations: [], basis: 'direct', error: 'the same campaign is in the split twice.' };
      seen[wanted[i].campaign.id] = true;
    }
    return {
      basis: 'direct',
      allocations: splitExact_(amount, wanted.map(a => ({ campaignId: a.campaign.name, weight: a.bp }))),
    };
  }

  const rule = ctx.ruleById[line.allocationRuleId] || ctx.ruleByName[txt_(line.allocationRuleId, 60).toLowerCase()];
  if (!rule) return { allocations: [], basis: 'apportioned' };
  const parts = splitExact_(amount, ruleWeights_(rule, ctx.campaignList));
  return { allocations: parts, basis: 'apportioned', ruleId: rule.id, ruleVersion: rule.version };
}

// ---- Checking an entry before it is written ------------------------------

// The splits the phone sent, if they are whole and name campaigns we know.
function frozenAllocations_(raw, amount, ctx) {
  const sent = raw && raw.allocations;
  if (!sent || !sent.length) return null;
  let sum = 0;
  const kept = [];
  for (let i = 0; i < sent.length; i++) {
    const campaign = campOf_(ctx, sent[i].campaign || sent[i].campaignId);
    const share = Math.round(Number(sent[i].amountMinor) || 0);
    if (!campaign || !(share > 0)) return null;
    sum += share;
    kept.push({ campaignId: campaign.name, bp: Math.round(Number(sent[i].bp) || 0), amountMinor: share });
  }
  if (sum !== amount) return null;
  return {
    allocations: kept,
    basis: raw.basis === 'apportioned' ? 'apportioned' : 'direct',
    ruleId: null,
    ruleVersion: raw.allocationRuleVersion || null,
  };
}

function prepareEntry_(raw, ctx, trustSettled) {
  const req = raw || {};
  const type = ENTRY_TYPES.indexOf(txt_(req.type, 20)) === -1 ? '' : txt_(req.type, 20);
  if (!type) return { error: 'Say whether this is an expense, income or a transfer.' };

  const given = txt_(req.date, 20);
  const date = given ? isoD_(given, ctx.tz) : ctx.today;
  if (!dateOf_(date)) return { error: 'That date does not look right.' };
  if (date > ctx.tomorrow) return { error: 'That date is in the future.' };

  const account = ctx.accountByName[txt_(req.account, 80).toLowerCase()];
  if (!account) return { error: 'Pick the account the money moved on.' };

  if (type === TRANSFER) {
    const to = ctx.accountByName[txt_(req.toAccount, 80).toLowerCase()];
    if (!to) return { error: 'Pick the account the money goes to.' };
    if (to.name === account.name) return { error: 'A transfer needs two different accounts.' };
    const amount = minor_(req.totalMinor != null ? rupees_(req.totalMinor) : req.total);
    if (!(amount > 0)) return { error: 'Put in an amount above zero.' };
    return {
      value: {
        type: type, date: date, account: account.name, toAccount: to.name, vendor: '',
        reference: txt_(req.reference, 40), note: txt_(req.note, 200),
        totalMinor: amount, lines: [], status: ST_RECORDED,
      },
    };
  }

  const rawLines = (req.lines || []).filter(l => l && minor_(rupees_(l.amountMinor || 0)) !== 0);
  if (!rawLines.length) return { error: 'Add at least one line.' };
  if (rawLines.length > 30) return { error: 'That is more than 30 lines. Split it into two vouchers.' };

  const lines = [];
  let total = 0;
  let unallocated = false;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const amount = Math.round(Number(raw.amountMinor) || 0);
    if (!(amount > 0)) return { error: 'Line ' + (i + 1) + ' needs an amount above zero.' };

    const category = ctx.categoryByName[txt_(raw.category, 80).toLowerCase()];
    if (!category) return { error: 'Line ' + (i + 1) + ': pick a category.' };
    if (category.kind !== type) return { error: '"' + category.name + '" is a ' + category.kind.toLowerCase() + ' category.' };
    if (category.mergedInto) return { error: '"' + category.name + '" was merged into another category. Pick that one.' };

    const qty = Number(raw.qty) > 0 ? Number(raw.qty) : null;
    const unit = raw.unitPriceMinor != null ? Math.round(Number(raw.unitPriceMinor)) : null;
    if (qty !== null && unit !== null && Math.round(qty * unit) !== amount) {
      return { error: 'Line ' + (i + 1) + ': quantity times unit price does not make the amount.' };
    }

    const centre = ctx.centreByName[txt_(raw.costCentre, 80).toLowerCase()];

    // A phone works the split out when the entry is made and freezes it. On the way
    // up we keep those numbers rather than working them out again, or a voucher
    // entered last month would quietly re-split itself on today's seat counts.
    const frozen = trustSettled ? frozenAllocations_(raw, amount, ctx) : null;
    const settled = frozen || allocateLine_({
      amountMinor: amount,
      allocationMethod: ['direct', 'split', 'rule'].indexOf(raw.allocationMethod) === -1 ? 'direct' : raw.allocationMethod,
      campaignId: raw.campaign || raw.campaignId,
      allocationRuleId: raw.allocationRule || raw.allocationRuleId,
      allocations: raw.allocations,
    }, ctx);
    if (settled.error) return { error: 'Line ' + (i + 1) + ': ' + settled.error };

    const sum = settled.allocations.reduce((s, a) => s + a.amountMinor, 0);
    if (settled.allocations.length && sum !== amount) {
      return { error: 'Line ' + (i + 1) + ': the campaign split does not add up. Try it again.' };
    }
    if (!settled.allocations.length) unallocated = true;

    lines.push({
      no: i + 1,
      category: category.name,
      group: category.group,
      description: txt_(raw.description, 160),
      qty: qty,
      unitPriceMinor: unit,
      amountMinor: amount,
      costCentre: centre ? centre.name : (category.costCentre || ''),
      allocationMethod: frozen ? txt_(raw.allocationMethod, 10) || 'direct'
        : (settled.ruleId ? 'rule' : (settled.allocations.length > 1 ? 'split' : 'direct')),
      allocationRule: frozen ? txt_(raw.allocationRule, 60)
        : (settled.ruleId ? (ctx.ruleById[settled.ruleId] || {}).name || '' : ''),
      allocationRuleVersion: settled.ruleVersion || null,
      basis: settled.basis,
      allocations: settled.allocations.map(a => ({
        campaign: a.campaignId,
        bp: a.bp,
        amountMinor: a.amountMinor,
      })),
    });
    total += amount;
  }

  if (unallocated && ctx.usingCampaigns && ctx.settings.blockWithoutCampaign) {
    return { error: 'Every line needs a campaign before this can be saved.' };
  }

  return {
    value: {
      type: type, date: date, account: account.name, toAccount: '',
      vendor: txt_(req.vendor, 80), reference: txt_(req.reference, 40), note: txt_(req.note, 200),
      totalMinor: total, lines: lines,
      status: (unallocated && ctx.usingCampaigns) ? ST_DRAFT : ST_RECORDED,
    },
  };
}

// Everything the checks above need to look things up, read once per request.
function context_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const ctx = {
    tz: tz,
    today: today,
    tomorrow: Utilities.formatDate(new Date(Date.now() + 86400000), tz, 'yyyy-MM-dd'),
    settings: settings_(ss),
    campaignList: campaigns_(ss),
    categoryList: categories_(ss),
    accountList: accounts_(ss),
    ruleList: rules_(ss),
    centreList: centres_(ss),
    campaignById: {}, campaignByName: {}, categoryByName: {},
    accountByName: {}, ruleById: {}, ruleByName: {}, centreByName: {},
  };
  ctx.campaignList.forEach(c => {
    ctx.campaignById[c.id] = c;
    ctx.campaignByName[c.name.toLowerCase()] = c;
  });
  // No client campaign running means the ledger is one book for the whole
  // company: a line needs nothing but its category.
  ctx.usingCampaigns = ctx.campaignList.some(c => c.status === 'Active' && c.kind === 'Client');
  ctx.categoryList.forEach(c => { ctx.categoryByName[c.name.toLowerCase()] = c; });
  ctx.accountList.forEach(a => { ctx.accountByName[a.name.toLowerCase()] = a; });
  ctx.ruleList.forEach(r => { ctx.ruleById[r.id] = r; ctx.ruleByName[r.name.toLowerCase()] = r; });
  ctx.centreList.forEach(c => { ctx.centreByName[c.name.toLowerCase()] = c; });
  return ctx;
}

// ---- Reading the reference tabs ------------------------------------------

function settings_(ss) {
  const t = lgTable_(ss, LG_SETTINGS);
  const map = {};
  t.rows.forEach(r => {
    const k = txt_(t.get(r, 'Key'), 60);
    if (k) map[k] = txt_(t.get(r, 'Value'), 60);
  });
  return {
    currency: map['Currency'] || 'Rs',
    decimals: /^n/i.test(map['Show decimals'] || 'No') ? 0 : 2,
    weekStart: /^sun/i.test(map['Week starts on'] || '') ? 0 : 1,
    blockWithoutCampaign: /^y/i.test(map['Block saving without a campaign'] || 'No'),
  };
}

function campaigns_(ss) {
  const t = lgTable_(ss, LG_CAMPAIGNS);
  return t.rows.map(r => ({
    id: String(t.get(r, 'ID')).trim(),
    name: txt_(t.get(r, 'Name'), 80),
    client: txt_(t.get(r, 'Client'), 80),
    code: txt_(t.get(r, 'Code'), 20),
    kind: CAMPAIGN_KINDS.indexOf(txt_(t.get(r, 'Kind'), 20)) === -1 ? 'Client' : txt_(t.get(r, 'Kind'), 20),
    status: txt_(t.get(r, 'Status'), 20) || 'Active',
    seats: Math.max(0, Math.round(Number(t.get(r, 'Seats')) || 0)),
    agents: Math.max(0, Math.round(Number(t.get(r, 'Agents')) || 0)),
    icon: txt_(t.get(r, 'Icon'), 8) || '🎯',
    colour: txt_(t.get(r, 'Colour'), 20) || '#1E88E5',
  })).filter(c => c.id && c.name);
}

function categories_(ss) {
  const t = lgTable_(ss, LG_CATS);
  return t.rows.map(r => ({
    id: String(t.get(r, 'ID')).trim(),
    name: txt_(t.get(r, 'Name'), 80),
    group: txt_(t.get(r, 'Group'), 80),
    kind: txt_(t.get(r, 'Kind'), 20) === INCOME ? INCOME : EXPENSE,
    icon: txt_(t.get(r, 'Icon'), 8) || '•',
    colour: txt_(t.get(r, 'Colour'), 20) || '#90A4AE',
    rule: txt_(t.get(r, 'Default Rule'), 60),
    costCentre: txt_(t.get(r, 'Cost Centre'), 80),
    budgetMinor: minor_(t.get(r, 'Monthly Budget')),
    isNew: !!txt_(t.get(r, 'New'), 10),
    mergedInto: txt_(t.get(r, 'Merged Into'), 80),
    archived: !!txt_(t.get(r, 'Archived'), 10),
    sort: Number(t.get(r, 'Sort')) || 9999,
  })).filter(c => c.id && c.name);
}

function accounts_(ss) {
  const t = lgTable_(ss, LG_ACCOUNTS);
  return t.rows.map(r => ({
    id: String(t.get(r, 'ID')).trim(),
    name: txt_(t.get(r, 'Name'), 80),
    kind: txt_(t.get(r, 'Kind'), 20) || 'Cash',
    heldBy: txt_(t.get(r, 'Held By'), 120),
    openingMinor: minor_(t.get(r, 'Opening Balance')),
    icon: txt_(t.get(r, 'Icon'), 8) || '💰',
    colour: txt_(t.get(r, 'Colour'), 20) || '#1E88E5',
    archived: !!txt_(t.get(r, 'Archived'), 10),
    balanceMinor: 0,
  })).filter(a => a.id && a.name);
}

function rules_(ss) {
  const t = lgTable_(ss, LG_RULES);
  return t.rows.map(r => ({
    id: String(t.get(r, 'ID')).trim(),
    name: txt_(t.get(r, 'Name'), 60),
    method: RULE_METHODS.indexOf(txt_(t.get(r, 'Method'), 20)) === -1 ? 'Equal' : txt_(t.get(r, 'Method'), 20),
    version: Math.max(1, Math.round(Number(t.get(r, 'Version')) || 1)),
    archived: !!txt_(t.get(r, 'Archived'), 10),
  })).filter(r => r.id && r.name && !r.archived);
}

function centres_(ss) {
  const t = lgTable_(ss, LG_CENTRES);
  return t.rows.map(r => ({
    id: String(t.get(r, 'ID')).trim(),
    name: txt_(t.get(r, 'Name'), 80),
    archived: !!txt_(t.get(r, 'Archived'), 10),
  })).filter(c => c.id && c.name && !c.archived);
}

function groups_(ss) {
  const t = lgTable_(ss, LG_GROUPS);
  return t.rows.map(r => ({
    id: String(t.get(r, 'ID')).trim(),
    name: txt_(t.get(r, 'Name'), 80),
    kind: txt_(t.get(r, 'Kind'), 20) === INCOME ? INCOME : EXPENSE,
    sort: Number(t.get(r, 'Sort')) || 9999,
  })).filter(g => g.id && g.name);
}

// ---- The vouchers themselves ---------------------------------------------

function entries_(ss, tz) {
  const t = lgTable_(ss, LG_ENTRIES);
  return t.rows.map(r => {
    const id = String(t.get(r, 'ID')).trim();
    if (!id) return null;
    const type = txt_(t.get(r, 'Type'), 20);
    if (ENTRY_TYPES.indexOf(type) === -1) return null;
    let lines = [];
    try {
      const detail = String(t.get(r, 'Detail') || '').trim();
      if (detail) lines = JSON.parse(detail).lines || [];
    } catch (err) {
      lines = [];
    }
    return {
      id: id,
      date: isoD_(t.get(r, 'Date'), tz),
      type: type,
      status: txt_(t.get(r, 'Status'), 20) || ST_RECORDED,
      totalMinor: minor_(t.get(r, 'Total')),
      account: txt_(t.get(r, 'Account'), 80),
      toAccount: txt_(t.get(r, 'To Account'), 80),
      vendor: txt_(t.get(r, 'Vendor'), 80),
      reference: txt_(t.get(r, 'Reference'), 40),
      note: txt_(t.get(r, 'Note'), 200),
      enteredBy: txt_(t.get(r, 'Entered By'), 120),
      at: t.get(r, 'Entered At') instanceof Date ? t.get(r, 'Entered At').getTime() : 0,
      updatedAt: t.get(r, 'Changed At') instanceof Date ? t.get(r, 'Changed At').getTime()
        : (t.get(r, 'Entered At') instanceof Date ? t.get(r, 'Entered At').getTime() : 0),
      lines: lines,
    };
  }).filter(e => e);
}

function balances_(accounts, entries) {
  const by = {};
  accounts.forEach(a => { by[a.name] = a.openingMinor; });
  entries.forEach(e => {
    if (e.status === ST_VOID) return;
    if (e.type === INCOME && by[e.account] !== undefined) by[e.account] += e.totalMinor;
    else if (e.type === EXPENSE && by[e.account] !== undefined) by[e.account] -= e.totalMinor;
    else if (e.type === TRANSFER) {
      if (by[e.account] !== undefined) by[e.account] -= e.totalMinor;
      if (by[e.toAccount] !== undefined) by[e.toAccount] += e.totalMinor;
    }
  });
  accounts.forEach(a => { a.balanceMinor = by[a.name] || 0; });
  return accounts;
}

function entryRow_(value, id, enteredBy, enteredAt, changedAt, voidedBy, voidedAt) {
  const campaigns = {};
  const cats = {};
  value.lines.forEach(l => {
    cats[l.category] = true;
    (l.allocations || []).forEach(a => { campaigns[a.campaign] = true; });
  });
  return {
    'ID': id,
    'Date': dateOf_(value.date),
    'Type': value.type,
    'Status': value.status,
    'Total': rupees_(value.totalMinor),
    'Account': value.account,
    'To Account': value.toAccount,
    'Vendor': value.vendor,
    'Reference': value.reference,
    'Note': value.note,
    'Campaigns': Object.keys(campaigns).join(', '),
    'Categories': Object.keys(cats).join(', '),
    'Entered By': enteredBy,
    'Entered At': enteredAt,
    'Changed At': changedAt || '',
    'Voided By': voidedBy || '',
    'Voided At': voidedAt || '',
    'Detail': JSON.stringify({ v: 1, lines: value.lines }),
  };
}

function touchVendor_(ss, name) {
  const clean = txt_(name, 80);
  if (!clean) return;
  const t = lgTable_(ss, LG_VENDORS);
  const want = clean.toLowerCase();
  for (let i = 0; i < t.rows.length; i++) {
    if (txt_(t.get(t.rows[i], 'Name'), 80).toLowerCase() === want) {
      t.sh.getRange(i + 2, t.col('Last Seen')).setValue(new Date());
      return;
    }
  }
  lgAppend_(t, { 'ID': uid_('v'), 'Name': clean, 'First Seen': new Date(), 'Last Seen': new Date() });
}

// ---- The app --------------------------------------------------------------

function doGet() {
  return HtmlService.createHtmlOutput(lgPageHtml_())
    .setTitle(LG_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover')
    .addMetaTag('theme-color', '#141a22');
}

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

function webLedgerBoot(code) {
  const ss = SpreadsheetApp.getActive();
  const person = person_(ss, code);
  if (!person) {
    return { ok: false, needCode: true, message: code ? 'That access code was not recognised.' : '' };
  }
  return { ok: true, person: person, data: payload_(ss) };
}

function payload_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const all = entries_(ss, tz);
  const accounts = balances_(accounts_(ss), all);
  const drafts = all.filter(e => e.status === ST_DRAFT && e.type !== TRANSFER);
  let url = '';
  try { url = ss.getUrl(); } catch (err) { url = ''; }

  return {
    settings: settings_(ss),
    accounts: accounts,
    campaigns: campaigns_(ss),
    categories: categories_(ss),
    groups: groups_(ss),
    rules: rules_(ss),
    centres: centres_(ss),
    vendors: vendorNames_(ss),
    entries: all.slice(Math.max(0, all.length - LG_PAGE)),
    total: all.length,
    draftCount: drafts.length,
    draftMinor: drafts.reduce((sum, e) => sum + e.totalMinor, 0),
    today: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
    sheetUrl: url,
    accountKinds: ACCOUNT_KINDS,
    campaignKinds: CAMPAIGN_KINDS,
  };
}

function vendorNames_(ss) {
  const t = lgTable_(ss, LG_VENDORS);
  return t.rows.map(r => txt_(t.get(r, 'Name'), 80)).filter(n => n);
}

function webLedgerRefresh(req) {
  return guarded_(req, function (ss) {
    return { ok: true, data: payload_(ss) };
  });
}

function webLedgerSave(req) {
  return guarded_(req, function (ss, person) {
    const ctx = context_(ss);
    const prepared = prepareEntry_(req && req.entry, ctx);
    if (prepared.error) return { ok: false, message: prepared.error };
    const value = prepared.value;

    const t = lgTable_(ss, LG_ENTRIES);
    const id = txt_((req.entry && req.entry.id) || '', 40);
    const rowNumber = id ? lgRowOf_(t, id) : 0;
    if (id && !rowNumber) return { ok: false, message: 'That entry is no longer on the sheet.' };

    let enteredBy = person.email || person.name;
    let enteredAt = new Date();
    if (rowNumber) {
      const old = t.rows[rowNumber - 2];
      const owner = txt_(t.get(old, 'Entered By'), 120);
      if (!canEdit_(person, { enteredBy: owner })) {
        return { ok: false, message: 'That entry was put in by ' + owner + '. Ask a manager to change it.' };
      }
      if (txt_(t.get(old, 'Status'), 20) === ST_VOID) {
        return { ok: false, message: 'That entry was voided. Add a new one instead.' };
      }
      enteredBy = owner || enteredBy;
      if (t.get(old, 'Entered At') instanceof Date) enteredAt = t.get(old, 'Entered At');
    }

    const values = entryRow_(value, id || uid_('e'), enteredBy, enteredAt, rowNumber ? new Date() : '', '', '');
    const at = rowNumber ? lgWrite_(t, rowNumber, values) : lgAppend_(t, values);
    t.sh.getRange(at, t.col('Date')).setNumberFormat('yyyy-mm-dd');
    t.sh.getRange(at, t.col('Total')).setNumberFormat('#,##0.00');
    if (value.vendor) touchVendor_(ss, value.vendor);

    note_(ss, person, (rowNumber ? 'Changed ' : 'Added ') + value.type.toLowerCase() + ' ' +
      rupees_(value.totalMinor) + ' on ' + value.date +
      (value.status === ST_DRAFT ? ' (draft — needs a campaign)' : '') +
      (value.lines.length ? ' — ' + value.lines.map(l => l.category).join(', ') : ''));

    const fresh = entries_(ss, ctx.tz);
    return {
      ok: true,
      entry: fresh.filter(e => e.id === values['ID'])[0] || null,
      accounts: balances_(accounts_(ss), fresh),
      draftCount: fresh.filter(e => e.status === ST_DRAFT && e.type !== TRANSFER).length,
    };
  });
}

function webLedgerVoid(req) {
  return guarded_(req, function (ss, person) {
    const t = lgTable_(ss, LG_ENTRIES);
    const rowNumber = lgRowOf_(t, txt_(req && req.id, 40));
    if (!rowNumber) return { ok: false, message: 'That entry is already gone.' };
    const row = t.rows[rowNumber - 2];
    const owner = txt_(t.get(row, 'Entered By'), 120);
    if (!canEdit_(person, { enteredBy: owner })) {
      return { ok: false, message: 'That entry was put in by ' + owner + '. Ask a manager to void it.' };
    }
    t.sh.getRange(rowNumber, t.col('Status')).setValue(ST_VOID);
    t.sh.getRange(rowNumber, t.col('Voided By')).setValue(person.email || person.name);
    t.sh.getRange(rowNumber, t.col('Voided At')).setValue(new Date());
    note_(ss, person, 'Voided ' + txt_(t.get(row, 'Type'), 20).toLowerCase() + ' ' +
      minor_(t.get(row, 'Total')) / 100 + ' of ' + isoD_(t.get(row, 'Date'), ss.getSpreadsheetTimeZone()));

    const fresh = entries_(ss, ss.getSpreadsheetTimeZone());
    return {
      ok: true, id: txt_(req.id, 40),
      accounts: balances_(accounts_(ss), fresh),
      draftCount: fresh.filter(e => e.status === ST_DRAFT && e.type !== TRANSFER).length,
    };
  });
}

// Anyone may add a category while entering — it is marked "new" so an admin can
// tidy it up later. Only an admin changes the rest of the chart of accounts.
function webLedgerCategory(req) {
  return guarded_(req, function (ss, person) {
    const input = (req && req.category) || {};
    const name = txt_(input.name, 80);
    if (!name) return { ok: false, message: 'A category needs a name.' };

    const t = lgTable_(ss, LG_CATS);
    const id = txt_(input.id, 40);
    const rowNumber = id ? lgRowOf_(t, id) : 0;
    if (id && !rowNumber) return { ok: false, message: 'That category is no longer on the sheet.' };
    if (rowNumber && person.role !== ROLE_ADMIN) {
      return { ok: false, message: 'Only an admin changes a category that already exists.' };
    }
    const clash = t.rows.some((r, i) => txt_(t.get(r, 'Name'), 80).toLowerCase() === name.toLowerCase() && i + 2 !== rowNumber);
    if (clash) return { ok: false, message: 'There is already a category called "' + name + '".' };

    const kind = txt_(input.kind, 20) === INCOME ? INCOME : EXPENSE;
    const was = rowNumber ? txt_(t.get(t.rows[rowNumber - 2], 'Name'), 80) : '';
    const values = {
      'ID': id || uid_('c'),
      'Name': name,
      'Group': txt_(input.group, 80) || (kind === INCOME ? 'Income' : 'Admin & financial'),
      'Kind': kind,
      'Icon': txt_(input.icon, 8) || '🏷️',
      'Colour': txt_(input.colour, 20) || '#90A4AE',
      'Default Rule': txt_(input.rule, 60),
      'Cost Centre': txt_(input.costCentre, 80),
      'Monthly Budget': minor_(input.budget) > 0 ? rupees_(minor_(input.budget)) : '',
      'New': rowNumber ? (input.isNew ? 'Yes' : '') : (person.role === ROLE_ADMIN ? '' : 'Yes'),
      'Merged Into': txt_(input.mergedInto, 80),
      'Archived': input.archived ? 'Yes' : '',
      'Sort': Number(input.sort) || 9999,
      'Added By': rowNumber ? txt_(t.get(t.rows[rowNumber - 2], 'Added By'), 120) : (person.email || person.name),
      'Added At': rowNumber && t.get(t.rows[rowNumber - 2], 'Added At') ? t.get(t.rows[rowNumber - 2], 'Added At') : new Date(),
    };
    if (rowNumber) lgWrite_(t, rowNumber, values);
    else lgAppend_(t, values);

    let moved = 0;
    if (was && was !== name) moved = renameEverywhere_(ss, 'category', was, name);
    note_(ss, person, (rowNumber ? 'Changed' : 'Added') + ' category "' + name + '"' +
      (moved ? ' (' + moved + ' lines updated)' : ''));
    return { ok: true, categories: categories_(ss), entries: moved ? entries_(ss, ss.getSpreadsheetTimeZone()) : null };
  });
}

function webLedgerCampaign(req) {
  return guarded_(req, function (ss, person) {
    if (person.role !== ROLE_ADMIN) return { ok: false, message: 'Only an admin changes campaigns.' };
    const input = (req && req.campaign) || {};
    const name = txt_(input.name, 80);
    if (!name) return { ok: false, message: 'A campaign needs a name.' };

    const t = lgTable_(ss, LG_CAMPAIGNS);
    const id = txt_(input.id, 40);
    const rowNumber = id ? lgRowOf_(t, id) : 0;
    if (id && !rowNumber) return { ok: false, message: 'That campaign is no longer on the sheet.' };
    const clash = t.rows.some((r, i) => txt_(t.get(r, 'Name'), 80).toLowerCase() === name.toLowerCase() && i + 2 !== rowNumber);
    if (clash) return { ok: false, message: 'There is already a campaign called "' + name + '".' };

    const was = rowNumber ? txt_(t.get(t.rows[rowNumber - 2], 'Name'), 80) : '';
    const status = ['Active', 'Paused', 'Closed'].indexOf(txt_(input.status, 20)) === -1 ? 'Active' : txt_(input.status, 20);
    const values = {
      'ID': id || uid_('p'),
      'Name': name,
      'Client': txt_(input.client, 80),
      'Code': txt_(input.code, 20),
      'Kind': CAMPAIGN_KINDS.indexOf(txt_(input.kind, 20)) === -1 ? 'Client' : txt_(input.kind, 20),
      'Status': status,
      'Seats': Math.max(0, Math.round(Number(input.seats) || 0)),
      'Agents': Math.max(0, Math.round(Number(input.agents) || 0)),
      'Icon': txt_(input.icon, 8) || '🎯',
      'Colour': txt_(input.colour, 20) || '#1E88E5',
      'Started': rowNumber && t.get(t.rows[rowNumber - 2], 'Started') ? t.get(t.rows[rowNumber - 2], 'Started') : new Date(),
      'Closed': status === 'Closed' ? new Date() : '',
    };
    if (rowNumber) lgWrite_(t, rowNumber, values);
    else lgAppend_(t, values);

    let moved = 0;
    if (was && was !== name) moved = renameEverywhere_(ss, 'campaign', was, name);
    note_(ss, person, (rowNumber ? 'Changed' : 'Added') + ' campaign "' + name + '"' +
      (moved ? ' (' + moved + ' entries updated)' : ''));
    return { ok: true, campaigns: campaigns_(ss), entries: moved ? entries_(ss, ss.getSpreadsheetTimeZone()) : null };
  });
}

function webLedgerAccount(req) {
  return guarded_(req, function (ss, person) {
    if (person.role !== ROLE_ADMIN) return { ok: false, message: 'Only an admin changes accounts.' };
    const input = (req && req.account) || {};
    const name = txt_(input.name, 80);
    if (!name) return { ok: false, message: 'An account needs a name.' };

    const t = lgTable_(ss, LG_ACCOUNTS);
    const id = txt_(input.id, 40);
    const rowNumber = id ? lgRowOf_(t, id) : 0;
    if (id && !rowNumber) return { ok: false, message: 'That account is no longer on the sheet.' };
    const clash = t.rows.some((r, i) => txt_(t.get(r, 'Name'), 80).toLowerCase() === name.toLowerCase() && i + 2 !== rowNumber);
    if (clash) return { ok: false, message: 'There is already an account called "' + name + '".' };

    const was = rowNumber ? txt_(t.get(t.rows[rowNumber - 2], 'Name'), 80) : '';
    const values = {
      'ID': id || uid_('a'),
      'Name': name,
      'Kind': ACCOUNT_KINDS.indexOf(txt_(input.kind, 20)) === -1 ? 'Cash' : txt_(input.kind, 20),
      'Held By': txt_(input.heldBy, 120),
      'Opening Balance': rupees_(minor_(input.opening)),
      'Icon': txt_(input.icon, 8) || '💰',
      'Colour': txt_(input.colour, 20) || '#1E88E5',
      'Archived': input.archived ? 'Yes' : '',
    };
    if (rowNumber) lgWrite_(t, rowNumber, values);
    else lgAppend_(t, values);

    let moved = 0;
    if (was && was !== name) moved = renameEverywhere_(ss, 'account', was, name);
    note_(ss, person, (rowNumber ? 'Changed' : 'Added') + ' account "' + name + '"');
    return { ok: true, accounts: balances_(accounts_(ss), entries_(ss, ss.getSpreadsheetTimeZone())), entries: moved ? entries_(ss, ss.getSpreadsheetTimeZone()) : null };
  });
}

// A person's own two defaults — what the keypad fills in before they touch it.
function webLedgerMe(req) {
  return guarded_(req, function (ss, person) {
    const t = lgTable_(ss, LG_PEOPLE);
    const email = (person.email || '').toLowerCase();
    for (let i = 0; i < t.rows.length; i++) {
      const r = t.rows[i];
      const match = (email && txt_(t.get(r, 'Email'), 120).toLowerCase() === email) ||
        (!email && txt_(t.get(r, 'Access Code'), 12) === person.code);
      if (!match) continue;
      t.sh.getRange(i + 2, t.col('Default Campaign')).setValue(txt_(req.defaultCampaign, 80));
      t.sh.getRange(i + 2, t.col('Default Account')).setValue(txt_(req.defaultAccount, 80));
      return {
        ok: true,
        person: Object.assign({}, person, {
          campaign: txt_(req.defaultCampaign, 80), account: txt_(req.defaultAccount, 80),
        }),
      };
    }
    return { ok: false, message: 'Could not find your row on the People tab.' };
  });
}

function webLedgerSettings(req) {
  return guarded_(req, function (ss, person) {
    if (person.role !== ROLE_ADMIN) return { ok: false, message: 'Only an admin changes settings.' };
    const input = (req && req.settings) || {};
    const wanted = {
      'Currency': txt_(input.currency, 8) || 'Rs',
      'Show decimals': Number(input.decimals) === 0 ? 'No' : 'Yes',
      'Week starts on': Number(input.weekStart) === 0 ? 'Sunday' : 'Monday',
      'Block saving without a campaign': input.blockWithoutCampaign ? 'Yes' : 'No',
    };
    const t = lgTable_(ss, LG_SETTINGS);
    Object.keys(wanted).forEach(key => {
      let at = 0;
      for (let i = 0; i < t.rows.length; i++) {
        if (txt_(t.get(t.rows[i], 'Key'), 60).toLowerCase() === key.toLowerCase()) { at = i + 2; break; }
      }
      if (at) t.sh.getRange(at, t.col('Value')).setValue(wanted[key]);
      else lgAppend_(t, { 'Key': key, 'Value': wanted[key] });
    });
    note_(ss, person, 'Changed settings');
    return { ok: true, settings: settings_(ss) };
  });
}

function webLedgerExport(req) {
  return guarded_(req, function (ss, person) {
    const counts = rebuildReportTabs();
    note_(ss, person, 'Rebuilt the Lines and Allocations tabs');
    return { ok: true, counts: counts, sheetUrl: ss.getUrl() };
  });
}

// A rename has to carry the old name out of the vouchers too, or history breaks.
function renameEverywhere_(ss, what, from, to) {
  const t = lgTable_(ss, LG_ENTRIES);
  if (!t.rows.length || from === to) return 0;
  let changed = 0;
  const detailCol = t.col('Detail');
  const detail = t.sh.getRange(2, detailCol, t.rows.length, 1).getValues();
  const summary = {
    account: t.col('Account'), toAccount: t.col('To Account'),
    campaign: t.col('Campaigns'), category: t.col('Categories'),
  };

  for (let i = 0; i < t.rows.length; i++) {
    let touched = false;
    let parsed = null;
    try { parsed = detail[i][0] ? JSON.parse(detail[i][0]) : null; } catch (err) { parsed = null; }
    if (parsed && parsed.lines) {
      parsed.lines.forEach(l => {
        if (what === 'category' && l.category === from) { l.category = to; touched = true; }
        if (what === 'campaign') {
          (l.allocations || []).forEach(a => { if (a.campaign === from) { a.campaign = to; touched = true; } });
        }
      });
    }
    if (what === 'account') {
      const row = t.rows[i];
      if (txt_(t.get(row, 'Account'), 80) === from) {
        t.sh.getRange(i + 2, summary.account).setValue(to); touched = true;
      }
      if (txt_(t.get(row, 'To Account'), 80) === from) {
        t.sh.getRange(i + 2, summary.toAccount).setValue(to); touched = true;
      }
    }
    if (touched) {
      changed++;
      if (parsed) {
        t.sh.getRange(i + 2, detailCol).setValue(JSON.stringify(parsed));
        const names = {};
        const cats = {};
        parsed.lines.forEach(l => {
          cats[l.category] = true;
          (l.allocations || []).forEach(a => { names[a.campaign] = true; });
        });
        t.sh.getRange(i + 2, summary.campaign).setValue(Object.keys(names).join(', '));
        t.sh.getRange(i + 2, summary.category).setValue(Object.keys(cats).join(', '));
      }
    }
  }
  return changed;
}

// ---- The flat tabs the books are done from -------------------------------

function rebuildReportTabs() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const all = entries_(ss, tz);
  const campaignKind = {};
  campaigns_(ss).forEach(c => { campaignKind[c.name] = c.kind; });

  const lines = [];
  const allocs = [];
  all.forEach(e => {
    if (e.type === TRANSFER) return;
    e.lines.forEach(l => {
      lines.push([e.id, l.no, dateOf_(e.date), e.status, e.type, e.vendor, e.account, l.group,
        l.category, l.costCentre, l.description, l.qty || '', l.unitPriceMinor == null ? '' : rupees_(l.unitPriceMinor),
        rupees_(l.amountMinor), e.enteredBy]);
      (l.allocations || []).forEach(a => {
        allocs.push([e.id, l.no, dateOf_(e.date), e.status, e.type, l.group, l.category, a.campaign,
          campaignKind[a.campaign] || '', l.basis === 'apportioned' ? 'Apportioned' : 'Direct',
          a.bp / 100, rupees_(a.amountMinor), e.enteredBy]);
      });
    });
  });

  lgFill_(ss, LG_LINES, H_LINES, lines);
  lgFill_(ss, LG_ALLOCS, H_ALLOCS, allocs);
  return { entries: all.length, lines: lines.length, allocations: allocs.length };
}

function lgFill_(ss, name, headers, rows) {
  const sh = lgTab_(ss, name, headers);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), headers.length)).clearContent();
  if (!rows.length) return;
  if (rows.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 50 - sh.getMaxRows());
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

// Three numbers that must agree. If they ever do not, something wrote to the
// sheet by hand and the Detail column is the one to trust.
function checkLedger() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const all = entries_(ss, tz).filter(e => e.status !== ST_VOID && e.type !== TRANSFER);
  let headers = 0, lines = 0, allocs = 0;
  const bad = [];
  all.forEach(e => {
    headers += e.totalMinor;
    let lineSum = 0;
    e.lines.forEach(l => {
      lineSum += l.amountMinor;
      lines += l.amountMinor;
      const aSum = (l.allocations || []).reduce((s, a) => s + a.amountMinor, 0);
      allocs += aSum;
      if (l.allocations && l.allocations.length && aSum !== l.amountMinor) {
        bad.push(e.id + ' line ' + l.no + ': split adds to ' + rupees_(aSum) + ', line is ' + rupees_(l.amountMinor));
      }
    });
    if (lineSum !== e.totalMinor) {
      bad.push(e.id + ': lines add to ' + rupees_(lineSum) + ', voucher says ' + rupees_(e.totalMinor));
    }
  });
  const unallocated = headers - allocs;
  lgAlert_(
    'Vouchers:    ' + rupees_(headers) + '\n' +
    'Line items:  ' + rupees_(lines) + '\n' +
    'Allocated:   ' + rupees_(allocs) + '\n' +
    'Waiting for a campaign: ' + rupees_(unallocated) + '\n\n' +
    (bad.length ? 'Problems:\n' + bad.slice(0, 20).join('\n') : 'Everything adds up.')
  );
  return { headers: headers, lines: lines, allocations: allocs, problems: bad };
}

// ---- The page -------------------------------------------------------------

function lgPageHtml_() {
  return [
    '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8">',
    '<style>' + lgCss_() + '</style></head><body>',
    '<div id="app"><div class="loading">Loading…</div></div>',
    '<div id="sheet" class="sheet hidden"></div>',
    '<div id="sheet2" class="sheet hidden"></div>',
    '<div id="toast" class="toast hidden"></div>',
    '<div id="busy" class="busy hidden"></div>',
    '<script>' + lgJs_() + '</scr' + 'ipt>',
    '</body></html>',
  ].join('\n');
}

function lgCss_() {
  return `
:root{color-scheme:dark;--bg:#141a22;--card:#1c2431;--card2:#232d3c;--ink:#eef2f7;--muted:#8b98a9;--line:#2b3644;--good:#2fbf71;--bad:#ff5f5f;--warn:#ffb020;--brand:#3d7dff}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;overscroll-behavior:none}
button,input,select,textarea{font:inherit;color:inherit}
.hidden{display:none!important}
.loading{padding:40px 16px;text-align:center;color:var(--muted)}
#app{max-width:540px;margin:0 auto;min-height:100%;display:flex;flex-direction:column}

.bar{display:flex;align-items:center;gap:6px;padding:10px 12px 4px}
.bar .grow{flex:1}
.icon{background:none;border:0;padding:8px;border-radius:10px;font-size:18px;line-height:1;cursor:pointer}
.icon:active{background:var(--card2)}
.chip{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;max-width:46vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.period{display:flex;align-items:center;justify-content:center;gap:4px;padding:2px 12px 6px}
.period b{font-size:15px;font-weight:600;min-width:150px;text-align:center}

.alert{display:flex;align-items:center;gap:10px;margin:0 12px 8px;padding:10px 12px;border-radius:12px;background:rgba(255,176,32,.14);border:1px solid rgba(255,176,32,.4);cursor:pointer}
.alert b{font-size:13px;font-weight:600;color:var(--warn)}
.alert span{font-size:12px;color:var(--muted);display:block}
.alert .go{margin-left:auto;color:var(--warn)}

.hero{position:relative;padding:2px 12px 8px}
.pills{display:flex;gap:8px;margin-bottom:6px}
.pill{flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px;text-align:left;cursor:pointer;display:block}
.pill small{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.pill b{font-size:16px;font-weight:600}
.pill.on{border-color:currentColor}
.pill.inc{color:var(--good)}
.pill.exp{color:var(--bad)}
.ringwrap{position:relative;width:100%;max-width:250px;margin:0 auto}
.ringwrap svg{display:block;width:100%;height:auto}
.centre{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}
.centre small{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.centre strong{font-size:24px;font-weight:650;line-height:1.1;margin-top:2px;word-break:break-all;padding:0 30px}
.centre em{font-style:normal;color:var(--muted);font-size:11px;margin-top:4px}

.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:6px 12px 16px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:9px 4px 8px;text-align:center;cursor:pointer;display:block;overflow:hidden}
.tile .em{font-size:20px;line-height:1.15}
.tile .nm{font-size:10px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .am{font-size:11.5px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile.flat .am{color:var(--muted);font-weight:400}
.tile.add{border-style:dashed}

.dock{position:sticky;bottom:0;margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(20,26,34,0),var(--bg) 40%)}
.round{width:58px;height:58px;border-radius:50%;border:0;font-size:30px;font-weight:300;line-height:1;cursor:pointer;color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.35)}
.round.spend{background:var(--bad)}
.round.earn{background:var(--good)}
.dockmid{flex:1;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:12px;text-align:center;font-size:13px;cursor:pointer}

.view{padding:0 12px 24px}
.head{display:flex;align-items:center;gap:6px;padding:10px 0 6px}
.head h2{margin:0;font-size:17px;font-weight:600;flex:1}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px}
.row{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:8px;width:100%;text-align:left;cursor:pointer}
.row.warn{border-color:rgba(255,176,32,.5)}
.row .em{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;flex:0 0 auto}
.row .mid{flex:1;min-width:0}
.row .mid b{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .mid span{display:block;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .amt{font-size:14px;font-weight:600;white-space:nowrap;text-align:right}
.row .amt small{display:block;font-size:10px;color:var(--muted);font-weight:400}
.good{color:var(--good)}.bad{color:var(--bad)}.dim{color:var(--muted)}.warnc{color:var(--warn)}
.daysep{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;padding:10px 4px 6px}
.empty{text-align:center;color:var(--muted);padding:28px 12px;font-size:14px}
.bars{height:5px;border-radius:3px;background:var(--card2);margin-top:6px;overflow:hidden;display:flex}
.bars i{display:block;height:100%}
.sum{display:flex;gap:8px;margin:4px 0 10px}
.sum div{flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px}
.sum small{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.sum b{font-size:15px}
.tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:999px;background:var(--card2);color:var(--muted);margin-left:6px;vertical-align:middle}
.tag.draft{background:rgba(255,176,32,.18);color:var(--warn)}
.tag.void{background:rgba(255,95,95,.16);color:var(--bad)}

label.f{display:block;margin:0 0 10px}
label.f span{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
input[type=text],input[type=number],input[type=date],select,textarea{width:100%;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.btn{display:block;width:100%;background:var(--brand);border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:600;color:#fff;cursor:pointer;margin-top:4px}
.btn.ghost{background:var(--card2);color:var(--ink);border:1px solid var(--line)}
.btn.danger{background:transparent;color:var(--bad);border:1px solid var(--bad)}
.btn.warn{background:var(--warn);color:#241a00}
.btn:disabled{opacity:.45}
.two{display:flex;gap:8px}
.two .btn{margin-top:0}
.picks{display:flex;flex-wrap:wrap;gap:6px}
.pick{background:var(--card2);border:1px solid var(--line);border-radius:999px;padding:7px 11px;font-size:13px;cursor:pointer;white-space:nowrap}
.pick.on{border-color:var(--brand);background:rgba(61,125,255,.18)}
.swatch{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
.swatch.on{border-color:#fff}
.emoji{width:38px;height:38px;border-radius:10px;background:var(--card2);border:1px solid var(--line);font-size:19px;cursor:pointer;padding:0}
.emoji.on{border-color:var(--brand)}

.sheet{position:fixed;inset:0;background:rgba(6,9,13,.62);display:flex;align-items:flex-end;justify-content:center;z-index:30}
#sheet2{z-index:40}
.sheet .inner{background:var(--bg);width:100%;max-width:540px;max-height:94vh;overflow:auto;border-radius:18px 18px 0 0;border-top:1px solid var(--line);padding:10px 12px calc(14px + env(safe-area-inset-bottom))}
.handle{width:40px;height:4px;border-radius:2px;background:var(--line);margin:2px auto 10px}
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tabs button{flex:1;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px;font-size:13px;cursor:pointer}
.tabs button.on{background:var(--card2);border-color:var(--brand)}
.amount{display:flex;align-items:baseline;justify-content:flex-end;gap:8px;padding:6px 6px 8px;font-size:32px;font-weight:650;min-height:52px;word-break:break-all}
.amount .op{font-size:15px;color:var(--muted)}
.cats{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:8px;max-height:156px;overflow:auto}
.cats button{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 2px;cursor:pointer;overflow:hidden}
.cats button.on{border-color:var(--brand);background:var(--card2)}
.cats button.add{border-style:dashed}
.cats .em{font-size:18px;line-height:1.1}
.cats .nm{font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.keys{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}
.keys button{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 0;font-size:19px;cursor:pointer}
.keys button.op{background:var(--card2);color:var(--muted);font-size:17px}
.inline{display:flex;gap:8px}
.inline label.f{flex:1;margin:0 0 10px}

.alloc{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:9px 11px;margin-bottom:8px;width:100%;text-align:left;cursor:pointer}
.alloc.need{border-color:rgba(255,176,32,.55);background:rgba(255,176,32,.08)}
.alloc .mid{flex:1;min-width:0}
.alloc .mid b{display:block;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.alloc .mid span{display:block;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lines{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:6px}
.lchip{flex:0 0 auto;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:6px 9px;font-size:12px;cursor:pointer;white-space:nowrap}
.lchip.on{border-color:var(--brand)}
.lchip i{font-style:normal;color:var(--muted);margin-left:6px}
.split{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.split .nm{flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.split input{width:76px;text-align:right;padding:7px 9px}
.split .pv{width:88px;text-align:right;font-size:12px;color:var(--muted)}
.more{background:none;border:0;color:var(--brand);font-size:13px;padding:6px 0;cursor:pointer}
.toast{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);background:#0b1016;border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-size:13px;z-index:60;max-width:88vw;text-align:center}
.busy{position:fixed;top:0;left:0;right:0;height:3px;background:var(--brand);z-index:70;animation:pulse 1.1s linear infinite}
@keyframes pulse{0%{opacity:.35}50%{opacity:1}100%{opacity:.35}}
.note{color:var(--muted);font-size:12.5px;margin:2px 0 10px}
a{color:var(--brand)}
table.rep{width:100%;border-collapse:collapse;font-size:13px}
table.rep th{text-align:right;color:var(--muted);font-weight:500;font-size:11px;text-transform:uppercase;padding:6px 4px;border-bottom:1px solid var(--line)}
table.rep th:first-child{text-align:left}
table.rep td{padding:8px 4px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
table.rep td:first-child{text-align:left;white-space:normal}
table.rep tr:last-child td{border-bottom:0}
`;
}

function lgJs_() {
  return `
var BOOT = null, CODE = '', D = null;
var S = { view: 'home', mode: 'Expense', unit: 'month', anchor: '', campaign: '', account: '', more: false };
var M = null;      // the voucher being filled in
var EDIT = null;   // the campaign / category / account being edited
var CALC = { cur: '', acc: null, op: null };
var ARMED = '';

var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var UNITS = [['day','Day'],['week','Week'],['month','Month'],['year','Year'],['all','All time']];
var COLOURS = ['#43A047','#FB8C00','#1E88E5','#6D4C41','#FDD835','#7E57C2','#E53935','#EC407A','#AB47BC','#26C6DA','#5C6BC0','#FF7043','#26A69A','#90A4AE','#2E7D32','#0277BD'];
var EMOJI = ['🏷️','⚡','⛽','🌐','☎️','🎧','💻','🪑','🧹','💂','🚐','☕','🎯','📣','🧾','🏦','💵','💳','📱','🛠️','📦','🖨️','🎓','👥','🏢','💧','🔋','☁️','🗂️','✈️','🛡️','➕'];

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
  toastTimer = setTimeout(function () { el.className = 'toast hidden'; }, 3400);
}

function call(fn, arg, done) {
  busy(true);
  google.script.run
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
    })[fn](arg);
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseIso(s) { var p = String(s || '').split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

// Money is counted in paisa everywhere and only becomes a string here.
function fmt(minorUnits) {
  var dec = D.settings.decimals;
  var n = Math.abs(Number(minorUnits) || 0) / 100;
  var bits = n.toFixed(dec).split('.');
  bits[0] = bits[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return (Number(minorUnits) < 0 ? '-' : '') + D.settings.currency + ' ' + bits.join('.');
}

function signed(minorUnits, type) {
  if (type === 'Transfer') return fmt(minorUnits);
  return (type === 'Income' ? '+' : '-') + fmt(minorUnits);
}

function dayLabel(isoDate) {
  var d = parseIso(isoDate), t = parseIso(D.today);
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
    return {
      from: iso(new Date(a.getFullYear(), a.getMonth(), 1)),
      to: iso(new Date(a.getFullYear(), a.getMonth() + 1, 0)),
      label: MONTHS[a.getMonth()] + ' ' + a.getFullYear(),
    };
  }
  if (S.unit === 'year') return { from: a.getFullYear() + '-01-01', to: a.getFullYear() + '-12-31', label: String(a.getFullYear()) };
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

function unitName() {
  for (var i = 0; i < UNITS.length; i++) if (UNITS[i][0] === S.unit) return UNITS[i][1];
  return 'Month';
}

// ---- looking things up

function cat(name) {
  for (var i = 0; i < D.categories.length; i++) if (D.categories[i].name === name) return D.categories[i];
  return { name: name, icon: '•', colour: '#90A4AE', kind: 'Expense', group: '', rule: '' };
}
function catsOf(kind, withHidden) {
  return D.categories.filter(function (c) {
    return c.kind === kind && !c.mergedInto && (withHidden || !c.archived);
  }).sort(function (a, b) { return a.sort - b.sort; });
}
function campaign(name) {
  for (var i = 0; i < D.campaigns.length; i++) if (D.campaigns[i].name === name) return D.campaigns[i];
  return null;
}
function liveCampaigns() { return D.campaigns.filter(function (c) { return c.status === 'Active'; }); }

// One book for the whole company until somebody puts a client campaign in.
function usingCampaigns() {
  return D.campaigns.some(function (c) { return c.status === 'Active' && c.kind === 'Client'; });
}
function account(name) {
  for (var i = 0; i < D.accounts.length; i++) if (D.accounts[i].name === name) return D.accounts[i];
  return null;
}
function liveAccounts() { return D.accounts.filter(function (a) { return !a.archived; }); }
function rule(name) {
  for (var i = 0; i < D.rules.length; i++) if (D.rules[i].name === name) return D.rules[i];
  return null;
}

// ---- the split, worked out the same way the server does it

function splitExact(amountMinor, weights) {
  var useful = weights.filter(function (w) { return Number(w.weight) > 0; });
  if (!useful.length || !amountMinor) return [];
  var total = 0;
  useful.forEach(function (w) { total += Number(w.weight); });
  var parts = useful.map(function (w) {
    var raw = amountMinor * Number(w.weight) / total;
    var base = Math.floor(raw);
    return { campaign: w.campaign, amountMinor: base, rem: raw - base };
  });
  var left = amountMinor;
  parts.forEach(function (p) { left -= p.amountMinor; });
  parts.slice().sort(function (a, b) {
    return (b.rem - a.rem) || (a.campaign < b.campaign ? -1 : 1);
  }).forEach(function (p) { if (left > 0) { p.amountMinor += 1; left--; } });
  return parts.filter(function (p) { return p.amountMinor > 0; }).map(function (p) {
    return { campaign: p.campaign, bp: Math.round(p.amountMinor * 10000 / amountMinor), amountMinor: p.amountMinor };
  });
}

function ruleWeights(r) {
  var live = D.campaigns.filter(function (c) { return c.status === 'Active' && c.kind === 'Client'; });
  return live.map(function (c) {
    return { campaign: c.name, weight: r.method === 'Seats' ? c.seats : (r.method === 'Agents' ? c.agents : 1) };
  });
}

// Works out one line's campaign split from whatever it is set to. Called before
// every render and before saving, so what you see is what gets written.
function settle(line) {
  var amount = line.amountMinor || 0;
  if (!amount) { line.allocations = []; return line; }
  if (line.allocationMethod === 'rule') {
    var r = rule(line.allocationRule);
    line.allocations = r ? splitExact(amount, ruleWeights(r)) : [];
  } else if (line.allocationMethod === 'split') {
    var wanted = (line.weights || []).filter(function (w) { return campaign(w.campaign) && Number(w.bp) > 0; });
    line.allocations = splitExact(amount, wanted.map(function (w) { return { campaign: w.campaign, weight: Number(w.bp) }; }));
  } else {
    line.allocations = campaign(line.campaign)
      ? [{ campaign: line.campaign, bp: 10000, amountMinor: amount }]
      : [];
  }
  return line;
}

// What a brand-new line should already be set to, so most entries need no taps.
function defaultAllocation(line) {
  var c = cat(line.category);
  if (c && c.rule && rule(c.rule)) {
    line.allocationMethod = 'rule';
    line.allocationRule = c.rule;
    line.campaign = '';
  } else {
    line.allocationMethod = 'direct';
    line.allocationRule = '';
    line.campaign = (BOOT && BOOT.person && BOOT.person.campaign) || S.campaign || '';
    if (!campaign(line.campaign)) {
      var live = liveCampaigns().filter(function (x) { return x.kind === 'Client'; });
      line.campaign = live.length === 1 ? live[0].name : '';
    }
  }
  return settle(line);
}

// What the chip says. It describes what the line is SET to, not what has been
// worked out — so a category that shares itself out reads as settled before any
// amount has been typed.
function allocLabel(line) {
  var set = (line.allocationMethod === 'rule' && rule(line.allocationRule)) ||
    (line.allocationMethod === 'direct' && campaign(line.campaign)) ||
    (line.allocationMethod === 'split' && (line.weights || []).length);
  if (!set) {
    return { title: 'Needs a campaign', sub: 'Tap to say which campaign this is for', need: true };
  }
  if (!line.allocations || !line.allocations.length) {
    if (line.allocationMethod === 'rule') {
      var r = rule(line.allocationRule);
      var over = ruleWeights(r).filter(function (w) { return w.weight > 0; }).length;
      return { title: line.allocationRule, sub: 'shared over ' + over + (over === 1 ? ' campaign' : ' campaigns'), need: false };
    }
    if (line.allocationMethod === 'direct') {
      var c = campaign(line.campaign);
      return { title: (c ? c.icon + ' ' : '') + line.campaign, sub: 'the whole amount', need: false };
    }
    return { title: 'Custom split', sub: (line.weights || []).length + ' campaigns', need: false };
  }
  if (line.allocations.length === 1) {
    var one = campaign(line.allocations[0].campaign);
    return { title: (one ? one.icon + ' ' : '') + line.allocations[0].campaign, sub: 'the whole amount', need: false };
  }
  return {
    title: (line.allocationMethod === 'rule' ? line.allocationRule : 'Custom split') + ' · ' + line.allocations.length + ' campaigns',
    sub: line.allocations.map(function (a) { return a.campaign + ' ' + (a.bp / 100).toFixed(0) + '%'; }).join(' · '),
    need: false,
  };
}

// ---- what is in the period

function inScope(e) {
  if (e.status === 'Void') return false;
  if (S.account && e.account !== S.account && e.toAccount !== S.account) return false;
  if (S.campaign) {
    if (e.type === 'Transfer') return false;
    var hit = false;
    e.lines.forEach(function (l) {
      (l.allocations || []).forEach(function (a) { if (a.campaign === S.campaign) hit = true; });
    });
    if (!hit) return false;
  }
  return true;
}

function visible() {
  var r = range();
  return D.entries.filter(function (e) { return e.date >= r.from && e.date <= r.to && inScope(e); });
}

// How much of an entry counts, once a campaign filter is on.
function weight(e) {
  if (!S.campaign) return e.totalMinor;
  var sum = 0;
  e.lines.forEach(function (l) {
    (l.allocations || []).forEach(function (a) { if (a.campaign === S.campaign) sum += a.amountMinor; });
  });
  return sum;
}

function totals(list) {
  var out = { inc: 0, exp: 0, draft: 0 };
  list.forEach(function (e) {
    var amount = weight(e);
    if (e.type === 'Income') out.inc += amount;
    else if (e.type === 'Expense') { out.exp += amount; if (e.status === 'Draft') out.draft += amount; }
  });
  return out;
}

function byCategory(list, type) {
  var map = {};
  list.forEach(function (e) {
    if (e.type !== type) return;
    e.lines.forEach(function (l) {
      var amount = l.amountMinor;
      if (S.campaign) {
        amount = 0;
        (l.allocations || []).forEach(function (a) { if (a.campaign === S.campaign) amount += a.amountMinor; });
      }
      if (amount) map[l.category] = (map[l.category] || 0) + amount;
    });
  });
  return map;
}

function balance() {
  if (S.account) { var a = account(S.account); return a ? a.balanceMinor : 0; }
  var sum = 0;
  liveAccounts().forEach(function (a) { sum += a.balanceMinor; });
  return sum;
}

// ---- screens

function render() {
  closeSheets();
  if (!D) return;
  if (S.view === 'records') return renderRecords();
  if (S.view === 'drafts') return renderDrafts();
  if (S.view === 'report') return renderReport();
  if (S.view === 'campaigns') return renderCampaigns();
  if (S.view === 'categories') return renderCategories();
  if (S.view === 'accounts') return renderAccounts();
  if (S.view === 'settings') return renderSettings();
  renderHome();
}

function renderCode(message) {
  setApp('<div class="view"><div class="head"><h2>Ironclad Ledger</h2></div>' +
    '<div class="card"><p class="note">Type the access code you were given. If the sheet is shared with ' +
    'the Google account you are signed in with, you are let straight in.</p>' +
    (message ? '<p class="note bad">' + esc(message) + '</p>' : '') +
    '<label class="f"><span>Access code</span><input type="text" id="code" autocapitalize="characters" autocomplete="off"></label>' +
    '<button class="btn" data-go="code">Open</button></div></div>');
  if ($('code')) $('code').focus();
}

function renderHome() {
  var r = range();
  var list = visible();
  var tot = totals(list);
  var sums = byCategory(list, S.mode);
  var mine = catsOf(S.mode, false).slice();
  Object.keys(sums).forEach(function (n) {
    if (!mine.some(function (c) { return c.name === n; })) mine.push(cat(n));
  });
  mine.sort(function (a, b) { return (sums[b.name] || 0) - (sums[a.name] || 0) || a.sort - b.sort; });

  var modeTotal = S.mode === 'Income' ? tot.inc : tot.exp;
  var slices = mine.filter(function (c) { return (sums[c.name] || 0) > 0; })
    .map(function (c) { return { value: sums[c.name], colour: c.colour }; });

  var tiles = mine.slice(0, 23).map(function (c) {
    var v = sums[c.name] || 0;
    return '<button class="tile' + (v ? '' : ' flat') + '" data-go="add:' + esc(c.name) + '">' +
      '<div class="em" style="color:' + esc(c.colour) + '">' + esc(c.icon) + '</div>' +
      '<div class="nm">' + esc(c.name) + '</div>' +
      '<div class="am">' + (v ? esc(fmt(v)) : '—') + '</div></button>';
  }).join('') +
    '<button class="tile add" data-go="new:' + S.mode + '"><div class="em">⋯</div>' +
    '<div class="nm">All ' + (mine.length > 23 ? mine.length : '') + '</div><div class="am">&nbsp;</div></button>';

  var camp = S.campaign ? campaign(S.campaign) : null;
  var acct = S.account ? account(S.account) : null;

  setApp(
    '<div class="bar">' +
      '<button class="icon" data-go="menu">☰</button>' +
      (usingCampaigns()
        ? '<button class="chip" data-go="pickcampaign">' + esc(camp ? camp.icon + ' ' + camp.name : '🎯 All campaigns') + ' ▾</button>'
        : '') +
      '<button class="chip" data-go="pickaccount">' + esc(acct ? acct.icon + ' ' + acct.name : '👝 All money') + ' ▾</button>' +
      '<div class="grow"></div>' +
      '<button class="chip" data-go="pickunit">' + esc(unitName()) + ' ▾</button>' +
    '</div>' +
    '<div class="period">' +
      (S.unit === 'all' ? '' : '<button class="icon" data-go="back1">‹</button>') +
      '<b>' + esc(r.label) + '</b>' +
      (S.unit === 'all' ? '' : '<button class="icon" data-go="fwd1">›</button>') +
    '</div>' +
    draftBanner() +
    '<div class="hero">' +
      '<div class="pills">' +
        '<button class="pill inc' + (S.mode === 'Income' ? ' on' : '') + '" data-go="mode:Income"><small>Money in</small><b>' + esc(fmt(tot.inc)) + '</b></button>' +
        '<button class="pill exp' + (S.mode === 'Expense' ? ' on' : '') + '" data-go="mode:Expense"><small>Money out</small><b>' + esc(fmt(tot.exp)) + '</b></button>' +
      '</div>' +
      '<div class="ringwrap">' + ring(slices, modeTotal) +
        '<div class="centre"><small>' + (S.account ? esc(S.account) : (S.campaign ? 'spent on ' + esc(S.campaign) : 'Money we hold')) + '</small>' +
        '<strong class="' + (!S.campaign && balance() < 0 ? 'bad' : '') + '">' +
          esc(S.campaign ? fmt(tot.exp) : fmt(balance())) + '</strong>' +
        '<em>' + (modeTotal ? esc((S.mode === 'Income' ? 'in: ' : 'out: ') + fmt(modeTotal)) : 'nothing yet') + '</em></div>' +
      '</div>' +
    '</div>' +
    '<div class="grid">' + tiles + '</div>' +
    dock()
  );
}

function draftBanner() {
  if (!D.draftCount) return '';
  return '<button class="alert" data-go="view:drafts">' +
    '<div><b>' + D.draftCount + (D.draftCount === 1 ? ' entry needs a campaign' : ' entries need a campaign') + '</b>' +
    '<span>' + esc(fmt(D.draftMinor || 0)) + ' is not on any campaign yet</span></div>' +
    '<div class="go">›</div></button>';
}

function dock() {
  var mid = S.view === 'home'
    ? '<button class="dockmid" data-go="view:records">Records</button>'
    : (S.view === 'records'
      ? '<button class="dockmid" data-go="menu">Menu</button>'
      : '<button class="dockmid" data-go="view:home">Home</button>');
  return '<div class="dock">' +
    '<button class="round spend" data-go="new:Expense" title="Money out">−</button>' + mid +
    '<button class="round earn" data-go="new:Income" title="Money in">+</button></div>';
}

function ring(slices, total) {
  var C = 2 * Math.PI * 40, off = 0;
  var out = '<circle cx="50" cy="50" r="40" fill="none" stroke="#232d3c" stroke-width="14"/>';
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

// ---- the entry sheet: tap a category, type the amount, done

function freshLine(category) {
  var line = {
    category: category || '', description: '', qty: null, unitPriceMinor: null,
    amountMinor: 0, costCentre: '', allocationMethod: 'direct', campaign: '',
    allocationRule: '', weights: [], allocations: [],
  };
  if (category) defaultAllocation(line);
  return line;
}

function defaultAccountName() {
  var mine = BOOT && BOOT.person && BOOT.person.account;
  if (mine && account(mine)) return mine;
  if (S.account) return S.account;
  var live = liveAccounts();
  return live.length ? live[0].name : '';
}

function openEntry(opts) {
  var o = opts || {};
  if (o.id) {
    M = {
      id: o.id, type: o.type, date: o.date, account: o.account, toAccount: o.toAccount,
      vendor: o.vendor, reference: o.reference, note: o.note, i: 0,
      lines: (o.lines || []).map(function (l) {
        return {
          category: l.category, description: l.description, qty: l.qty,
          unitPriceMinor: l.unitPriceMinor, amountMinor: l.amountMinor, costCentre: l.costCentre,
          allocationMethod: l.allocationMethod || 'direct',
          campaign: (l.allocations && l.allocations.length === 1 && l.allocationMethod !== 'rule') ? l.allocations[0].campaign : '',
          allocationRule: l.allocationRule || '',
          weights: (l.allocations || []).map(function (a) { return { campaign: a.campaign, bp: a.bp }; }),
          allocations: (l.allocations || []).slice(),
        };
      }),
    };
    if (!M.lines.length) M.lines = [freshLine('')];
  } else {
    M = {
      id: '', type: o.type || 'Expense', date: D.today, account: defaultAccountName(),
      toAccount: '', vendor: '', reference: '', note: '', i: 0,
      lines: [freshLine(o.category || '')],
    };
    if (M.type === 'Transfer') M.toAccount = otherAccount(M.account);
  }
  CALC = { cur: M.lines[M.i].amountMinor ? String(M.lines[M.i].amountMinor / 100) : '', acc: null, op: null };
  S.more = false;
  ARMED = '';
  entrySheet();
  if (o.fixAllocation) allocSheet();
}

function otherAccount(not) {
  var live = liveAccounts();
  for (var i = 0; i < live.length; i++) if (live[i].name !== not) return live[i].name;
  return '';
}

function line() { return M.lines[M.i]; }

function entryTotal() {
  var sum = 0;
  M.lines.forEach(function (l, i) { sum += (i === M.i ? amountNow() : l.amountMinor); });
  return sum;
}

function entrySheet() {
  if (!M) return;
  var isTransfer = M.type === 'Transfer';
  var L = line();
  if (!isTransfer) { L.amountMinor = amountNow(); settle(L); }

  var cats = catsOf(M.type, false);
  if (L.category && !cats.some(function (c) { return c.name === L.category; })) cats = [cat(L.category)].concat(cats);
  var catHtml = cats.map(function (c) {
    return '<button class="' + (L.category === c.name ? 'on' : '') + '" data-go="cat:' + esc(c.name) + '">' +
      '<div class="em" style="color:' + esc(c.colour) + '">' + esc(c.icon) + '</div>' +
      '<div class="nm">' + esc(c.name) + '</div></button>';
  }).join('') + '<button class="add" data-go="newcat"><div class="em">＋</div><div class="nm">New</div></button>';

  var accounts = liveAccounts();
  if (M.account && !accounts.some(function (a) { return a.name === M.account; })) {
    var kept = account(M.account);
    if (kept) accounts = [kept].concat(accounts);
  }
  var fromChips = accounts.map(function (a) {
    return '<button class="pick' + (M.account === a.name ? ' on' : '') + '" data-go="from:' + esc(a.name) + '">' +
      esc(a.icon + ' ' + a.name) + '</button>';
  }).join('');
  var toChips = accounts.map(function (a) {
    return '<button class="pick' + (M.toAccount === a.name ? ' on' : '') + '" data-go="to:' + esc(a.name) + '">' +
      esc(a.icon + ' ' + a.name) + '</button>';
  }).join('');

  var lab = allocLabel(L);
  var allocHtml = (isTransfer || !usingCampaigns()) ? '' :
    '<button class="alloc' + (lab.need ? ' need' : '') + '" data-go="alloc">' +
      '<div class="em">' + (lab.need ? '⚠️' : '🎯') + '</div>' +
      '<div class="mid"><b>' + esc(lab.title) + '</b><span>' + esc(lab.sub) + '</span></div>' +
      '<div class="dim">change ›</div></button>';

  var linesHtml = '';
  if (M.lines.length > 1) {
    linesHtml = '<div class="lines">' + M.lines.map(function (l, i) {
      return '<button class="lchip' + (i === M.i ? ' on' : '') + '" data-go="line:' + i + '">' +
        esc(l.category || 'line ' + (i + 1)) + '<i>' + esc(fmt(i === M.i ? amountNow() : l.amountMinor)) + '</i></button>';
    }).join('') + '</div>';
  }

  var keys = [['7','8','9','÷'],['4','5','6','×'],['1','2','3','−'],['.','0','⌫','+']];
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

  var saveLabel = CALC.op ? '='
    : (M.id ? 'Save changes'
      : (isTransfer ? 'Move the money'
        : 'Add ' + (M.type === 'Income' ? 'money in' : 'expense') +
          (M.lines.length > 1 ? ' · ' + fmt(entryTotal()) : '')));

  var details = S.more
    ? '<div class="inline">' +
        '<label class="f"><span>Date</span><input type="date" id="e_date" data-field="date" value="' + esc(M.date) + '"></label>' +
        '<label class="f"><span>Bill / receipt no.</span><input type="text" data-field="reference" value="' + esc(M.reference) + '" placeholder="optional"></label>' +
      '</div>' +
      (isTransfer ? '' : '<label class="f"><span>Paid to</span><input type="text" data-field="vendor" list="vendorlist" value="' + esc(M.vendor) + '" placeholder="shop, landlord, ISP…"></label>' +
        '<datalist id="vendorlist">' + D.vendors.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>' +
        '<label class="f"><span>What it was for</span><input type="text" data-field="description" value="' + esc(L.description) + '" placeholder="line note"></label>' +
        '<label class="f"><span>Cost centre</span><div class="picks">' + D.centres.map(function (c) {
          return '<button class="pick' + (L.costCentre === c.name ? ' on' : '') + '" data-go="centre:' + esc(c.name) + '">' + esc(c.name) + '</button>';
        }).join('') + '</div></label>') +
      '<label class="f"><span>Note on the voucher</span><input type="text" data-field="note" value="' + esc(M.note) + '" placeholder="optional"></label>'
    : '';

  openSheet(
    '<div class="handle"></div>' +
    (M.id ? '' :
      '<div class="tabs">' +
        '<button class="' + (M.type === 'Expense' ? 'on' : '') + '" data-go="type:Expense">Money out</button>' +
        '<button class="' + (M.type === 'Income' ? 'on' : '') + '" data-go="type:Income">Money in</button>' +
        '<button class="' + (isTransfer ? 'on' : '') + '" data-go="type:Transfer">Move</button>' +
      '</div>') +
    linesHtml +
    '<div class="amount"><span class="op">' + esc(calcPending()) + '</span><span>' +
      esc(D.settings.currency + ' ' + calcShown()) + '</span></div>' +
    (isTransfer
      ? '<label class="f"><span>From</span></label><div class="picks" style="margin:-6px 0 10px">' + fromChips + '</div>' +
        '<label class="f"><span>To</span></label><div class="picks" style="margin:-6px 0 10px">' + toChips + '</div>'
      : '<div class="cats">' + catHtml + '</div>' + allocHtml +
        '<div class="picks" style="margin-bottom:8px">' + fromChips + '</div>') +
    '<button class="more" data-go="more">' + (S.more ? 'Fewer details ▴' : 'Date, bill no., who it was paid to ▾') + '</button>' +
    details +
    '<div class="keys">' + keypad + '</div>' +
    '<button class="btn" style="margin-top:10px" data-go="save">' + esc(saveLabel) + '</button>' +
    (isTransfer ? '' : '<button class="btn ghost" style="margin-top:8px" data-go="addline">＋ Another line on this bill</button>') +
    (M.id ? '<button class="btn danger" style="margin-top:8px" data-go="void">' +
      (ARMED === M.id ? 'Tap again to void it' : 'Void this entry') + '</button>' : '') +
    (M.lines.length > 1 ? '<button class="btn ghost" style="margin-top:8px" data-go="dropline">Remove this line</button>' : '') +
    '<button class="btn ghost" style="margin-top:8px" data-go="close">Close</button>'
  );
}

// ---- the keypad is a small calculator, like Monefy's

function trimNum(v) { return String(Math.round((Number(v) || 0) * 100) / 100); }

function applyOp(a, op, b) {
  a = Number(a) || 0; b = Number(b) || 0;
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') return b ? a / b : 0;
  return b;
}

function calcShown() { return CALC.cur === '' ? '0' : CALC.cur; }

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

function calcEquals() {
  if (!CALC.op) return false;
  var v = applyOp(CALC.acc, CALC.op, CALC.cur === '' ? 0 : Number(CALC.cur));
  CALC.acc = null; CALC.op = null;
  CALC.cur = trimNum(v < 0 ? 0 : v);
  entrySheet();
  return true;
}

function amountNow() {
  var v = CALC.op
    ? applyOp(CALC.acc, CALC.op, CALC.cur === '' ? 0 : Number(CALC.cur))
    : (Number(CALC.cur) || 0);
  return Math.round(v * 100);
}

function keepAmount() {
  line().amountMinor = amountNow();
  settle(line());
}

function gotoLine(i) {
  keepAmount();
  M.i = i;
  CALC = { cur: M.lines[i].amountMinor ? String(M.lines[i].amountMinor / 100) : '', acc: null, op: null };
  entrySheet();
}

// ---- who the money was spent for

var A = { tab: 'one' };

function allocSheet() {
  if (!M) return;
  var L = line();
  L.amountMinor = amountNow();
  settle(L);
  A.tab = L.allocationMethod === 'rule' ? 'rule' : (L.allocations.length > 1 ? 'split' : 'one');
  allocRender();
}

function allocRender() {
  var L = line();
  var live = liveCampaigns();
  var body = '';

  if (A.tab === 'one') {
    body = '<p class="note">Everything on this line goes to one campaign.</p><div class="picks">' +
      live.map(function (c) {
        return '<button class="pick' + (L.allocationMethod === 'direct' && L.campaign === c.name ? ' on' : '') +
          '" data-go="one:' + esc(c.name) + '">' + esc(c.icon + ' ' + c.name) + '</button>';
      }).join('') + '</div>';
  } else if (A.tab === 'rule') {
    body = '<p class="note">Shared costs are split over the campaigns that are running. ' +
      'The numbers are worked out now and kept with the entry, so this month\\'s report never changes later.</p>' +
      '<div class="picks" style="margin-bottom:10px">' + D.rules.map(function (r) {
        return '<button class="pick' + (L.allocationMethod === 'rule' && L.allocationRule === r.name ? ' on' : '') +
          '" data-go="rule:' + esc(r.name) + '">' + esc(r.name) + '</button>';
      }).join('') + '</div>' + previewRows(L);
  } else {
    var weights = {};
    (L.weights && L.weights.length ? L.weights : L.allocations).forEach(function (w) { weights[w.campaign] = w.bp; });
    body = '<p class="note">Put a share against each campaign. They do not have to add up to 100 — ' +
      'whatever you type is used as the ratio.</p>' +
      live.map(function (c) {
        return '<div class="split"><div class="nm">' + esc(c.icon + ' ' + c.name) + '</div>' +
          '<input type="text" inputmode="decimal" data-split="' + esc(c.name) + '" value="' +
          (weights[c.name] ? (weights[c.name] / 100) : '') + '" placeholder="0"> ' +
          '<div class="pv" id="pv_' + esc(c.name).replace(/[^A-Za-z0-9]/g, '_') + '">—</div></div>';
      }).join('') +
      '<p class="note" id="splitsum">&nbsp;</p>';
  }

  openSheet2(
    '<div class="handle"></div>' +
    '<h3 style="margin:0 0 4px">Which campaign is this for?</h3>' +
    '<p class="note">' + esc(L.category || 'this line') + ' · ' + esc(fmt(L.amountMinor)) + '</p>' +
    '<div class="tabs">' +
      '<button class="' + (A.tab === 'one' ? 'on' : '') + '" data-go="atab:one">One campaign</button>' +
      '<button class="' + (A.tab === 'rule' ? 'on' : '') + '" data-go="atab:rule">Share it out</button>' +
      '<button class="' + (A.tab === 'split' ? 'on' : '') + '" data-go="atab:split">Custom split</button>' +
    '</div>' + body +
    '<div class="two" style="margin-top:12px">' +
      '<button class="btn ghost" data-go="aclose">Cancel</button>' +
      '<button class="btn" data-go="aapply">Use this</button>' +
    '</div>'
  );
  if (A.tab === 'split') splitPreview();
}

function previewRows(L) {
  if (!L.amountMinor) {
    var r = rule(L.allocationRule);
    var names = r ? ruleWeights(r).filter(function (w) { return w.weight > 0; }).map(function (w) { return w.campaign; }) : [];
    return names.length
      ? '<p class="note">Will be shared over ' + esc(names.join(', ')) + ' once there is an amount.</p>'
      : '<p class="note warnc">No campaign is running that this can be shared over.</p>';
  }
  if (!L.allocations || !L.allocations.length) return '<p class="note warnc">No campaign is running that this can be shared over.</p>';
  return '<div class="card" style="padding:8px 12px">' + L.allocations.map(function (a) {
    return '<div class="split"><div class="nm">' + esc(a.campaign) + '</div>' +
      '<div class="pv">' + (a.bp / 100).toFixed(1) + '%</div>' +
      '<div class="pv" style="color:var(--ink)">' + esc(fmt(a.amountMinor)) + '</div></div>';
  }).join('') + '</div>';
}

function readSplit() {
  var out = [];
  var boxes = document.querySelectorAll('[data-split]');
  for (var i = 0; i < boxes.length; i++) {
    var pct = Number(boxes[i].value);
    if (pct > 0) out.push({ campaign: boxes[i].getAttribute('data-split'), bp: Math.round(pct * 100) });
  }
  return out;
}

// Live preview while the shares are being typed, without redrawing the inputs.
function splitPreview() {
  var L = line();
  var weights = readSplit();
  var parts = splitExact(L.amountMinor, weights.map(function (w) { return { campaign: w.campaign, weight: w.bp }; }));
  var byName = {};
  parts.forEach(function (p) { byName[p.campaign] = p; });
  var boxes = document.querySelectorAll('[data-split]');
  for (var i = 0; i < boxes.length; i++) {
    var name = boxes[i].getAttribute('data-split');
    var cell = $('pv_' + name.replace(/[^A-Za-z0-9]/g, '_'));
    if (cell) cell.textContent = byName[name] ? fmt(byName[name].amountMinor) : '—';
  }
  var sum = 0;
  weights.forEach(function (w) { sum += w.bp; });
  var note = $('splitsum');
  if (note) {
    note.textContent = !weights.length ? 'Nothing shared out yet.'
      : (sum === 10000 ? 'Adds up to 100%.' : 'Adds up to ' + (sum / 100).toFixed(1) + '% — it will be scaled to fit the line exactly.');
  }
}

function allocApply() {
  var L = line();
  if (A.tab === 'one') {
    if (!campaign(L.campaign)) { toast('Pick a campaign.'); return; }
    L.allocationMethod = 'direct';
    L.allocationRule = '';
  } else if (A.tab === 'rule') {
    if (!rule(L.allocationRule)) { toast('Pick how it should be shared out.'); return; }
    L.allocationMethod = 'rule';
  } else {
    var weights = readSplit();
    if (!weights.length) { toast('Put a share against at least one campaign.'); return; }
    L.allocationMethod = 'split';
    L.weights = weights;
    L.allocationRule = '';
  }
  settle(L);
  if (L.amountMinor > 0 && !L.allocations.length) {
    toast('That does not come to anything — check the shares.');
    return;
  }
  closeSheet2();
  entrySheet();
}

// ---- saving

function saveEntry() {
  if (!M) return;
  if (calcEquals()) return;
  keepAmount();

  if (M.type === 'Transfer') {
    if (!(amountNow() > 0)) { toast('Put in an amount above zero.'); return; }
    if (!M.account || !M.toAccount || M.account === M.toAccount) { toast('Pick two different accounts.'); return; }
  } else {
    for (var i = 0; i < M.lines.length; i++) {
      if (!M.lines[i].category) { toast('Line ' + (i + 1) + ' needs a category.'); return; }
      if (!(M.lines[i].amountMinor > 0)) { toast('Line ' + (i + 1) + ' needs an amount.'); return; }
    }
    if (!M.account) { toast('Pick the account it came from.'); return; }
  }

  var editing = !!M.id;
  var payload = {
    id: M.id, type: M.type, date: M.date, account: M.account, toAccount: M.toAccount,
    vendor: M.vendor, reference: M.reference, note: M.note,
    totalMinor: M.type === 'Transfer' ? amountNow() : 0,
    lines: M.type === 'Transfer' ? [] : M.lines.map(function (l) {
      return {
        category: l.category, description: l.description, qty: l.qty,
        unitPriceMinor: l.unitPriceMinor, amountMinor: l.amountMinor, costCentre: l.costCentre,
        allocationMethod: l.allocationMethod, campaign: l.campaign, allocationRule: l.allocationRule,
        allocations: (l.allocationMethod === 'split' ? (l.weights || []) : (l.allocations || []))
          .map(function (a) { return { campaign: a.campaign, bp: a.bp }; }),
      };
    }),
  };

  call('webLedgerSave', { code: CODE, entry: payload }, function (res) {
    if (res.entry) applyEntry(res.entry);
    D.accounts = res.accounts;
    D.draftCount = res.draftCount;
    D.draftMinor = draftTotal();
    var draft = res.entry && res.entry.status === 'Draft';
    closeSheets();
    toast(draft ? 'Saved — it still needs a campaign.' : (editing ? 'Saved.' : 'Added ' + fmt(res.entry ? res.entry.totalMinor : 0)));
    render();
  });
}

function applyEntry(entry) {
  for (var i = 0; i < D.entries.length; i++) {
    if (D.entries[i].id === entry.id) { D.entries[i] = entry; return; }
  }
  D.entries.push(entry);
  D.total = (D.total || 0) + 1;
}

function draftTotal() {
  var sum = 0;
  D.entries.forEach(function (e) {
    if (e.status === 'Draft' && e.type !== 'Transfer') sum += e.totalMinor;
  });
  return sum;
}

function voidEntry() {
  if (!M || !M.id) return;
  if (ARMED !== M.id) { ARMED = M.id; entrySheet(); return; }
  call('webLedgerVoid', { code: CODE, id: M.id }, function (res) {
    D.entries.forEach(function (e) { if (e.id === res.id) e.status = 'Void'; });
    D.accounts = res.accounts;
    D.draftCount = res.draftCount;
    D.draftMinor = draftTotal();
    closeSheets();
    toast('Voided. It stays on the sheet with your name against it.');
    render();
  });
}

function reload(done) {
  call('webLedgerRefresh', { code: CODE }, function (res) {
    D = res.data;
    render();
    if (done) done();
  });
}

// ---- records, and the queue of entries still missing a campaign

function renderRecords() {
  var r = range();
  var list = visible().slice().sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.at || 0) - (a.at || 0);
  });
  var tot = totals(list);
  var out = '', day = '';
  list.forEach(function (e) {
    if (e.date !== day) {
      day = e.date;
      var net = 0;
      list.forEach(function (x) {
        if (x.date !== day) return;
        if (x.type === 'Income') net += weight(x);
        else if (x.type === 'Expense') net -= weight(x);
      });
      out += '<div class="daysep"><span>' + esc(dayLabel(day)) + '</span><span>' +
        (net ? esc((net > 0 ? '+' : '') + fmt(net)) : '') + '</span></div>';
    }
    out += entryRow(e);
  });

  setApp(
    '<div class="bar">' +
      '<button class="icon" data-go="view:home">‹</button>' +
      '<button class="chip" data-go="pickcampaign">' + esc(S.campaign || 'All campaigns') + ' ▾</button>' +
      '<button class="chip" data-go="pickaccount">' + esc(S.account || 'All money') + ' ▾</button>' +
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
        '<div><small>In</small><b class="good">' + esc(fmt(tot.inc)) + '</b></div>' +
        '<div><small>Out</small><b class="bad">' + esc(fmt(tot.exp)) + '</b></div>' +
        '<div><small>Left</small><b class="' + (tot.inc - tot.exp < 0 ? 'bad' : 'good') + '">' + esc(fmt(tot.inc - tot.exp)) + '</b></div>' +
      '</div>' +
      (list.length ? out : '<div class="empty">Nothing in this period yet.<br>Tap − or + to put something in.</div>') +
    '</div>' + dock()
  );
}

function entryRow(e) {
  var first = e.lines && e.lines.length ? cat(e.lines[0].category) : { icon: '🔁', colour: '#8b98a9' };
  var icon = e.type === 'Transfer' ? '🔁' : first.icon;
  var colour = e.type === 'Transfer' ? '#8b98a9' : first.colour;
  var title = e.type === 'Transfer' ? 'Moved money'
    : (e.lines.length > 1 ? e.lines.length + ' things · ' + e.lines[0].category : (e.lines[0] ? e.lines[0].category : '—'));
  var who = e.type === 'Transfer' ? e.account + ' → ' + e.toAccount
    : [e.vendor, e.account].filter(function (x) { return x; }).join(' · ');
  var camps = {};
  e.lines.forEach(function (l) { (l.allocations || []).forEach(function (a) { camps[a.campaign] = true; }); });
  var names = Object.keys(camps);
  var sub = who + (names.length ? ' · ' + (names.length > 2 ? names.length + ' campaigns' : names.join(', ')) : '');
  var cls = e.type === 'Income' ? 'good' : (e.type === 'Expense' ? 'bad' : 'dim');
  var tag = e.status === 'Draft' ? '<span class="tag draft">needs campaign</span>'
    : (e.status === 'Void' ? '<span class="tag void">void</span>' : '');
  return '<button class="row' + (e.status === 'Draft' ? ' warn' : '') + '" data-go="open:' + esc(e.id) + '">' +
    '<div class="em" style="background:' + esc(colour) + '2e;color:' + esc(colour) + '">' + esc(icon) + '</div>' +
    '<div class="mid"><b>' + esc(title) + tag + '</b><span>' + esc(sub) + '</span></div>' +
    '<div class="amt ' + cls + '">' + esc(signed(weight(e), e.type)) +
    (e.lines.length > 1 ? '<small>' + e.lines.length + ' lines</small>' : '') + '</div></button>';
}

function renderDrafts() {
  var list = D.entries.filter(function (e) { return e.status === 'Draft' && e.type !== 'Transfer'; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  setApp(
    '<div class="view">' +
      '<div class="head"><button class="icon" data-go="view:home">‹</button><h2>Needs a campaign</h2>' +
      '<button class="icon" data-go="menu">☰</button></div>' +
      '<p class="note">The money is already off the account. Until a campaign is set, it stays out of the ' +
      'campaign report — so this list wants to be empty.</p>' +
      (list.length ? list.map(entryRow).join('') : '<div class="empty">Nothing waiting. Good.</div>') +
    '</div>' + dock()
  );
}

// ---- what each campaign cost

function renderReport() {
  var r = range();
  var list = visible().filter(function (e) { return e.type !== 'Transfer'; });
  var rows = {};
  var unalloc = 0;
  liveCampaigns().forEach(function (c) {
    rows[c.name] = { name: c.name, icon: c.icon, colour: c.colour, kind: c.kind, seats: c.seats, inc: 0, direct: 0, shared: 0 };
  });
  list.forEach(function (e) {
    e.lines.forEach(function (l) {
      if (!l.allocations || !l.allocations.length) { if (e.type === 'Expense') unalloc += l.amountMinor; return; }
      l.allocations.forEach(function (a) {
        if (!rows[a.campaign]) {
          var c = campaign(a.campaign) || { icon: '🎯', colour: '#90A4AE', kind: 'Client', seats: 0 };
          rows[a.campaign] = { name: a.campaign, icon: c.icon, colour: c.colour, kind: c.kind, seats: c.seats, inc: 0, direct: 0, shared: 0 };
        }
        if (e.type === 'Income') rows[a.campaign].inc += a.amountMinor;
        else if (l.basis === 'apportioned') rows[a.campaign].shared += a.amountMinor;
        else rows[a.campaign].direct += a.amountMinor;
      });
    });
  });
  var all = Object.keys(rows).map(function (k) { return rows[k]; })
    .sort(function (a, b) { return (b.inc + b.direct + b.shared) - (a.inc + a.direct + a.shared); });

  var body = all.map(function (c) {
    var cost = c.direct + c.shared;
    var net = c.inc - cost;
    return '<tr><td><b>' + esc(c.icon + ' ' + c.name) + '</b>' +
      (c.kind === 'Internal' ? '<span class="tag">internal</span>' : '') +
      '<br><span class="dim" style="font-size:11px">' + (c.seats ? c.seats + ' seats · ' + fmt(c.seats ? Math.round(cost / c.seats) : 0) + ' a seat' : 'no seats set') + '</span></td>' +
      '<td class="good">' + esc(fmt(c.inc)) + '</td>' +
      '<td>' + esc(fmt(c.direct)) + '</td>' +
      '<td class="dim">' + esc(fmt(c.shared)) + '</td>' +
      '<td class="' + (net < 0 ? 'bad' : 'good') + '">' + esc(fmt(net)) + '</td></tr>';
  }).join('');

  setApp(
    '<div class="view">' +
      '<div class="head"><button class="icon" data-go="view:home">‹</button><h2>By campaign</h2>' +
      '<button class="icon" data-go="menu">☰</button></div>' +
      '<div class="period"><button class="icon" data-go="back1">‹</button><b>' + esc(r.label) +
      '</b><button class="icon" data-go="fwd1">›</button></div>' +
      (unalloc ? '<button class="alert" data-go="view:drafts"><div><b>' + esc(fmt(unalloc)) +
        ' is not on any campaign</b><span>it is missing from the table below</span></div><div class="go">›</div></button>' : '') +
      '<div class="card" style="overflow-x:auto">' +
        (all.length
          ? '<table class="rep"><tr><th>Campaign</th><th>In</th><th>Direct</th><th>Shared</th><th>Net</th></tr>' + body + '</table>'
          : '<div class="empty">Nothing in this period.</div>') +
      '</div>' +
      '<p class="note">Direct is what was bought for that campaign. Shared is its slice of rent, ' +
      'electricity and the rest, worked out when each entry was saved.</p>' +
    '</div>' + dock()
  );
}

// ---- the chart of accounts, campaigns and money

function renderCampaigns() {
  var rows = D.campaigns.map(function (c) {
    return '<button class="row" data-go="editcampaign:' + esc(c.id) + '">' +
      '<div class="em" style="background:' + esc(c.colour) + '2e;color:' + esc(c.colour) + '">' + esc(c.icon) + '</div>' +
      '<div class="mid"><b>' + esc(c.name) + (c.status !== 'Active' ? '<span class="tag">' + esc(c.status.toLowerCase()) + '</span>' : '') +
      (c.kind === 'Internal' ? '<span class="tag">internal</span>' : '') + '</b>' +
      '<span>' + esc([c.client, c.seats + ' seats', c.agents + ' agents'].filter(function (x) { return x; }).join(' · ')) + '</span></div>' +
      '</button>';
  }).join('');
  setApp('<div class="view">' +
    '<div class="head"><button class="icon" data-go="view:home">‹</button><h2>Campaigns</h2>' +
    '<button class="icon" data-go="menu">☰</button></div>' +
    (rows || '<div class="empty">No campaigns yet.</div>') +
    '<button class="btn" style="margin-top:10px" data-go="newcampaign">New campaign</button>' +
    '<p class="note">Seats and agents are what the shared costs are divided by. Keep them current and ' +
    'rent, electricity and the internet land where they should. Only client campaigns take a share.</p>' +
    '</div>' + dock());
}

function campaignSheet() {
  var c = EDIT;
  openSheet(
    '<div class="handle"></div><h3 style="margin:0 0 10px">' + (c.id ? 'Edit campaign' : 'New campaign') + '</h3>' +
    '<label class="f"><span>Name</span><input type="text" id="p_name" value="' + esc(c.name) + '"></label>' +
    '<div class="inline">' +
      '<label class="f"><span>Client</span><input type="text" id="p_client" value="' + esc(c.client) + '"></label>' +
      '<label class="f"><span>Short code</span><input type="text" id="p_code" value="' + esc(c.code) + '"></label>' +
    '</div>' +
    '<div class="inline">' +
      '<label class="f"><span>Seats</span><input type="text" inputmode="numeric" id="p_seats" value="' + esc(c.seats) + '"></label>' +
      '<label class="f"><span>Agents</span><input type="text" inputmode="numeric" id="p_agents" value="' + esc(c.agents) + '"></label>' +
    '</div>' +
    '<label class="f"><span>Kind</span><div class="picks">' + D.campaignKinds.map(function (k) {
      return '<button class="pick' + (c.kind === k ? ' on' : '') + '" data-go="pkind:' + esc(k) + '">' + esc(k) + '</button>';
    }).join('') + '</div></label>' +
    '<label class="f"><span>Status</span><div class="picks">' + ['Active', 'Paused', 'Closed'].map(function (k) {
      return '<button class="pick' + (c.status === k ? ' on' : '') + '" data-go="pstatus:' + esc(k) + '">' + esc(k) + '</button>';
    }).join('') + '</div></label>' +
    '<label class="f"><span>Icon</span><div class="picks">' + emojiPicks(c.icon, 'picon') + '</div></label>' +
    '<label class="f"><span>Colour</span><div class="picks">' + colourPicks(c.colour, 'pcolour') + '</div></label>' +
    '<div class="two"><button class="btn ghost" data-go="close">Cancel</button>' +
    '<button class="btn" data-go="savecampaign">Save</button></div>'
  );
}

function grabCampaign() {
  if (!EDIT) return;
  if ($('p_name')) EDIT.name = $('p_name').value;
  if ($('p_client')) EDIT.client = $('p_client').value;
  if ($('p_code')) EDIT.code = $('p_code').value;
  if ($('p_seats')) EDIT.seats = Number($('p_seats').value) || 0;
  if ($('p_agents')) EDIT.agents = Number($('p_agents').value) || 0;
}

function renderCategories() {
  var groups = {};
  catsOf(S.mode, true).forEach(function (c) {
    (groups[c.group || 'Other'] = groups[c.group || 'Other'] || []).push(c);
  });
  var body = Object.keys(groups).map(function (g) {
    return '<div class="daysep"><span>' + esc(g) + '</span></div>' + groups[g].map(function (c) {
      return '<button class="row" data-go="editcat:' + esc(c.id) + '">' +
        '<div class="em" style="background:' + esc(c.colour) + '2e;color:' + esc(c.colour) + '">' + esc(c.icon) + '</div>' +
        '<div class="mid"><b>' + esc(c.name) +
        (c.isNew ? '<span class="tag draft">new</span>' : '') +
        (c.archived ? '<span class="tag">hidden</span>' : '') + '</b>' +
        '<span>' + (c.rule ? 'shared: ' + esc(c.rule) : 'goes to one campaign') +
        (c.budgetMinor ? ' · budget ' + esc(fmt(c.budgetMinor)) : '') + '</span></div></button>';
    }).join('');
  }).join('');

  setApp('<div class="view">' +
    '<div class="head"><button class="icon" data-go="view:home">‹</button><h2>Categories</h2>' +
    '<button class="icon" data-go="menu">☰</button></div>' +
    '<div class="tabs">' +
      '<button class="' + (S.mode === 'Expense' ? 'on' : '') + '" data-go="mode:Expense">Money out</button>' +
      '<button class="' + (S.mode === 'Income' ? 'on' : '') + '" data-go="mode:Income">Money in</button>' +
    '</div>' + (body || '<div class="empty">None yet.</div>') +
    '<button class="btn" style="margin-top:10px" data-go="newcat">New category</button>' +
    '<p class="note">Anything marked "new" was added by someone mid-entry. Tidy the name, give it a group ' +
    'and the mark goes away.</p></div>' + dock());
}

function categorySheet(inEntry) {
  var c = EDIT;
  var groups = D.groups.filter(function (g) { return g.kind === c.kind; });
  var html =
    '<div class="handle"></div><h3 style="margin:0 0 10px">' + (c.id ? 'Edit category' : 'New category') + '</h3>' +
    '<label class="f"><span>Name</span><input type="text" id="c_name" value="' + esc(c.name) + '" placeholder="what it is called"></label>' +
    '<label class="f"><span>Group</span><div class="picks">' + groups.map(function (g) {
      return '<button class="pick' + (c.group === g.name ? ' on' : '') + '" data-go="cgroup:' + esc(g.name) + '">' + esc(g.name) + '</button>';
    }).join('') + '</div></label>' +
    '<label class="f"><span>Icon</span><div class="picks">' + emojiPicks(c.icon, 'cicon') + '</div></label>' +
    '<label class="f"><span>Colour</span><div class="picks">' + colourPicks(c.colour, 'ccolour') + '</div></label>' +
    '<label class="f"><span>Campaign, by default</span><div class="picks">' +
      '<button class="pick' + (!c.rule ? ' on' : '') + '" data-go="crule:">Pick one each time</button>' +
      D.rules.map(function (r) {
        return '<button class="pick' + (c.rule === r.name ? ' on' : '') + '" data-go="crule:' + esc(r.name) + '">' + esc(r.name) + '</button>';
      }).join('') + '</div></label>' +
    (c.id ? '<label class="f"><span>Monthly budget (0 for none)</span><input type="text" inputmode="decimal" id="c_budget" value="' +
      esc(c.budgetMinor ? c.budgetMinor / 100 : 0) + '"></label>' +
      '<button class="pick' + (c.archived ? ' on' : '') + '" data-go="chide" style="margin-bottom:12px">' +
      (c.archived ? '✓ Hidden' : 'Hide this category') + '</button>' : '') +
    '<div class="two"><button class="btn ghost" data-go="' + (inEntry ? 'aclose' : 'close') + '">Cancel</button>' +
    '<button class="btn" data-go="savecat">Save</button></div>';
  if (inEntry) openSheet2(html); else openSheet(html);
}

function grabCategory() {
  if (!EDIT) return;
  if ($('c_name')) EDIT.name = $('c_name').value;
  if ($('c_budget')) EDIT.budget = $('c_budget').value;
}

function renderAccounts() {
  var rows = D.accounts.map(function (a) {
    return '<button class="row" data-go="editaccount:' + esc(a.id) + '">' +
      '<div class="em" style="background:' + esc(a.colour) + '2e;color:' + esc(a.colour) + '">' + esc(a.icon) + '</div>' +
      '<div class="mid"><b>' + esc(a.name) + (a.archived ? '<span class="tag">hidden</span>' : '') + '</b>' +
      '<span>' + esc(a.kind + (a.heldBy ? ' · held by ' + a.heldBy : '')) + '</span></div>' +
      '<div class="amt ' + (a.balanceMinor < 0 ? 'bad' : '') + '">' + esc(fmt(a.balanceMinor)) + '</div></button>';
  }).join('');
  var total = 0;
  liveAccounts().forEach(function (a) { total += a.balanceMinor; });
  setApp('<div class="view">' +
    '<div class="head"><button class="icon" data-go="view:home">‹</button><h2>Money we hold</h2>' +
    '<button class="icon" data-go="menu">☰</button></div>' +
    '<div class="sum"><div><small>Everything together</small><b class="' + (total < 0 ? 'bad' : '') + '">' +
    esc(fmt(total)) + '</b></div></div>' + (rows || '<div class="empty">No accounts yet.</div>') +
    '<div class="two" style="margin-top:10px">' +
      '<button class="btn" data-go="newaccount">New account</button>' +
      '<button class="btn ghost" data-go="new:Transfer">Move money</button></div>' +
    '<p class="note">Cash someone is carrying is an account of kind "Float", held by them. Giving an ' +
    'advance is a move into it; what is left is what they still hold.</p></div>' + dock());
}

function accountSheet() {
  var a = EDIT;
  openSheet(
    '<div class="handle"></div><h3 style="margin:0 0 10px">' + (a.id ? 'Edit account' : 'New account') + '</h3>' +
    '<label class="f"><span>Name</span><input type="text" id="a_name" value="' + esc(a.name) + '"></label>' +
    '<label class="f"><span>Kind</span><div class="picks">' + D.accountKinds.map(function (k) {
      return '<button class="pick' + (a.kind === k ? ' on' : '') + '" data-go="akind:' + esc(k) + '">' + esc(k) + '</button>';
    }).join('') + '</div></label>' +
    '<label class="f"><span>Held by (for a float)</span><input type="text" id="a_held" value="' + esc(a.heldBy) + '" placeholder="name or email"></label>' +
    '<label class="f"><span>What was in it to start with</span><input type="text" inputmode="decimal" id="a_open" value="' +
      esc(a.openingMinor ? a.openingMinor / 100 : 0) + '"></label>' +
    '<label class="f"><span>Icon</span><div class="picks">' + emojiPicks(a.icon, 'aicon') + '</div></label>' +
    '<label class="f"><span>Colour</span><div class="picks">' + colourPicks(a.colour, 'acolour') + '</div></label>' +
    (a.id ? '<button class="pick' + (a.archived ? ' on' : '') + '" data-go="ahide" style="margin-bottom:12px">' +
      (a.archived ? '✓ Hidden' : 'Hide this account') + '</button>' : '') +
    '<div class="two"><button class="btn ghost" data-go="close">Cancel</button>' +
    '<button class="btn" data-go="saveaccount">Save</button></div>'
  );
}

function grabAccount() {
  if (!EDIT) return;
  if ($('a_name')) EDIT.name = $('a_name').value;
  if ($('a_held')) EDIT.heldBy = $('a_held').value;
  if ($('a_open')) EDIT.opening = $('a_open').value;
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

function renderSettings() {
  var me = BOOT && BOOT.person ? BOOT.person : {};
  var admin = me.role === 'Admin';
  setApp('<div class="view">' +
    '<div class="head"><button class="icon" data-go="view:home">‹</button><h2>Settings</h2>' +
    '<button class="icon" data-go="menu">☰</button></div>' +

    '<div class="card"><p class="note">What the keypad fills in for <b>you</b> before you touch it.</p>' +
      '<label class="f"><span>My campaign</span><div class="picks">' +
        '<button class="pick' + (!me.campaign ? ' on' : '') + '" data-go="mycampaign:">Ask me each time</button>' +
        liveCampaigns().map(function (c) {
          return '<button class="pick' + (me.campaign === c.name ? ' on' : '') + '" data-go="mycampaign:' + esc(c.name) + '">' + esc(c.name) + '</button>';
        }).join('') + '</div></label>' +
      '<label class="f"><span>My account</span><div class="picks">' +
        liveAccounts().map(function (a) {
          return '<button class="pick' + (me.account === a.name ? ' on' : '') + '" data-go="myaccount:' + esc(a.name) + '">' + esc(a.name) + '</button>';
        }).join('') + '</div></label></div>' +

    (admin ? '<div class="card">' +
      '<label class="f"><span>Currency</span><input type="text" id="s_cur" value="' + esc(D.settings.currency) + '" maxlength="4"></label>' +
      '<label class="f"><span>Amounts</span><select id="s_dec">' +
        '<option value="0"' + (D.settings.decimals === 0 ? ' selected' : '') + '>Whole rupees</option>' +
        '<option value="2"' + (D.settings.decimals === 2 ? ' selected' : '') + '>With paisa</option></select></label>' +
      '<label class="f"><span>Week starts on</span><select id="s_week">' +
        '<option value="1"' + (D.settings.weekStart === 1 ? ' selected' : '') + '>Monday</option>' +
        '<option value="0"' + (D.settings.weekStart === 0 ? ' selected' : '') + '>Sunday</option></select></label>' +
      '<label class="f"><span>An entry with no campaign</span><select id="s_block">' +
        '<option value="0"' + (!D.settings.blockWithoutCampaign ? ' selected' : '') + '>Save it as a draft and chase it</option>' +
        '<option value="1"' + (D.settings.blockWithoutCampaign ? ' selected' : '') + '>Refuse to save it</option></select></label>' +
      '<button class="btn" data-go="savesettings">Save settings</button></div>' : '') +

    '<div class="card"><p class="note">You are <b>' + esc(me.name || 'signed in') + '</b> (' + esc(me.role || 'Member') + ').<br>' +
      esc(D.total) + ' vouchers on the sheet.<br>' +
      '<span class="dim">Ironclad Tech · www.getironcladtech.com</span></p>' +
      '<button class="btn ghost" data-go="export">Rebuild the Lines and Allocations tabs</button>' +
      (D.sheetUrl ? '<p class="note" style="margin-top:10px"><a href="' + esc(D.sheetUrl) + '" target="_blank">Open the spreadsheet</a></p>' : '') +
    '</div>' +
    '<div class="two"><button class="btn ghost" data-go="refresh">Reload from the sheet</button>' +
    '<button class="btn danger" data-go="forgetcode">Forget my code</button></div>' +
    '</div>' + dock());
}

// ---- sheets, pickers, menu

function openSheet(html) {
  $('sheet').innerHTML = '<div class="inner">' + html + '</div>';
  $('sheet').className = 'sheet';
}
function openSheet2(html) {
  $('sheet2').innerHTML = '<div class="inner">' + html + '</div>';
  $('sheet2').className = 'sheet';
}
function closeSheet2() {
  $('sheet2').className = 'sheet hidden';
  $('sheet2').innerHTML = '';
}
function closeSheets() {
  closeSheet2();
  $('sheet').className = 'sheet hidden';
  $('sheet').innerHTML = '';
  M = null; EDIT = null; ARMED = '';
}

function menuSheet() {
  openSheet('<div class="handle"></div>' +
    '<button class="row" data-go="view:records"><div class="em">🧾</div><div class="mid"><b>Records</b><span>every voucher, newest first</span></div></button>' +
    (D.draftCount ? '<button class="row warn" data-go="view:drafts"><div class="em">⚠️</div><div class="mid"><b>Needs a campaign</b><span>' +
      D.draftCount + ' waiting</span></div></button>' : '') +
    (usingCampaigns()
      ? '<button class="row" data-go="view:report"><div class="em">📊</div><div class="mid"><b>By campaign</b><span>what each one costs</span></div></button>'
      : '') +
    '<button class="row" data-go="view:accounts"><div class="em">👝</div><div class="mid"><b>Money we hold</b><span>cash, bank, floats</span></div></button>' +
    '<button class="row" data-go="new:Transfer"><div class="em">🔁</div><div class="mid"><b>Move money</b><span>advances and top-ups</span></div></button>' +
    '<button class="row" data-go="view:campaigns"><div class="em">🎯</div><div class="mid"><b>Campaigns</b><span>' +
      (usingCampaigns() ? 'seats, agents, status' : 'off — one book for the whole company') + '</span></div></button>' +
    '<button class="row" data-go="view:categories"><div class="em">🏷️</div><div class="mid"><b>Categories</b><span>the chart of accounts</span></div></button>' +
    '<button class="row" data-go="view:settings"><div class="em">⚙️</div><div class="mid"><b>Settings</b><span>defaults, currency, export</span></div></button>' +
    '<button class="btn ghost" style="margin-top:6px" data-go="close">Close</button>');
}

function campaignPicker() {
  var rows = '<button class="row" data-go="setcampaign:"><div class="em">🎯</div>' +
    '<div class="mid"><b>All campaigns</b><span>everything together</span></div></button>';
  rows += liveCampaigns().map(function (c) {
    return '<button class="row" data-go="setcampaign:' + esc(c.name) + '">' +
      '<div class="em" style="background:' + esc(c.colour) + '2e;color:' + esc(c.colour) + '">' + esc(c.icon) + '</div>' +
      '<div class="mid"><b>' + esc(c.name) + '</b><span>' + esc(c.client || c.kind) + '</span></div></button>';
  }).join('');
  openSheet('<div class="handle"></div>' + rows +
    '<button class="btn ghost" style="margin-top:6px" data-go="view:campaigns">Manage campaigns</button>');
}

function accountPicker() {
  var total = 0;
  liveAccounts().forEach(function (a) { total += a.balanceMinor; });
  var rows = '<button class="row" data-go="setaccount:"><div class="em">👝</div>' +
    '<div class="mid"><b>All money</b><span>everything together</span></div>' +
    '<div class="amt">' + esc(fmt(total)) + '</div></button>';
  rows += liveAccounts().map(function (a) {
    return '<button class="row" data-go="setaccount:' + esc(a.name) + '">' +
      '<div class="em" style="background:' + esc(a.colour) + '2e;color:' + esc(a.colour) + '">' + esc(a.icon) + '</div>' +
      '<div class="mid"><b>' + esc(a.name) + '</b><span>' + esc(a.kind) + '</span></div>' +
      '<div class="amt ' + (a.balanceMinor < 0 ? 'bad' : '') + '">' + esc(fmt(a.balanceMinor)) + '</div></button>';
  }).join('');
  openSheet('<div class="handle"></div>' + rows +
    '<button class="btn ghost" style="margin-top:6px" data-go="view:accounts">Manage accounts</button>');
}

function unitPicker() {
  openSheet('<div class="handle"></div>' + UNITS.map(function (u) {
    return '<button class="row" data-go="unit:' + u[0] + '"><div class="mid"><b>' + u[1] + '</b></div>' +
      (S.unit === u[0] ? '<div class="amt">✓</div>' : '') + '</button>';
  }).join(''));
}

// ---- wiring

function go(verb, arg) {
  if (verb === 'code') return submitCode();
  if (!D) return;

  if (verb === 'menu') return menuSheet();
  if (verb === 'pickcampaign') return campaignPicker();
  if (verb === 'pickaccount') return accountPicker();
  if (verb === 'pickunit') return unitPicker();
  if (verb === 'setcampaign') { S.campaign = arg; return render(); }
  if (verb === 'setaccount') { S.account = arg; return render(); }
  if (verb === 'unit') { S.unit = arg; S.anchor = D.today; return render(); }
  if (verb === 'back1') return step(-1);
  if (verb === 'fwd1') return step(1);
  if (verb === 'mode') { S.mode = arg === 'Income' ? 'Income' : 'Expense'; return render(); }
  if (verb === 'view') { S.view = arg; return render(); }
  if (verb === 'close') return render();
  if (verb === 'aclose') { closeSheet2(); return M ? entrySheet() : null; }
  if (verb === 'refresh') return reload(function () { toast('Up to date.'); });
  if (verb === 'export') {
    return call('webLedgerExport', { code: CODE }, function (res) {
      toast(res.counts.lines + ' line items and ' + res.counts.allocations + ' splits written to the sheet.');
    });
  }
  if (verb === 'forgetcode') { forget(); BOOT = null; D = null; return renderCode(''); }

  // entering
  if (verb === 'add') return openEntry({ type: cat(arg).kind, category: arg });
  if (verb === 'new') return openEntry({ type: arg });
  if (verb === 'open') {
    for (var i = 0; i < D.entries.length; i++) {
      if (D.entries[i].id === arg) {
        if (D.entries[i].status === 'Void') return toast('That entry was voided.');
        return openEntry(D.entries[i]);
      }
    }
    return toast('That entry is not loaded.');
  }
  if (verb === 'fix') {
    for (var j = 0; j < D.entries.length; j++) {
      if (D.entries[j].id === arg) {
        var e = D.entries[j];
        e.fixAllocation = true;
        return openEntry(e);
      }
    }
    return;
  }

  if (M) {
    if (verb === 'type') {
      M.type = arg;
      if (arg === 'Transfer') { if (!M.toAccount || M.toAccount === M.account) M.toAccount = otherAccount(M.account); }
      else {
        M.lines.forEach(function (l) {
          if (l.category && cat(l.category).kind !== arg) { l.category = ''; l.allocations = []; }
        });
      }
      return entrySheet();
    }
    if (verb === 'cat') {
      var L = line();
      L.category = arg;
      L.amountMinor = amountNow();
      defaultAllocation(L);
      return entrySheet();
    }
    if (verb === 'from') {
      M.account = arg;
      if (M.type === 'Transfer' && M.toAccount === arg) M.toAccount = otherAccount(arg);
      return entrySheet();
    }
    if (verb === 'to') {
      M.toAccount = arg;
      if (M.account === arg) M.account = otherAccount(arg);
      return entrySheet();
    }
    if (verb === 'centre') { line().costCentre = line().costCentre === arg ? '' : arg; return entrySheet(); }
    if (verb === 'more') { S.more = !S.more; return entrySheet(); }
    if (verb === 'line') return gotoLine(Number(arg));
    if (verb === 'addline') {
      keepAmount();
      if (!line().category) return toast('Finish this line first.');
      if (!(line().amountMinor > 0)) return toast('This line needs an amount first.');
      M.lines.push(freshLine(''));
      M.i = M.lines.length - 1;
      CALC = { cur: '', acc: null, op: null };
      return entrySheet();
    }
    if (verb === 'dropline') {
      if (M.lines.length < 2) return;
      M.lines.splice(M.i, 1);
      M.i = Math.max(0, M.i - 1);
      CALC = { cur: M.lines[M.i].amountMinor ? String(M.lines[M.i].amountMinor / 100) : '', acc: null, op: null };
      return entrySheet();
    }
    if (verb === 'key') return calcKey(arg);
    if (verb === 'op') return calcOp(arg);
    if (verb === 'back') return calcBack();
    if (verb === 'save') return saveEntry();
    if (verb === 'void') return voidEntry();
    if (verb === 'alloc') return allocSheet();
    if (verb === 'atab') { A.tab = arg; return allocRender(); }
    if (verb === 'one') { line().campaign = arg; line().allocationMethod = 'direct'; settle(line()); return allocRender(); }
    if (verb === 'rule') { line().allocationRule = arg; line().allocationMethod = 'rule'; settle(line()); return allocRender(); }
    if (verb === 'aapply') return allocApply();
  }

  // the chart of accounts
  if (verb === 'newcat') {
    EDIT = {
      id: '', name: '', kind: M ? M.type : S.mode, group: '', icon: '🏷️',
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)], rule: '', budgetMinor: 0,
      archived: false, inEntry: !!M,
    };
    if (EDIT.kind === 'Transfer') EDIT.kind = 'Expense';
    return categorySheet(EDIT.inEntry);
  }
  if (verb === 'editcat') {
    var found = null;
    D.categories.forEach(function (c) { if (c.id === arg) found = c; });
    if (!found) return;
    EDIT = {
      id: found.id, name: found.name, kind: found.kind, group: found.group, icon: found.icon,
      colour: found.colour, rule: found.rule, budgetMinor: found.budgetMinor,
      archived: found.archived, isNew: false, inEntry: false,
    };
    return categorySheet(false);
  }
  if (EDIT && verb === 'cgroup') { grabCategory(); EDIT.group = arg; return categorySheet(EDIT.inEntry); }
  if (EDIT && verb === 'cicon') { grabCategory(); EDIT.icon = arg; return categorySheet(EDIT.inEntry); }
  if (EDIT && verb === 'ccolour') { grabCategory(); EDIT.colour = arg; return categorySheet(EDIT.inEntry); }
  if (EDIT && verb === 'crule') { grabCategory(); EDIT.rule = arg; return categorySheet(EDIT.inEntry); }
  if (EDIT && verb === 'chide') { grabCategory(); EDIT.archived = !EDIT.archived; return categorySheet(EDIT.inEntry); }
  if (EDIT && verb === 'savecat') {
    grabCategory();
    if (!String(EDIT.name).trim()) return toast('Give it a name.');
    var inEntry = EDIT.inEntry;
    var wanted = String(EDIT.name).trim();
    return call('webLedgerCategory', { code: CODE, category: EDIT }, function (res) {
      D.categories = res.categories;
      if (res.entries) D.entries = res.entries;
      if (inEntry && M) {
        closeSheet2();
        var L = line();
        L.category = wanted;
        L.amountMinor = amountNow();
        defaultAllocation(L);
        EDIT = null;
        toast('Added "' + wanted + '".');
        return entrySheet();
      }
      EDIT = null;
      toast('Saved.');
      render();
    });
  }

  if (verb === 'newcampaign') {
    EDIT = { id: '', name: '', client: '', code: '', kind: 'Client', status: 'Active', seats: 0, agents: 0, icon: '🎯', colour: COLOURS[2] };
    return campaignSheet();
  }
  if (verb === 'editcampaign') {
    var c2 = null;
    D.campaigns.forEach(function (c) { if (c.id === arg) c2 = c; });
    if (!c2) return;
    EDIT = { id: c2.id, name: c2.name, client: c2.client, code: c2.code, kind: c2.kind, status: c2.status, seats: c2.seats, agents: c2.agents, icon: c2.icon, colour: c2.colour };
    return campaignSheet();
  }
  if (EDIT && verb === 'pkind') { grabCampaign(); EDIT.kind = arg; return campaignSheet(); }
  if (EDIT && verb === 'pstatus') { grabCampaign(); EDIT.status = arg; return campaignSheet(); }
  if (EDIT && verb === 'picon') { grabCampaign(); EDIT.icon = arg; return campaignSheet(); }
  if (EDIT && verb === 'pcolour') { grabCampaign(); EDIT.colour = arg; return campaignSheet(); }
  if (EDIT && verb === 'savecampaign') {
    grabCampaign();
    if (!String(EDIT.name).trim()) return toast('Give it a name.');
    return call('webLedgerCampaign', { code: CODE, campaign: EDIT }, function (res) {
      D.campaigns = res.campaigns;
      if (res.entries) D.entries = res.entries;
      EDIT = null;
      toast('Saved.');
      render();
    });
  }

  if (verb === 'newaccount') {
    EDIT = { id: '', name: '', kind: 'Cash', heldBy: '', openingMinor: 0, opening: 0, icon: '💰', colour: COLOURS[2], archived: false };
    return accountSheet();
  }
  if (verb === 'editaccount') {
    var a2 = null;
    D.accounts.forEach(function (a) { if (a.id === arg) a2 = a; });
    if (!a2) return;
    EDIT = { id: a2.id, name: a2.name, kind: a2.kind, heldBy: a2.heldBy, openingMinor: a2.openingMinor, opening: a2.openingMinor / 100, icon: a2.icon, colour: a2.colour, archived: a2.archived };
    return accountSheet();
  }
  if (EDIT && verb === 'akind') { grabAccount(); EDIT.kind = arg; return accountSheet(); }
  if (EDIT && verb === 'aicon') { grabAccount(); EDIT.icon = arg; return accountSheet(); }
  if (EDIT && verb === 'acolour') { grabAccount(); EDIT.colour = arg; return accountSheet(); }
  if (EDIT && verb === 'ahide') { grabAccount(); EDIT.archived = !EDIT.archived; return accountSheet(); }
  if (EDIT && verb === 'saveaccount') {
    grabAccount();
    if (!String(EDIT.name).trim()) return toast('Give it a name.');
    return call('webLedgerAccount', { code: CODE, account: EDIT }, function (res) {
      D.accounts = res.accounts;
      if (res.entries) D.entries = res.entries;
      EDIT = null;
      toast('Saved.');
      render();
    });
  }

  if (verb === 'mycampaign' || verb === 'myaccount') {
    var me = BOOT.person;
    var wantedCampaign = verb === 'mycampaign' ? arg : me.campaign;
    var wantedAccount = verb === 'myaccount' ? arg : me.account;
    return call('webLedgerMe', { code: CODE, defaultCampaign: wantedCampaign, defaultAccount: wantedAccount }, function (res) {
      BOOT.person = res.person;
      toast('That is what the keypad will fill in.');
      render();
    });
  }

  if (verb === 'savesettings') {
    return call('webLedgerSettings', {
      code: CODE,
      settings: {
        currency: ($('s_cur') && $('s_cur').value) || 'Rs',
        decimals: Number($('s_dec') && $('s_dec').value),
        weekStart: Number($('s_week') && $('s_week').value),
        blockWithoutCampaign: Number($('s_block') && $('s_block').value) === 1,
      },
    }, function (res) {
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
  try { window.localStorage.setItem('ledger.code', CODE); } catch (e) { /* private mode */ }
  boot(CODE);
}

function forget() {
  CODE = '';
  try { window.localStorage.removeItem('ledger.code'); } catch (e) { /* private mode */ }
}

function boot(code) {
  busy(true);
  google.script.run
    .withSuccessHandler(function (res) {
      busy(false);
      if (!res || !res.ok) { renderCode(res && res.message); return; }
      BOOT = res;
      D = res.data;
      D.draftMinor = D.draftMinor || 0;
      if (!S.anchor) S.anchor = D.today;
      S.view = 'home';
      render();
    })
    .withFailureHandler(function (err) {
      busy(false);
      setApp('<div class="empty">' + esc(String((err && err.message) || err)) + '</div>');
    })
    .webLedgerBoot(code || '');
}

function start() {
  try { CODE = window.localStorage.getItem('ledger.code') || ''; } catch (e) { CODE = ''; }
  boot(CODE);
}

document.addEventListener('click', function (ev) {
  var el = ev.target && ev.target.closest ? ev.target.closest('[data-go]') : null;
  if (!el) {
    if (ev.target && ev.target.id === 'sheet2') { closeSheet2(); if (M) entrySheet(); return; }
    if (ev.target && ev.target.id === 'sheet') render();
    return;
  }
  var raw = el.getAttribute('data-go') || '';
  var at = raw.indexOf(':');
  go(at < 0 ? raw : raw.slice(0, at), at < 0 ? '' : raw.slice(at + 1));
});

function fieldChanged(ev) {
  var el = ev.target;
  if (!el || !el.getAttribute) return;
  if (el.getAttribute('data-split') !== null && el.getAttribute('data-split') !== undefined) {
    if (el.hasAttribute('data-split')) return splitPreview();
  }
  var field = el.getAttribute('data-field');
  if (!field || !M) return;
  if (field === 'date') M.date = el.value || D.today;
  else if (field === 'vendor') M.vendor = el.value;
  else if (field === 'reference') M.reference = el.value;
  else if (field === 'note') M.note = el.value;
  else if (field === 'description') line().description = el.value;
}
document.addEventListener('input', fieldChanged);
document.addEventListener('change', fieldChanged);

// A real keyboard, for when it is open on a laptop.
document.addEventListener('keydown', function (ev) {
  if (!M) return;
  if ($('sheet2').className.indexOf('hidden') === -1) return;
  var t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  var k = ev.key;
  if (k >= '0' && k <= '9') { calcKey(k); ev.preventDefault(); }
  else if (k === '.' || k === ',') { calcKey('.'); ev.preventDefault(); }
  else if (k === 'Backspace') { calcBack(); ev.preventDefault(); }
  else if (k === '+' || k === '-' || k === '*' || k === '/') { calcOp(k); ev.preventDefault(); }
  else if (k === 'Enter' || k === '=') { saveEntry(); ev.preventDefault(); }
  else if (k === 'Escape') { render(); ev.preventDefault(); }
});

window.addEventListener('load', start);
`;
}

// ---- What the Android app talks to ---------------------------------------

/**
 * One round trip: the phone sends whatever it has not sent yet, and gets back
 * whatever changed since it last asked. Nothing here is required for the phone to
 * work — it is a ledger on its own, and this is how it catches up with the others.
 *
 * POST {op:'sync', code, device, since, entries:[...]}
 */
function doPost(e) {
  let req = null;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, message: 'That was not something I could read.' });
  }
  if (!req || req.op !== 'sync') return jsonOut_({ ok: false, message: 'Unknown request.' });
  return jsonOut_(syncLedger_(req));
}

function jsonOut_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Categories somebody invented on a phone while they were out. Matched on name,
 * because that is what the entries point at: one that is already here is left
 * exactly as it is, and a new one is written down marked "New" for an admin to
 * tidy later. Returns the names that were actually added.
 */
function takeCategories_(ss, person, sent, ctx) {
  if (!sent || !sent.length) return [];
  const t = lgTable_(ss, LG_CATS);
  const added = [];
  sent.slice(0, 50).forEach(function (raw) {
    const name = txt_(raw && raw.name, 80);
    if (!name || ctx.categoryByName[name.toLowerCase()]) return;
    const kind = txt_(raw.kind, 20) === INCOME ? INCOME : EXPENSE;
    lgAppend_(t, {
      'ID': uid_('c'),
      'Name': name,
      'Group': txt_(raw.group, 80) || (kind === INCOME ? 'Income' : 'Admin & financial'),
      'Kind': kind,
      'Icon': txt_(raw.icon, 8) || '🏷️',
      'Colour': txt_(raw.colour, 20) || '#5C6BC0',
      'Default Rule': '',
      'Cost Centre': '',
      'Monthly Budget': '',
      'New': 'Yes',
      'Merged Into': '',
      'Archived': '',
      'Sort': 9000,
      'Added By': person.email || person.name,
      'Added At': new Date(),
    });
    ctx.categoryByName[name.toLowerCase()] = { name: name, kind: kind };
    added.push(name);
  });
  if (added.length) note_(ss, person, 'Took ' + added.length + ' new categories from a phone: ' + added.join(', '));
  return added;
}

/** The folder the bills go in, made once and found again by name. */
function billFolder_() {
  const name = 'Ironclad Tech Ledger — bills';
  const found = DriveApp.getFoldersByName(name);
  return found.hasNext() ? found.next() : DriveApp.createFolder(name);
}

/**
 * Bills a phone has taken in and is handing over: the picture or the PDF
 * itself, in base64, against the voucher it belongs to. Each one goes into a
 * folder in Drive and its address goes in the voucher's Receipt cell, so the
 * other phones and the sheet can all see it. A bill for a voucher that is not
 * here yet is left for the next round, when it will be.
 */
function takeBills_(ss, person, sent, t) {
  if (!sent || !sent.length) return {};
  const done = {};
  let folder = null;
  sent.slice(0, 5).forEach(function (raw) {
    const id = txt_(raw && raw.id, 40);
    const data = raw && raw.data;
    if (!id || !data) return;
    const rowNumber = lgRowOf_(t, id);
    if (!rowNumber) return;                       // the voucher is not here yet
    const already = txt_(t.sh.getRange(rowNumber, t.col('Receipt')).getValue(), 400);
    if (already) { done[id] = already; return; }  // somebody got there first
    try {
      if (!folder) folder = billFolder_();
      const name = txt_(raw.name, 120) || (id + '.jpg');
      const mime = txt_(raw.mime, 80) || 'application/octet-stream';
      const blob = Utilities.newBlob(Utilities.base64Decode(data), mime, name);
      const file = folder.createFile(blob);
      const url = file.getUrl();
      t.sh.getRange(rowNumber, t.col('Receipt')).setValue(url);
      done[id] = url;
    } catch (err) {
      note_(ss, person, 'Could not keep a bill for ' + id + ': ' + err);
    }
  });
  if (Object.keys(done).length) {
    note_(ss, person, 'Kept ' + Object.keys(done).length + ' bill(s) in Drive.');
  }
  return done;
}

function syncLedger_(req) {
  return guarded_(req, function (ss, person) {
    const ctx = context_(ss);
    const newCategories = takeCategories_(ss, person, req.categories, ctx);
    const t = lgTable_(ss, LG_ENTRIES);
    const accepted = [];
    const rejected = {};

    (req.entries || []).slice(0, 200).forEach(function (sent) {
      const id = txt_(sent && sent.id, 40);
      if (!id) return;
      const rowNumber = lgRowOf_(t, id);
      const old = rowNumber ? t.rows[rowNumber - 2] : null;
      const owner = old ? txt_(t.get(old, 'Entered By'), 120) : '';
      if (old && !canEdit_(person, { enteredBy: owner })) {
        rejected[id] = 'That entry belongs to ' + owner + '.';
        return;
      }

      // a phone can void an entry while it is offline
      if (txt_(sent.status, 20) === ST_VOID) {
        // Written and then voided before it ever got here: there is nothing to
        // strike out, and the end the phone is asking for is already true. Say
        // yes, or the phone asks again on every sync for ever.
        if (!rowNumber) { accepted.push(id); return; }
        t.sh.getRange(rowNumber, t.col('Status')).setValue(ST_VOID);
        t.sh.getRange(rowNumber, t.col('Voided By')).setValue(person.email || person.name);
        t.sh.getRange(rowNumber, t.col('Voided At')).setValue(new Date());
        accepted.push(id);
        return;
      }

      const prepared = prepareEntry_(sent, ctx, true);
      if (prepared.error) { rejected[id] = prepared.error; return; }
      const value = prepared.value;
      const enteredBy = owner || txt_(sent.enteredBy, 120) || person.email || person.name;
      const enteredAt = old && t.get(old, 'Entered At') instanceof Date
        ? t.get(old, 'Entered At')
        : (Number(sent.at) ? new Date(Number(sent.at)) : new Date());
      const values = entryRow_(value, id, enteredBy, enteredAt, old ? new Date() : '', '', '');
      if (rowNumber) lgWrite_(t, rowNumber, values);
      else {
        const at = lgAppend_(t, values);
        t.sh.getRange(at, t.col('Date')).setNumberFormat('yyyy-mm-dd');
        t.sh.getRange(at, t.col('Total')).setNumberFormat('#,##0.00');
      }
      if (value.vendor) touchVendor_(ss, value.vendor);
      accepted.push(id);
    });

    if (accepted.length) {
      note_(ss, person, 'Synced ' + accepted.length + ' entries from ' + txt_(req.device, 60) +
        (Object.keys(rejected).length ? ' (' + Object.keys(rejected).length + ' turned down)' : ''));
    }

    // and back down: everything that changed since the phone last asked
    const since = Number(req.since) || 0;
    const mine = {};
    accepted.forEach(function (id) { mine[id] = true; });
    const changed = entries_(ss, ctx.tz)
      .filter(function (entry) { return !mine[entry.id] && entryChangedAt_(entry) > since; })
      .slice(0, 500);

    const bills = takeBills_(ss, person, req.bills, t);
    const receipts = {};
    changed.forEach(function (e) {
      const row = lgRowOf_(t, e.id);
      if (!row) return;
      const where = txt_(t.sh.getRange(row, t.col('Receipt')).getValue(), 400);
      if (where) receipts[e.id] = where;
    });
    Object.keys(bills).forEach(function (id) { receipts[id] = bills[id]; });

    let url = '';
    try { url = ss.getUrl(); } catch (err) { url = ''; }

    return {
      ok: true,
      now: Date.now(),
      accepted: accepted,
      rejected: rejected,
      addedCategories: newCategories,
      bills: bills,
      receipts: receipts,
      sheetUrl: url,
      entries: changed,
      campaigns: ctx.campaignList,
      categories: newCategories.length ? categories_(ss) : ctx.categoryList,
      accounts: ctx.accountList,
      rules: ctx.ruleList,
    };
  });
}

function entryChangedAt_(entry) {
  return Math.max(Number(entry.updatedAt) || 0, Number(entry.at) || 0);
}
