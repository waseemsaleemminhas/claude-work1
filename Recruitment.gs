/**
 * Ironclad Tech — Applicant intake and review.
 *
 * ==> THIS GOES IN ITS OWN, BRAND-NEW SPREADSHEET. <==
 * Do NOT paste it into the Sales / "Dupes Call backs" spreadsheet that runs Code.gs.
 * That sheet holds customer SSNs and bank routing numbers. This script publishes a
 * PUBLIC endpoint that anyone on the internet can post to, so it must never run with
 * permission to read that spreadsheet. Separate sheet, separate Apps Script project,
 * separate deployment.
 *
 * What this does
 *   - doPost  : accepts the application form on https://www.getironcladtech.com/apply
 *               (CV + voice sample arrive as base64 and are saved to a Drive folder),
 *               writes one row per applicant to the "Applicants" tab, emails the
 *               applicant an acknowledgement and the careers inbox a notification.
 *   - doGet   : a staff review page (access-code gated, same idea as Code.gs) to read
 *               applications, open the CV and voice sample, and move each applicant
 *               along the hiring pipeline.
 *   - Someone who applies twice updates their existing row instead of creating a
 *     second one. Matching is on phone number + role.
 *
 * ---- Set up (once) -------------------------------------------------------------
 *  1. Google Drive -> New -> Google Sheet. Name it "Ironclad Tech — Recruitment".
 *  2. Extensions -> Apps Script. Delete the stub, paste this whole file, Save.
 *  3. Run `setup` and approve the permission prompts. It creates every tab, the Drive
 *     folder, the dropdown lists and one staff access code for you.
 *  4. Deploy -> New deployment -> type "Web app"
 *       Execute as:      Me
 *       Who has access:  Anyone                  <-- MUST be "Anyone", not "Anyone with
 *                                                    a Google account". Applicants are
 *                                                    members of the public and will not
 *                                                    be signed in to Google.
 *     Deploy, then copy the /exec URL.
 *  5. Paste that URL into apply.html in the website repo, as the APPLY_ENDPOINT value.
 *  6. "Ironclad Recruitment" menu -> "Staff access codes" for the review-page codes.
 *  7. Optional but recommended — spam protection. Cloudflare dashboard -> Turnstile ->
 *     add a widget for getironcladtech.com. Put the SITE key in apply.html and the
 *     SECRET key here: Project Settings -> Script Properties -> add
 *     TURNSTILE_SECRET = <your secret>. Until that property exists the check is
 *     skipped, so the form works before you configure it.
 *  8. Optional — "Ironclad Recruitment" -> "Install nightly cleanup" to auto-trash the
 *     CVs of rejected applicants after PURGE_REJECTED_AFTER_MONTHS.
 *
 *  After pasting a NEW version of this file: Deploy -> Manage deployments -> edit ->
 *  Version: New version -> Deploy. The URL does not change.
 *
 *  Who can see a CV: the files are left PRIVATE in Drive on purpose — a CV is personal
 *  data and a "anyone with the link" file is one forward away from being public. Share
 *  the Drive folder created by `setup` with the Google accounts of the people who
 *  interview, and nobody else.
 */

// ---- Settings -------------------------------------------------------------

const APPLICANTS_TAB = 'Applicants';
const LOG_TAB = 'Recruitment Log';
const STAFF_TAB = 'Staff Access';
const LISTS_TAB = 'Lists';

const FOLDER_NAME = 'Ironclad Tech — Applications';
const CAREERS_EMAIL = 'careers@getironcladtech.com';
const APP_TITLE = 'Ironclad Tech — Applicant Review';
const SITE_URL = 'https://www.getironcladtech.com';

const ID_PREFIX = 'APP-';
const ID_PAD = 4;

// Upload caps, in megabytes, checked in the browser and again here.
const MAX_CV_MB = 5;
const MAX_VOICE_MB = 3;

// Refuse an application that arrives with no voice sample. The form enforces this
// too, but the endpoint is public, so a direct POST would otherwise land an
// applicant with nothing to judge spoken English on. Set to false to go back to
// accepting applications without one.
const REQUIRE_VOICE = true;

// Email the applicant a "we got it" the moment they submit. This is what stops the
// "any update?" messages arriving on the company WhatsApp number.
const ACK_EMAIL = true;

// Mail quota: a consumer Gmail account can send about 100 emails a day, a Workspace
// account about 1500. Acknowledgements plus status emails stay well inside either
// unless an ad goes viral; if sending ever fails the write still succeeds.

const INTERVIEWS_TAB = 'Interviews';

// The mock-call scorecard. Each line is scored 1-5 on the review page, so the total
// is out of 25. Edit the wording freely - `key` is what gets stored, `label` is what
// the interviewer reads.
const SCORECARD = [
  { key: 'english', label: 'Spoken English', hint: 'Word choice, grammar, how neutral the accent is' },
  { key: 'pace', label: 'Pace and clarity', hint: 'Speed and pauses; easy to follow down a phone line' },
  { key: 'confidence', label: 'Confidence and tone', hint: 'Warm and steady, does not sound like reading aloud' },
  { key: 'script', label: 'Script adherence', hint: 'Stays on the opener and hits every required point' },
  { key: 'objection', label: 'Objection handling', hint: 'Reaction to "not interested" and to being rushed' },
];
const RECOMMENDATIONS = ['Strong yes', 'Yes', 'Borderline', 'No'];

// What an applicant is told when their status changes. Remove a status from this
// object and nothing is sent for it. The reviewer can also untick "email the
// applicant" on any single change.
//   {{name}}   first name        {{id}}     reference, e.g. APP-0042
//   {{role}}   role applied for  {{detail}} the note the reviewer typed, if any
const STATUS_EMAILS = {
  'Shortlisted': {
    subject: 'Your application to Ironclad Tech - shortlisted ({{id}})',
    body: [
      'Hello {{name}},',
      '',
      'Good news. Your application for {{role}} has been shortlisted and we would like to',
      'speak with you.',
      '',
      '{{detail}}',
      '',
      'Please keep your phone available over the next few days. If you need to tell us',
      'anything about your availability, reply to this email quoting {{id}}.',
      '',
      'Regards,',
      'Recruitment Team',
      'Ironclad Tech',
    ].join('\n'),
  },
  'Interview Scheduled': {
    subject: 'Interview confirmed - Ironclad Tech ({{id}})',
    body: [
      'Hello {{name}},',
      '',
      'Your interview for {{role}} is confirmed.',
      '',
      '{{detail}}',
      '',
      'What to expect: a short conversation about your experience, then a mock call where',
      'you read our opener aloud. You do not need to prepare anything or bring documents.',
      '',
      'If you cannot make it, reply to this email quoting {{id}} and we will rearrange.',
      '',
      'Regards,',
      'Recruitment Team',
      'Ironclad Tech',
    ].join('\n'),
  },
  'Rejected': {
    subject: 'Your application to Ironclad Tech ({{id}})',
    body: [
      'Hello {{name}},',
      '',
      'Thank you for applying for {{role}} at Ironclad Tech, and for the time you put into',
      'your application.',
      '',
      'On this occasion we are not taking it further. This is not a judgement on your',
      'ability - we had more strong applicants than seats.',
      '',
      '{{detail}}',
      '',
      'You are welcome to apply again for a future opening.',
      '',
      'We wish you well.',
      '',
      'Regards,',
      'Recruitment Team',
      'Ironclad Tech',
    ].join('\n'),
  },
  'Talent Pool': {
    subject: 'Keeping your details on file - Ironclad Tech ({{id}})',
    body: [
      'Hello {{name}},',
      '',
      'Thank you for applying for {{role}}. We do not have a seat for you right now, but we',
      'were impressed enough to keep your details on file for the next intake.',
      '',
      '{{detail}}',
      '',
      'We will contact you directly when something suitable opens. You do not need to',
      'apply again, though you are welcome to.',
      '',
      'Regards,',
      'Recruitment Team',
      'Ironclad Tech',
    ].join('\n'),
  },
  'Hired': {
    subject: 'Welcome to Ironclad Tech ({{id}})',
    body: [
      'Hello {{name}},',
      '',
      'We are glad to confirm your place with us as {{role}}.',
      '',
      '{{detail}}',
      '',
      'Please reply to this email to confirm you are joining, quoting {{id}}.',
      '',
      'Regards,',
      'Recruitment Team',
      'Ironclad Tech',
    ].join('\n'),
  },
};

// Nightly cleanup: trash the CV and voice file of anyone Rejected this long ago.
// The row stays, so you never re-interview someone by accident.
const PURGE_REJECTED_AFTER_MONTHS = 12;

const STATUSES = [
  'New', 'Re-applied', 'Shortlisted', 'Voice Passed', 'Interview Scheduled',
  'Interviewed', 'Trial', 'Hired', 'Rejected', 'Talent Pool',
];
const OPEN_STATUSES = ['New', 'Re-applied', 'Shortlisted', 'Voice Passed', 'Interview Scheduled', 'Interviewed', 'Trial'];

const ROLES = [
  'Fronter / Cold Calling Agent',
  'Healthcare BPO Associate',
  'Insurance Enrollment Specialist',
  'Customer Support Representative',
  'Team Lead, Operations',
  'Other',
];

const SOURCES = ['Facebook', 'LinkedIn', 'Website', 'Google', 'Referral', 'Walk-in', 'Other'];
const AGE_BRACKETS = ['18-21', '22-25', '26-30', '31-35', '36-40', 'Over 40'];
const YES_NO = ['Yes', 'No'];
const ENGLISH_LEVELS = ['Basic', 'Conversational', 'Fluent', 'Native-like'];
const EXPERIENCE = ['Fresher - no call centre experience', 'Under 6 months', '6 months - 1 year', '1-2 years', '2-5 years', 'Over 5 years'];
const CAMPAIGNS = ['Final Expense', 'ACA / Obamacare', 'Medicare', 'Auto Insurance', 'Solar', 'Debt', 'Customer Service (inbound)', 'Other', 'None yet'];

// Format checks. `re` must match the whole answer (spaces at the ends are ignored).
const RULES = {
  name: { re: "[A-Za-z][A-Za-z .,'-]{1,59}", msg: 'Letters only (spaces, . , \' - allowed).' },
  phone: { re: '[+0-9 ()-]{10,20}', msg: 'A Pakistani mobile number, e.g. 03001234567.' },
  email: { re: '[^@ ]+@[^@ ]+[.][A-Za-z]{2,}', msg: 'A valid email address.' },
  text: { re: '[^\\n\\r]{1,120}', msg: 'Keep this to one short line.' },
  money: { re: '[0-9][0-9, ]{2,12}', msg: 'Digits only, e.g. 60000.' },
  longtext: { re: '[\\s\\S]{0,1500}', msg: 'Too long — keep it under 1500 characters.' },
};

// The application form. `key` is the form field name posted from apply.html,
// `header` is the column on the Applicants tab. Order here = column order there.
const FIELDS = [
  { key: 'role', header: 'Role', required: true, choices: ROLES },
  { key: 'name', header: 'Full Name', rule: 'name', required: true },
  { key: 'phone', header: 'Phone', rule: 'phone', required: true },
  { key: 'email', header: 'Email', rule: 'email', required: true },
  { key: 'city', header: 'City', rule: 'text', required: true },
  { key: 'area', header: 'Area / Neighbourhood', rule: 'text' },
  { key: 'age', header: 'Age Bracket', choices: AGE_BRACKETS, required: true },
  { key: 'onsite', header: 'Can Work On-Site', choices: YES_NO, required: true },
  { key: 'nightshift', header: 'Can Do Night Shift', choices: YES_NO, required: true },
  { key: 'transport', header: 'Needs Company Transport', choices: YES_NO, required: true },
  { key: 'experience', header: 'Call Centre Experience', choices: EXPERIENCE, required: true },
  { key: 'campaigns', header: 'Campaigns Worked', multi: CAMPAIGNS },
  { key: 'dialer', header: 'Used a Dialer', choices: YES_NO },
  { key: 'employer', header: 'Current / Last Employer', rule: 'text' },
  { key: 'currentsalary', header: 'Current Salary', rule: 'money' },
  { key: 'expectedsalary', header: 'Expected Salary', rule: 'money', required: true },
  { key: 'joining', header: 'Earliest Joining Date', rule: 'text', required: true },
  { key: 'english', header: 'Spoken English', choices: ENGLISH_LEVELS, required: true },
  { key: 'computer', header: 'Computer Literacy', choices: ENGLISH_LEVELS },
  { key: 'about', header: 'About / Why This Role', rule: 'longtext' },
  { key: 'source', header: 'Heard About Us Via', choices: SOURCES, required: true },
];

// Answers that are digit strings, not numbers. Sheets parses "03001234567" as the
// number 3001234567 and the leading zero is gone for good, so these columns are forced
// to plain text before anything is written to them. Same reasoning as TEXT_RULES in
// Code.gs for SSN and routing numbers.
const TEXT_FIELDS = ['phone'];

function textHeaders_() {
  return FIELDS.filter(function (f) { return TEXT_FIELDS.indexOf(f.key) !== -1; })
    .map(function (f) { return f.header; });
}

// Columns this script manages itself, after the form fields.
const HEAD_ID = 'Applicant ID';
const HEAD_AT = 'Submitted At';
const HEAD_UPD = 'Updated At';
const HEAD_CV = 'CV';
const HEAD_VOICE = 'Voice Sample';
const HEAD_STATUS = 'Status';
const HEAD_RATING = 'Rating';
const HEAD_BY = 'Reviewed By';
const HEAD_NOTES = 'Notes';
const HEAD_COUNT = 'Times Applied';

function headers_() {
  return [HEAD_ID, HEAD_AT, HEAD_UPD]
    .concat(FIELDS.map(function (f) { return f.header; }))
    .concat([HEAD_CV, HEAD_VOICE, HEAD_STATUS, HEAD_RATING, HEAD_BY, HEAD_NOTES, HEAD_COUNT]);
}

// ---- Menu and one-time setup ---------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ironclad Recruitment')
    .addItem('Set up / repair tabs', 'setup')
    .addItem('Staff access codes', 'showStaffCodes')
    .addItem('Review page link', 'showLink')
    .addItem('Repair phone numbers', 'fixPhoneNumbers')
    .addSeparator()
    .addItem('Install nightly cleanup', 'installCleanup')
    .addItem('Run cleanup now', 'purgeOldFiles')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();

  const app = ensureSheet_(ss, APPLICANTS_TAB);
  const want = headers_();
  app.getRange(1, 1, 1, want.length).setValues([want]).setFontWeight('bold');
  app.setFrozenRows(1);
  app.getRange(1, 1, 1, want.length).setBackground('#1f2933').setFontColor('#ffffff');

  ensureSheet_(ss, LOG_TAB).getRange(1, 1, 1, 5)
    .setValues([['When', 'Who', 'Applicant ID', 'Action', 'Detail']]).setFontWeight('bold');

  const iv = ensureSheet_(ss, INTERVIEWS_TAB);
  const ivHead = interviewHeaders_();
  iv.getRange(1, 1, 1, ivHead.length).setValues([ivHead]).setFontWeight('bold');
  iv.setFrozenRows(1);
  iv.getRange(1, 1, 1, ivHead.length).setBackground('#1f2933').setFontColor('#ffffff');

  const staff = ensureSheet_(ss, STAFF_TAB);
  staff.getRange(1, 1, 1, 3).setValues([['Name', 'Email', 'Access Code']]).setFontWeight('bold');
  if (staff.getLastRow() < 2) {
    staff.getRange(2, 1, 1, 3).setValues([['(your name)', Session.getEffectiveUser().getEmail(), randomCode_()]]);
  }
  refreshStaffCodes_(ss);

  const lists = ensureSheet_(ss, LISTS_TAB);
  const cols = [['Statuses'].concat(STATUSES), ['Roles'].concat(ROLES), ['Sources'].concat(SOURCES)];
  cols.forEach(function (col, i) {
    lists.getRange(1, i + 1, col.length, 1).setValues(col.map(function (v) { return [v]; }));
    lists.getRange(1, i + 1).setFontWeight('bold');
  });

  applyValidation_(app);
  folder_();

  SpreadsheetApp.getUi().alert(
    'Set up.\n\nTabs ready: ' + [APPLICANTS_TAB, INTERVIEWS_TAB, LOG_TAB, STAFF_TAB, LISTS_TAB].join(', ') +
    '\nDrive folder: ' + FOLDER_NAME +
    '\n\nNext: Deploy -> New deployment -> Web app -> Execute as Me, Who has access ANYONE. ' +
    'Then paste the /exec URL into apply.html on the website.');
}

function applyValidation_(sheet) {
  const map = headerMap_(sheet);
  const last = Math.max(sheet.getMaxRows() - 1, 1);
  const put = function (header, values) {
    const col = map[norm_(header)];
    if (col === undefined) return;
    sheet.getRange(2, col + 1, last, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build());
  };
  put(HEAD_STATUS, STATUSES);
  put(HEAD_RATING, ['1', '2', '3', '4', '5']);
  FIELDS.forEach(function (f) { if (f.choices) put(f.header, f.choices); });

  textHeaders_().forEach(function (header) {
    const col = map[norm_(header)];
    if (col !== undefined) sheet.getRange(1, col + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
}

// A sheet has a fixed grid, 1000 rows by default, and getRange throws once you reach
// past it. setup formats and validates the grid that exists at the time, so the applicant
// who lands on the first row beyond it would otherwise fail outright - their CV and voice
// file already saved to Drive, no row written. Grow the grid first; insertRowsAfter carries
// the formatting and validation of the row above, and textFormat_ sets the text columns on
// the new row regardless.
function ensureRow_(sheet, row) {
  const have = sheet.getMaxRows();
  if (row > have) sheet.insertRowsAfter(have, row - have);
}

// Force the text columns of one row to plain text. MUST run before the write: once a
// value has been stored as a number the zero is already lost, and reformatting the cell
// afterwards just displays the damaged number as text.
function textFormat_(sheet, map, row) {
  textHeaders_().forEach(function (header) {
    const col = map[norm_(header)];
    if (col !== undefined) sheet.getRange(row, col + 1).setNumberFormat('@');
  });
}

function ensureSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function mustSheet_(ss, name) {
  const s = ss.getSheetByName(name);
  if (!s) throw new Error('Missing tab "' + name + '". Run setup from the Ironclad Recruitment menu.');
  return s;
}

function folder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

const norm_ = function (s) { return String(s || '').trim().toLowerCase(); };

function headerMap_(sheet) {
  const row = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const map = {};
  row.forEach(function (h, i) { if (String(h).trim()) map[norm_(h)] = i; });
  return map;
}

// ---- Public endpoint: the application form -------------------------------

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonOut_({ ok: false, message: 'The server is busy. Please try again in a moment.' });
  }
  try {
    const p = (e && e.parameter) || {};

    // Honeypot: a real applicant never fills a field that is hidden with CSS.
    // Accept it so the bot believes it worked, and write nothing.
    if (String(p.website || '').trim()) return jsonOut_({ ok: true, message: 'Thanks.' });

    const spam = turnstileFailure_(p['cf-turnstile-response']);
    if (spam) return jsonOut_({ ok: false, message: spam });

    // Checked here rather than pushed onto prepare_'s errors list: apply.html shows
    // result.message and ignores the errors array, so a field error would tell the
    // applicant to check a field marked below while marking nothing.
    if (REQUIRE_VOICE && !String(p.voice_data || '').trim()) {
      return jsonOut_({
        ok: false,
        message: 'A voice sample is required. Please record one on the form, or upload an audio file, then submit again.',
      });
    }

    const prepared = prepare_(p);
    if (prepared.errors.length) {
      return jsonOut_({ ok: false, errors: prepared.errors, message: 'Please check the fields marked below.' });
    }

    const ss = SpreadsheetApp.getActive();
    const sheet = mustSheet_(ss, APPLICANTS_TAB);
    const map = headerMap_(sheet);
    const width = headers_().length;

    const existing = findByPhoneRole_(sheet, map, prepared.values[norm_('Phone')], prepared.values[norm_('Role')]);
    const id = existing ? String(sheet.getRange(existing, map[norm_(HEAD_ID)] + 1).getDisplayValue()) : nextId_(sheet, map);
    const who = prepared.values[norm_('Full Name')];

    const cv = saveUpload_(p.cv_data, p.cv_name, p.cv_type, id, who, 'CV', MAX_CV_MB);
    if (cv.error) return jsonOut_({ ok: false, message: cv.error });
    const voice = saveUpload_(p.voice_data, p.voice_name, p.voice_type, id, who, 'Voice', MAX_VOICE_MB);
    if (voice.error) return jsonOut_({ ok: false, message: voice.error });

    const now = new Date();
    let row;

    if (existing) {
      row = existing;
      const prev = String(sheet.getRange(row, map[norm_(HEAD_STATUS)] + 1).getDisplayValue());
      const count = Number(sheet.getRange(row, map[norm_(HEAD_COUNT)] + 1).getValue()) || 1;
      textFormat_(sheet, map, row);
      FIELDS.forEach(function (f) {
        const col = map[norm_(f.header)];
        if (col !== undefined) sheet.getRange(row, col + 1).setValue(prepared.values[norm_(f.header)]);
      });
      sheet.getRange(row, map[norm_(HEAD_UPD)] + 1).setValue(now);
      sheet.getRange(row, map[norm_(HEAD_COUNT)] + 1).setValue(count + 1);
      if (cv.url) sheet.getRange(row, map[norm_(HEAD_CV)] + 1).setValue(cv.url);
      if (voice.url) sheet.getRange(row, map[norm_(HEAD_VOICE)] + 1).setValue(voice.url);
      if (OPEN_STATUSES.indexOf(prev) === -1) {
        sheet.getRange(row, map[norm_(HEAD_STATUS)] + 1).setValue('Re-applied');
      }
      log_(ss, 'website', id, 'Re-applied', 'Row ' + row + ' updated (application ' + (count + 1) + ')');
    } else {
      const values = new Array(width).fill('');
      values[map[norm_(HEAD_ID)]] = id;
      values[map[norm_(HEAD_AT)]] = now;
      values[map[norm_(HEAD_UPD)]] = now;
      FIELDS.forEach(function (f) {
        const col = map[norm_(f.header)];
        if (col !== undefined) values[col] = prepared.values[norm_(f.header)];
      });
      values[map[norm_(HEAD_CV)]] = cv.url || '';
      values[map[norm_(HEAD_VOICE)]] = voice.url || '';
      values[map[norm_(HEAD_STATUS)]] = 'New';
      values[map[norm_(HEAD_COUNT)]] = 1;
      row = sheet.getLastRow() + 1;
      ensureRow_(sheet, row);
      textFormat_(sheet, map, row);
      sheet.getRange(row, 1, 1, width).setValues([values]);
      log_(ss, 'website', id, 'Applied', 'Row ' + row);
    }

    notify_(id, prepared.values, existing ? 'Re-application' : 'New application', cv, voice);
    if (ACK_EMAIL) ack_(id, prepared.values);

    return jsonOut_({
      ok: true,
      id: id,
      message: 'Thank you — your application is in. Your reference is ' + id +
        '. We review every application and will contact you by phone or email if you are shortlisted.',
    });
  } catch (err) {
    try {
      MailApp.sendEmail(CAREERS_EMAIL, 'Application form error — Ironclad Tech',
        'An application could not be saved.\n\n' + (err && err.stack ? err.stack : err));
    } catch (ignore) { /* nothing more we can do */ }
    return jsonOut_({ ok: false, message: 'Something went wrong saving your application. Please email ' + CAREERS_EMAIL + '.' });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Check the field values and return them keyed by normalised column header.
function prepare_(p) {
  const values = {};
  const errors = [];

  FIELDS.forEach(function (f) {
    let raw = p[f.key];

    if (f.multi) {
      // Checkbox groups arrive as repeated fields; apply.html also sends a joined copy.
      const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
      const kept = list.map(function (v) { return String(v).trim(); })
        .filter(function (v) { return v && f.multi.indexOf(v) !== -1; });
      values[norm_(f.header)] = kept.join(', ');
      return;
    }

    raw = String(raw === undefined || raw === null ? '' : raw).trim();

    if (f.key === 'phone') raw = normPhone_(raw);

    if (!raw) {
      if (f.required) errors.push({ field: f.key, msg: 'This is required.' });
      values[norm_(f.header)] = '';
      return;
    }
    if (f.choices && f.choices.indexOf(raw) === -1) {
      errors.push({ field: f.key, msg: 'Choose one of the listed options.' });
      values[norm_(f.header)] = '';
      return;
    }
    if (f.rule) {
      const rule = RULES[f.rule];
      if (rule && !new RegExp('^(?:' + rule.re + ')$').test(raw)) {
        errors.push({ field: f.key, msg: rule.msg });
        values[norm_(f.header)] = '';
        return;
      }
    }
    if (f.key === 'phone' && !phoneOk_(raw)) {
      errors.push({ field: 'phone', msg: RULES.phone.msg });
      values[norm_(f.header)] = '';
      return;
    }
    values[norm_(f.header)] = raw;
  });

  if (String(p.consent || '').toLowerCase().indexOf('y') !== 0 && String(p.consent || '') !== 'on' && String(p.consent || '') !== 'true') {
    errors.push({ field: 'consent', msg: 'Please tick the box so we may store your application.' });
  }
  return { values: values, errors: errors };
}

// 03001234567, +92 300 1234567 and 3001234567 all become 03001234567.
function normPhone_(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 12 && d.indexOf('92') === 0) d = '0' + d.slice(2);
  else if (d.length === 10 && d.charAt(0) === '3') d = '0' + d;
  return d;
}

function phoneOk_(v) {
  const d = normPhone_(v);
  return d.length === 11 && d.indexOf('03') === 0;
}

function nextId_(sheet, map) {
  const col = map[norm_(HEAD_ID)];
  const last = sheet.getLastRow();
  let max = 0;
  if (last > 1) {
    sheet.getRange(2, col + 1, last - 1, 1).getDisplayValues().forEach(function (r) {
      const n = parseInt(String(r[0]).replace(/\D/g, ''), 10);
      if (n > max) max = n;
    });
  }
  let s = String(max + 1);
  while (s.length < ID_PAD) s = '0' + s;
  return ID_PREFIX + s;
}

function findByPhoneRole_(sheet, map, phone, role) {
  const last = sheet.getLastRow();
  if (last < 2 || !phone) return 0;
  const pc = map[norm_('Phone')];
  const rc = map[norm_('Role')];
  if (pc === undefined) return 0;
  const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (normPhone_(rows[i][pc]) !== phone) continue;
    if (rc === undefined || String(rows[i][rc]).trim() === String(role).trim()) return i + 2;
  }
  return 0;
}

// base64 from the browser -> a private file in the applications folder.
function saveUpload_(data, filename, mime, id, who, label, maxMb) {
  const b64 = String(data || '').trim();
  if (!b64) return { url: '' };
  // A data: URL still carries its prefix if the browser sent the whole thing.
  const comma = b64.indexOf(',');
  const payload = b64.indexOf('base64,') !== -1 ? b64.slice(comma + 1) : b64;
  const bytes = Math.floor(payload.length * 3 / 4);
  if (bytes > maxMb * 1024 * 1024) {
    return { error: label + ' file is too large. The limit is ' + maxMb + ' MB.' };
  }
  try {
    const safeName = String(filename || label).replace(/[\\/:*?"<>|]/g, '_').slice(-60);
    const blob = Utilities.newBlob(Utilities.base64Decode(payload), mime || 'application/octet-stream',
      id + ' — ' + String(who || '').slice(0, 40) + ' — ' + label + ' — ' + safeName);
    const file = folder_().createFile(blob);
    return { url: file.getUrl(), name: file.getName() };
  } catch (err) {
    return { error: 'That ' + label + ' file could not be read. Please try a different file.' };
  }
}

function turnstileFailure_(token) {
  const secret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (!secret) return '';                       // not configured yet — skip the check
  if (!token) return 'Please complete the "I am human" check and submit again.';
  try {
    const res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'post',
      payload: { secret: secret, response: token },
      muteHttpExceptions: true,
    });
    const body = JSON.parse(res.getContentText() || '{}');
    return body.success ? '' : 'The "I am human" check did not pass. Please reload the page and try again.';
  } catch (err) {
    return '';                                  // never block a real applicant on our own outage
  }
}

// ---- Emails --------------------------------------------------------------

function notify_(id, v, subjectKind, cv, voice) {
  const lines = [subjectKind + ' — ' + id, ''];
  FIELDS.forEach(function (f) {
    const val = v[norm_(f.header)];
    if (val) lines.push(f.header + ': ' + val);
  });
  lines.push('');
  lines.push('CV: ' + (cv.url || '(none attached)'));
  lines.push('Voice sample: ' + (voice.url || '(none attached)'));
  lines.push('');
  lines.push('Review page: ' + webUrl_());
  try {
    MailApp.sendEmail(CAREERS_EMAIL,
      subjectKind + ': ' + (v[norm_('Full Name')] || 'Applicant') + ' — ' + (v[norm_('Role')] || '') + ' (' + id + ')',
      lines.join('\n'));
  } catch (err) { /* a failed notification must never fail the application */ }
}

function ack_(id, v) {
  const to = v[norm_('Email')];
  if (!to) return;
  const name = String(v[norm_('Full Name')] || '').split(' ')[0] || 'there';
  const body = [
    'Hello ' + name + ',',
    '',
    'Thank you for applying to Ironclad Tech for the position of ' + (v[norm_('Role')] || 'our open role') + '.',
    'Your application has been received. Your reference number is ' + id + '.',
    '',
    'What happens next',
    '  1. Our recruitment team reviews your CV and your voice sample.',
    '  2. If you are shortlisted we will call or email you to arrange an interview.',
    '  3. You will hear from us either way.',
    '',
    'Please do not send your documents again, and please do not send them by WhatsApp —',
    'everything we need is already with us under the reference above.',
    '',
    'If anything in your application needs correcting, reply to this email and tell us',
    'what to change. Please quote ' + id + '.',
    '',
    'Regards,',
    'Recruitment Team',
    'Ironclad Tech — Rawalpindi, Punjab',
    SITE_URL,
  ].join('\n');
  try {
    MailApp.sendEmail({
      to: to,
      subject: 'We received your application — Ironclad Tech (' + id + ')',
      body: body,
      name: 'Ironclad Tech Recruitment',
      replyTo: CAREERS_EMAIL,
    });
  } catch (err) { /* as above */ }
}

function interviewHeaders_() {
  return ['When', 'Applicant ID', 'Name', 'Role', 'Interviewer']
    .concat(SCORECARD.map(function (c) { return c.label; }))
    .concat(['Total (25)', 'Recommendation', 'Notes']);
}

// Read an applicant row into the handful of fields the emails and scorecard need.
function applicantAt_(sheet, map, row) {
  const get = function (header) {
    const c = map[norm_(header)];
    return c === undefined ? '' : String(sheet.getRange(row, c + 1).getDisplayValue());
  };
  return {
    id: get(HEAD_ID),
    name: get('Full Name'),
    email: get('Email'),
    role: get('Role'),
    status: get(HEAD_STATUS),
  };
}

function fill_(text, v, detail) {
  return String(text)
    .replace(/\{\{name\}\}/g, String(v.name || '').split(' ')[0] || 'there')
    .replace(/\{\{id\}\}/g, v.id || '')
    .replace(/\{\{role\}\}/g, v.role || 'the role you applied for')
    .replace(/\{\{detail\}\}/g, String(detail || '').trim())
    .replace(/\n{3,}/g, '\n\n');          // tidy the gap when {{detail}} is empty
}

// Tell the applicant their status changed. Returns a line for the log, or ''.
function statusEmail_(v, status, detail) {
  const tpl = STATUS_EMAILS[status];
  if (!tpl) return '';
  if (!v.email) return 'no email on file, nothing sent';
  try {
    MailApp.sendEmail({
      to: v.email,
      subject: fill_(tpl.subject, v, detail),
      body: fill_(tpl.body, v, detail),
      name: 'Ironclad Tech Recruitment',
      replyTo: CAREERS_EMAIL,
    });
    return 'emailed the applicant';
  } catch (err) {
    return 'EMAIL FAILED: ' + (err && err.message ? err.message : err);
  }
}

// Save a mock-call scorecard. One row per interview, so a second interview does not
// overwrite the first; the applicant's Rating is refreshed from the latest total.
function webInterview(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const staff = findStaff_(ss, req && req.code);
    if (!staff) return { ok: false, needCode: true, message: 'Your access code was not recognised.' };

    const sheet = mustSheet_(ss, APPLICANTS_TAB);
    const map = headerMap_(sheet);
    const row = Number(req && req.row);
    if (!(row > 1) || row > sheet.getLastRow()) {
      return { ok: false, message: 'That applicant could not be opened. Refresh the list.' };
    }
    const who = applicantAt_(sheet, map, row);
    if (!who.id || (req.id && who.id !== req.id)) {
      return { ok: false, message: 'The list has moved on. Refresh and try again.' };
    }

    const scores = (req && req.scores) || {};
    const values = [];
    let total = 0;
    for (let i = 0; i < SCORECARD.length; i++) {
      const raw = Number(scores[SCORECARD[i].key]);
      if (!(raw >= 1 && raw <= 5)) {
        return { ok: false, message: 'Score every line from 1 to 5 before saving.' };
      }
      values.push(raw);
      total += raw;
    }

    const rec = String((req && req.recommendation) || '');
    if (RECOMMENDATIONS.indexOf(rec) === -1) {
      return { ok: false, message: 'Choose a recommendation.' };
    }

    const iv = mustSheet_(ss, INTERVIEWS_TAB);
    iv.appendRow([new Date(), who.id, who.name, who.role, staff.email]
      .concat(values)
      .concat([total, rec, String((req && req.notes) || '').slice(0, 2000)]));

    // Rating is 1-5 on the applicant row; the scorecard is out of 25.
    const ratingCol = map[norm_(HEAD_RATING)];
    if (ratingCol !== undefined) sheet.getRange(row, ratingCol + 1).setValue(Math.round(total / 5));
    sheet.getRange(row, map[norm_(HEAD_UPD)] + 1).setValue(new Date());
    sheet.getRange(row, map[norm_(HEAD_BY)] + 1).setValue(staff.email);

    let moved = '';
    if (req && req.markInterviewed && who.status !== 'Interviewed') {
      sheet.getRange(row, map[norm_(HEAD_STATUS)] + 1).setValue('Interviewed');
      moved = ' Status set to Interviewed.';
    }

    log_(ss, staff.email, who.id, 'Interview', total + '/25, ' + rec);
    return {
      ok: true,
      total: total,
      rating: Math.round(total / 5),
      recommendation: rec,
      message: 'Scorecard saved: ' + total + '/25, ' + rec + '.' + moved,
    };
  } finally {
    lock.releaseLock();
  }
}

// Most recent interview per applicant, so the list can show it without opening each one.
function lastInterviews_(ss) {
  const sheet = ss.getSheetByName(INTERVIEWS_TAB);
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  const map = headerMap_(sheet);
  const cId = map[norm_('Applicant ID')];
  const cTotal = map[norm_('Total (25)')];
  const cRec = map[norm_('Recommendation')];
  if (cId === undefined) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues()
    .forEach(function (r) {
      const id = String(r[cId] || '');
      if (!id) return;
      out[id] = {                                  // later rows overwrite earlier ones
        total: cTotal === undefined ? '' : r[cTotal],
        rec: cRec === undefined ? '' : r[cRec],
      };
    });
  return out;
}

function log_(ss, who, id, action, detail) {
  try {
    mustSheet_(ss, LOG_TAB).appendRow([new Date(), who || '', id || '', action || '', detail || '']);
  } catch (err) { /* never block the write we are logging */ }
}

// ---- Staff review page ---------------------------------------------------

function doGet() {
  return HtmlService.createHtmlOutput(pageHtml_())
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Nothing about the sheet is sent back until the access code is recognised.
function webBoot(code) {
  const ss = SpreadsheetApp.getActive();
  const staff = findStaff_(ss, code);
  if (!staff) {
    return {
      ok: false, needCode: true,
      message: code ? 'That access code was not recognised.' : '',
    };
  }
  return {
    ok: true,
    staff: { name: staff.name, email: staff.email },
    statuses: STATUSES, roles: ROLES, open: OPEN_STATUSES,
    scorecard: SCORECARD, recommendations: RECOMMENDATIONS,
    emailStatuses: Object.keys(STATUS_EMAILS),
  };
}

function webApplicants(req) {
  const ss = SpreadsheetApp.getActive();
  const staff = findStaff_(ss, req && req.code);
  if (!staff) return { ok: false, needCode: true, message: 'Your access code was not recognised.' };

  const sheet = mustSheet_(ss, APPLICANTS_TAB);
  const map = headerMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return { ok: true, rows: [] };

  const wantRole = String((req && req.role) || '');
  const wantStatus = String((req && req.status) || '');
  const search = norm_((req && req.q) || '');

  const data = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
  const interviews = lastInterviews_(ss);
  const rows = [];
  for (let i = data.length - 1; i >= 0; i--) {       // newest first
    const d = data[i];
    const get = function (header) {
      const c = map[norm_(header)];
      return c === undefined ? '' : d[c];
    };
    if (!get(HEAD_ID)) continue;
    const status = get(HEAD_STATUS);
    if (wantRole && get('Role') !== wantRole) continue;
    if (wantStatus === '__open' ? OPEN_STATUSES.indexOf(status) === -1 : (wantStatus && status !== wantStatus)) continue;
    if (search) {
      const hay = norm_([get(HEAD_ID), get('Full Name'), get('Phone'), get('Email'), get('City')].join(' '));
      if (hay.indexOf(search) === -1) continue;
    }
    const fields = FIELDS.map(function (f) { return { label: f.header, value: get(f.header) }; })
      .filter(function (x) { return x.value; });
    rows.push({
      row: i + 2,
      id: get(HEAD_ID),
      at: get(HEAD_AT),
      name: get('Full Name'),
      phone: get('Phone'),
      email: get('Email'),
      role: get('Role'),
      city: get('City'),
      english: get('Spoken English'),
      experience: get('Call Centre Experience'),
      status: status,
      rating: get(HEAD_RATING),
      notes: get(HEAD_NOTES),
      by: get(HEAD_BY),
      cv: get(HEAD_CV),
      voice: get(HEAD_VOICE),
      times: get(HEAD_COUNT),
      interview: interviews[get(HEAD_ID)] || null,
      fields: fields,
    });
    if (rows.length >= 300) break;
  }
  return { ok: true, rows: rows };
}

function webUpdate(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const staff = findStaff_(ss, req && req.code);
    if (!staff) return { ok: false, needCode: true, message: 'Your access code was not recognised.' };

    const sheet = mustSheet_(ss, APPLICANTS_TAB);
    const map = headerMap_(sheet);
    const row = Number(req && req.row);
    if (!(row > 1) || row > sheet.getLastRow()) return { ok: false, message: 'That applicant could not be opened. Refresh the list.' };

    const id = String(sheet.getRange(row, map[norm_(HEAD_ID)] + 1).getDisplayValue());
    if (!id || (req.id && id !== req.id)) {
      return { ok: false, message: 'The list has moved on. Refresh and try again.' };
    }

    const changes = [];
    const set = function (header, value) {
      const col = map[norm_(header)];
      if (col === undefined) return;
      const cell = sheet.getRange(row, col + 1);
      const before = String(cell.getDisplayValue());
      const after = String(value === undefined || value === null ? '' : value);
      if (before === after) return;
      cell.setValue(after);
      changes.push(header + ': ' + (before || '(blank)') + ' -> ' + (after || '(blank)'));
    };

    const was = String(sheet.getRange(row, map[norm_(HEAD_STATUS)] + 1).getDisplayValue());

    if (req.status !== undefined) {
      if (STATUSES.indexOf(String(req.status)) === -1) return { ok: false, message: 'Unknown status.' };
      set(HEAD_STATUS, req.status);
    }
    if (req.rating !== undefined) set(HEAD_RATING, req.rating);
    if (req.notes !== undefined) set(HEAD_NOTES, String(req.notes).slice(0, 2000));

    if (!changes.length) return { ok: true, message: 'Nothing changed.' };

    set(HEAD_BY, staff.email);
    sheet.getRange(row, map[norm_(HEAD_UPD)] + 1).setValue(new Date());

    // The row is written before the email goes out: a mail failure must never cost us
    // the status change, and the reviewer is told either way.
    let mailed = '';
    const now = String(req.status === undefined ? was : req.status);
    if (now !== was && req.notify && STATUS_EMAILS[now]) {
      mailed = statusEmail_(applicantAt_(sheet, map, row), now, req.detail);
    }

    log_(ss, staff.email, id, 'Updated', changes.join(' | ') + (mailed ? ' | ' + mailed : ''));
    return {
      ok: true,
      message: 'Saved.' + (mailed === 'emailed the applicant' ? ' The applicant has been emailed.'
             : mailed ? ' But: ' + mailed + '.' : ''),
    };
  } finally {
    lock.releaseLock();
  }
}

// ---- Staff access codes --------------------------------------------------

function findStaff_(ss, code) {
  const want = String(code || '').trim().toUpperCase();

  // Anyone signed in on the company domain is recognised without a code.
  const me = Session.getActiveUser().getEmail();
  const rows = staffRows_(ss);
  if (me) {
    const hit = rows.filter(function (r) { return norm_(r.email) === norm_(me); })[0];
    if (hit) return hit;
  }
  if (!want) return null;
  return rows.filter(function (r) { return String(r.code).toUpperCase() === want; })[0] || null;
}

function staffRows_(ss) {
  const sheet = ss.getSheetByName(STAFF_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const map = headerMap_(sheet);
  const n = { name: map[norm_('Name')], email: map[norm_('Email')], code: map[norm_('Access Code')] };
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues()
    .map(function (r) {
      return {
        name: n.name === undefined ? '' : r[n.name],
        email: n.email === undefined ? '' : r[n.email],
        code: n.code === undefined ? '' : r[n.code],
      };
    })
    .filter(function (r) { return r.email || r.code; });
}

function refreshStaffCodes_(ss) {
  const sheet = mustSheet_(ss, STAFF_TAB);
  if (sheet.getLastRow() < 2) return;
  const map = headerMap_(sheet);
  const col = map[norm_('Access Code')];
  if (col === undefined) return;
  const range = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1);
  const vals = range.getDisplayValues();
  let touched = false;
  const out = vals.map(function (r) {
    if (String(r[0]).trim()) return r;
    touched = true;
    return [randomCode_()];
  });
  if (touched) range.setValues(out);
}

function randomCode_() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I, O, 0, 1 — they get misread
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return s;
}

// Restore leading zeros on rows written before the columns were forced to text.
// Safe to run repeatedly: a number that is already 11 digits is left alone.
function fixPhoneNumbers() {
  const ss = SpreadsheetApp.getActive();
  const sheet = mustSheet_(ss, APPLICANTS_TAB);
  const map = headerMap_(sheet);
  const last = sheet.getLastRow();
  let fixed = 0, looked = 0;

  textHeaders_().forEach(function (header) {
    const col = map[norm_(header)];
    if (col === undefined || last < 2) return;
    const range = sheet.getRange(2, col + 1, last - 1, 1);
    const shown = range.getDisplayValues();
    range.setNumberFormat('@');
    const out = shown.map(function (r) {
      const raw = String(r[0] || '').trim();
      if (!raw) return [''];
      looked++;
      const fix = normPhone_(raw);
      if (fix && fix !== raw) fixed++;
      return [fix || raw];
    });
    range.setValues(out);
  });

  SpreadsheetApp.getUi().alert(
    'Checked ' + looked + ' number(s) and repaired ' + fixed + '.\n\n' +
    'The column is now plain text, so new applications keep their leading zero.');
}

function showStaffCodes() {
  const ss = SpreadsheetApp.getActive();
  refreshStaffCodes_(ss);
  const rows = staffRows_(ss);
  const text = rows.length
    ? rows.map(function (r) { return (r.name || '(no name)') + '  —  ' + r.email + '  —  ' + r.code; }).join('\n')
    : 'No one is listed on the "' + STAFF_TAB + '" tab yet. Add a name and email, then run this again.';
  SpreadsheetApp.getUi().alert('Review page access codes\n\n' + text + '\n\nSend each person their own code. Do not share one code.');
}

function webUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '(deploy the web app to get this link)';
  } catch (err) {
    return '(deploy the web app to get this link)';
  }
}

function showLink() {
  SpreadsheetApp.getUi().alert(
    'Review page (for staff — needs an access code):\n' + webUrl_() +
    '\n\nApplication endpoint (for apply.html on the website):\n' + webUrl_() +
    '\n\nThey are the same URL: GET shows the review page, POST accepts an application.');
}

// ---- Retention -----------------------------------------------------------

function installCleanup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'purgeOldFiles') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('purgeOldFiles').timeBased().everyDays(1).atHour(3).create();
  SpreadsheetApp.getUi().alert('Nightly cleanup installed. CVs and voice samples of rejected applicants are trashed after ' +
    PURGE_REJECTED_AFTER_MONTHS + ' months. The row itself is kept.');
}

function purgeOldFiles() {
  const ss = SpreadsheetApp.getActive();
  const sheet = mustSheet_(ss, APPLICANTS_TAB);
  const map = headerMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - PURGE_REJECTED_AFTER_MONTHS);

  const data = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
  let cleaned = 0;

  data.forEach(function (d, i) {
    const row = i + 2;
    if (String(d[map[norm_(HEAD_STATUS)]]) !== 'Rejected') return;
    const when = new Date(d[map[norm_(HEAD_UPD)]] || d[map[norm_(HEAD_AT)]]);
    if (!(when < cutoff)) return;

    [HEAD_CV, HEAD_VOICE].forEach(function (header) {
      const col = map[norm_(header)];
      if (col === undefined) return;
      const url = String(d[col] || '');
      const id = (url.match(/[-\w]{25,}/) || [])[0];
      if (!id) return;
      try {
        DriveApp.getFileById(id).setTrashed(true);
        cleaned++;
      } catch (err) { /* already gone */ }
      sheet.getRange(row, col + 1).setValue('(file removed — retention)');
    });
  });

  if (cleaned) log_(ss, 'cleanup', '', 'Retention', 'Trashed ' + cleaned + ' file(s) older than ' + PURGE_REJECTED_AFTER_MONTHS + ' months');
}

// ---- The review page itself ----------------------------------------------

function pageHtml_() {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<style>' + css_() + '</style></head><body>',
    '<header><h1>Applicant Review</h1><div id="who"></div></header>',
    '<main id="main">',
    '  <section id="gate" class="card">',
    '    <h2>Access code</h2>',
    '    <p class="muted">Enter the code you were given. Ask Waseem if you do not have one.</p>',
    '    <input id="code" type="text" autocomplete="off" placeholder="ABCD2345" maxlength="8">',
    '    <button id="go" type="button">Open</button>',
    '    <div id="gateMsg" class="msg"></div>',
    '  </section>',
    '  <section id="app" hidden>',
    '    <div class="bar">',
    '      <select id="fRole"></select>',
    '      <select id="fStatus"></select>',
    '      <input id="fQ" type="search" placeholder="Name, phone, email or APP- id">',
    '      <button id="refresh" type="button">Refresh</button>',
    '      <span id="count" class="muted"></span>',
    '    </div>',
    '    <div id="list"></div>',
    '  </section>',
    '</main>',
    '<script>' + clientJs_() + '</scr' + 'ipt>',
    '</body></html>',
  ].join('\n');
}

function css_() {
  return [
    ':root{--gold:#D4AF37;--steel:#1f2933;--line:#dfe3e8;--bg:#f7f8fa;--ok:#1b7f4d;--bad:#b3261e}',
    '*{box-sizing:border-box}',
    'body{margin:0;font:15px/1.5 Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:var(--steel);background:var(--bg)}',
    'header{background:var(--steel);color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}',
    'header h1{font-size:18px;margin:0;font-weight:600}',
    '#who{font-size:13px;opacity:.85}',
    'main{max-width:1000px;margin:0 auto;padding:20px}',
    '.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:20px;max-width:420px}',
    '.card h2{margin:0 0 6px;font-size:17px}',
    '.muted{color:#6b7280;font-size:13px}',
    'input,select,textarea{font:inherit;padding:9px 10px;border:1px solid var(--line);border-radius:7px;background:#fff;width:100%}',
    'textarea{min-height:64px;resize:vertical}',
    'button{font:inherit;font-weight:600;padding:9px 16px;border:0;border-radius:7px;background:var(--gold);color:#1a1a1a;cursor:pointer}',
    'button:hover{filter:brightness(1.06)}button:disabled{opacity:.55;cursor:default}',
    '#code{letter-spacing:3px;text-transform:uppercase;margin:10px 0}',
    '.msg{margin-top:10px;font-size:13px;min-height:18px}',
    '.msg.bad{color:var(--bad)}.msg.ok{color:var(--ok)}',
    '.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}',
    '.bar select,.bar input{width:auto;min-width:150px;flex:0 1 auto}',
    '.bar #fQ{flex:1 1 200px}',
    '.row{background:#fff;border:1px solid var(--line);border-radius:10px;margin-bottom:10px;overflow:hidden}',
    '.head{display:flex;gap:12px;align-items:center;padding:12px 14px;cursor:pointer;flex-wrap:wrap}',
    '.head:hover{background:#fbfbfc}',
    '.head .nm{font-weight:600}',
    '.head .id{font-size:12px;color:#6b7280;font-variant-numeric:tabular-nums}',
    '.head .sp{margin-left:auto}',
    '.pill{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:#eef1f4;white-space:nowrap}',
    '.pill.New,.pill.Re-applied{background:#fff4d6;color:#7a5c00}',
    '.pill.Hired{background:#dff3e6;color:var(--ok)}',
    '.pill.Rejected{background:#fde8e6;color:var(--bad)}',
    '.body{border-top:1px solid var(--line);padding:14px;display:none;background:#fcfcfd}',
    '.row.open .body{display:block}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 18px;margin-bottom:14px}',
    '.grid div{font-size:13px}.grid b{display:block;color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}',
    '.links{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}',
    '.links a{display:inline-block;padding:7px 13px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--steel);text-decoration:none;font-size:13px;font-weight:600}',
    '.links a:hover{border-color:var(--gold)}',
    '.edit{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end}',
    '.edit label{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;font-weight:600;display:block;margin-bottom:4px}',
    '.edit .wide{grid-column:1/-1}',
    '.pill.score{background:#e8eefc;color:#1f3a93;font-variant-numeric:tabular-nums}',
    '.mail-row{background:#fff8e4;border:1px solid #f0dca0;border-radius:8px;padding:10px 12px}',
    'label.inline{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--steel);text-transform:none;letter-spacing:0;margin:0 0 8px;cursor:pointer}',
    'label.inline input{width:16px;height:16px;flex:0 0 auto;accent-color:var(--gold)}',
    '.scorecard{margin-top:14px;border:1px solid var(--line);border-radius:8px;background:#fff}',
    '.scorecard summary{padding:10px 13px;cursor:pointer;font-weight:600;font-size:14px;list-style:none}',
    '.scorecard summary::-webkit-details-marker{display:none}',
    '.scorecard summary:before{content:"\\25B8 ";color:#6b7280}',
    '.scorecard[open] summary:before{content:"\\25BE "}',
    '.scorecard summary:hover{background:#fbfbfc}',
    '.sc-body{padding:4px 13px 14px;border-top:1px solid var(--line)}',
    '.sc-line{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px dashed #eef1f4}',
    '.sc-line:last-of-type{border-bottom:0}',
    '.sc-line label{flex:1;font-size:13px;font-weight:600;margin:0}',
    '.sc-line label small{display:block;font-weight:400;color:#6b7280;font-size:11.5px;margin-top:2px}',
    '.sc-line select{width:auto;min-width:92px;flex:0 0 auto}',
    '.sc-body textarea{margin:10px 0}',
    '@media(max-width:600px){.head .sp{margin-left:0;width:100%}.sc-line{flex-direction:column;align-items:stretch;gap:6px}.sc-line select{width:100%}}',
  ].join('\n');
}

function clientJs_() {
  return [
    'var CODE="",OPEN=[],STATUSES=[],ROLES=[],ROWS=[],SCORECARD=[],RECS=[],MAILED=[];',
    'function el(id){return document.getElementById(id)}',
    'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}',
    'function say(id,t,cls){var n=el(id);n.textContent=t||"";n.className="msg"+(cls?" "+cls:"")}',

    'function boot(code){',
    '  var b=el("go");b.disabled=true;',
    '  google.script.run.withSuccessHandler(function(r){',
    '    b.disabled=false;',
    '    if(!r||!r.ok){say("gateMsg",(r&&r.message)||"Not recognised.","bad");return}',
    '    CODE=code||"";OPEN=r.open;STATUSES=r.statuses;ROLES=r.roles;',
    '    SCORECARD=r.scorecard||[];RECS=r.recommendations||[];MAILED=r.emailStatuses||[];',
    '    el("who").textContent=r.staff.name?r.staff.name+" ("+r.staff.email+")":r.staff.email;',
    '    el("gate").hidden=true;el("app").hidden=false;',
    '    fill();load();',
    '  }).withFailureHandler(function(e){b.disabled=false;say("gateMsg",e&&e.message?e.message:"Could not reach the server.","bad")})',
    '   .webBoot(code||"");',
    '}',

    'function fill(){',
    '  var r=el("fRole");r.innerHTML=\'<option value="">All roles</option>\';',
    '  ROLES.forEach(function(v){r.add(new Option(v,v))});',
    '  var s=el("fStatus");s.innerHTML=\'<option value="__open">Open (not hired/rejected)</option><option value="">Any status</option>\';',
    '  STATUSES.forEach(function(v){s.add(new Option(v,v))});',
    '}',

    'function load(){',
    '  el("count").textContent="Loading...";',
    '  google.script.run.withSuccessHandler(function(r){',
    '    if(!r||!r.ok){el("count").textContent=(r&&r.message)||"Could not load.";return}',
    '    ROWS=r.rows;render();',
    '  }).withFailureHandler(function(e){el("count").textContent=(e&&e.message)||"Could not load."})',
    '   .webApplicants({code:CODE,role:el("fRole").value,status:el("fStatus").value,q:el("fQ").value});',
    '}',

    'function render(){',
    '  el("count").textContent=ROWS.length+" applicant"+(ROWS.length===1?"":"s");',
    '  if(!ROWS.length){el("list").innerHTML=\'<p class="muted">Nothing matches those filters yet.</p>\';return}',
    '  el("list").innerHTML=ROWS.map(card).join("");',
    '  Array.prototype.forEach.call(document.querySelectorAll(".head"),function(h){',
    '    h.addEventListener("click",function(){h.parentNode.classList.toggle("open")});',
    '  });',
    '  Array.prototype.forEach.call(document.querySelectorAll("[data-save]"),function(b){',
    '    b.addEventListener("click",function(){save(b.getAttribute("data-save"))});',
    '  });',
    '  Array.prototype.forEach.call(document.querySelectorAll("[data-interview]"),function(b){',
    '    b.addEventListener("click",function(){saveInterview(b.getAttribute("data-interview"))});',
    '  });',
    '  Array.prototype.forEach.call(document.querySelectorAll("[data-f=\\"status\\"]"),function(sel){',
    '    sel.addEventListener("change",function(){mailHint(sel)});mailHint(sel);',
    '  });',
    '}',

    'function card(a,i){',
    '  var det=a.fields.map(function(f){return "<div><b>"+esc(f.label)+"</b>"+esc(f.value)+"</div>"}).join("");',
    '  var links="";',
    '  if(a.cv)links+=\'<a target="_blank" rel="noopener" href="\'+esc(a.cv)+\'">Open CV</a>\';',
    '  if(a.voice)links+=\'<a target="_blank" rel="noopener" href="\'+esc(a.voice)+\'">Play voice sample</a>\';',
    '  if(a.phone)links+=\'<a href="tel:\'+esc(a.phone)+\'">Call \'+esc(a.phone)+\'</a>\';',
    '  if(a.email)links+=\'<a href="mailto:\'+esc(a.email)+\'">Email</a>\';',
    '  var opts=STATUSES.map(function(s){return \'<option\'+(s===a.status?" selected":"")+\'>\'+esc(s)+"</option>"}).join("");',
    '  var rat=["","1","2","3","4","5"].map(function(s){return \'<option\'+(s===a.rating?" selected":"")+\' value="\'+s+\'">\'+(s||"—")+"</option>"}).join("");',
    '  return \'<div class="row" data-i="\'+i+\'">\'+',
    '    \'<div class="head"><span class="nm">\'+esc(a.name||"(no name)")+\'</span>\'+',
    '      \'<span class="id">\'+esc(a.id)+(Number(a.times)>1?" · applied "+esc(a.times)+"x":"")+\'</span>\'+',
    '      \'<span class="muted">\'+esc(a.role)+" · "+esc(a.city)+\'</span>\'+',
    '      \'<span class="sp"></span><span class="pill \'+esc(String(a.status).replace(/[^A-Za-z-]/g,""))+\'">\'+esc(a.status)+\'</span>\'+',
    '      (a.interview?\'<span class="pill score">\'+esc(a.interview.total)+\'/25</span>\':"")+\'</div>\'+',
    '    \'<div class="body"><div class="grid">\'+det+\'</div><div class="links">\'+links+\'</div>\'+',
    '      \'<div class="edit">\'+',
    '        \'<div><label>Status</label><select data-f="status">\'+opts+\'</select></div>\'+',
    '        \'<div><label>Rating</label><select data-f="rating">\'+rat+\'</select></div>\'+',
    '        \'<div class="wide"><label>Notes (internal, never sent)</label><textarea data-f="notes">\'+esc(a.notes)+\'</textarea></div>\'+',
    '        \'<div class="wide mail-row" data-mailrow hidden>\'+',
    '          \'<label class="inline"><input type="checkbox" data-f2="notify" checked> Email the applicant about this change</label>\'+',
    '          \'<input type="text" data-f="detail" placeholder="Goes into that email - date, time, address, or a line of your own">\'+',
    '        \'</div>\'+',
    '        \'<div><button type="button" data-save="\'+i+\'">Save</button></div>\'+',
    '        \'<div class="msg" data-msg></div>\'+',
    '      \'</div>\'+',
    '      card2(a,i)+',
    '      (a.by?\'<p class="muted">Last changed by \'+esc(a.by)+"</p>":"")+',
    '    \'</div></div>\';',
    '}',

    'function card2(a,i){',
    '  if(!SCORECARD.length) return "";',
    '  var prev=a.interview?\' <span class="pill score">last: \'+esc(a.interview.total)+\'/25, \'+esc(a.interview.rec)+\'</span>\':"";',
    '  var nums=[1,2,3,4,5].map(function(n){return "<option>"+n+"</option>"}).join("");',
    '  var lines=SCORECARD.map(function(c){',
    '    return \'<div class="sc-line"><label>\'+esc(c.label)+\'<small>\'+esc(c.hint)+\'</small></label>\'+',
    '           \'<select data-sc="\'+esc(c.key)+\'"><option value="">-</option>\'+nums+\'</select></div>\';',
    '  }).join("");',
    '  var recs=RECS.map(function(r){return "<option>"+esc(r)+"</option>"}).join("");',
    '  return \'<details class="scorecard"><summary>Mock-call scorecard\'+prev+\'</summary><div class="sc-body">\'+lines+',
    '    \'<div class="sc-line"><label>Recommendation</label><select data-sc-rec><option value="">-</option>\'+recs+\'</select></div>\'+',
    '    \'<textarea data-sc-notes placeholder="What stood out, good or bad"></textarea>\'+',
    '    \'<label class="inline"><input type="checkbox" data-sc-mark checked> Also set status to Interviewed</label>\'+',
    '    \'<div><button type="button" data-interview="\'+i+\'">Save scorecard</button> <span class="msg" data-sc-msg></span></div>\'+',
    '  \'</div></details>\';',
    '}',

    // The "email the applicant" row only appears for a status that has a template.
    'function mailHint(sel){',
    '  var root=sel.closest(".row"); if(!root) return;',
    '  var row=root.querySelector("[data-mailrow]"); if(!row) return;',
    '  row.hidden = MAILED.indexOf(sel.value)===-1;',
    '}',

    'function saveInterview(i){',
    '  var a=ROWS[i];',
    '  var root=document.querySelector(\'.row[data-i="\'+i+\'"]\');',
    '  var btn=root.querySelector("[data-interview]"),msg=root.querySelector("[data-sc-msg]");',
    '  var scores={},missing=0;',
    '  Array.prototype.forEach.call(root.querySelectorAll("[data-sc]"),function(sel){',
    '    if(!sel.value) missing++;',
    '    scores[sel.getAttribute("data-sc")]=sel.value;',
    '  });',
    '  var rec=root.querySelector("[data-sc-rec]").value;',
    '  if(missing||!rec){msg.textContent="Score every line and choose a recommendation.";msg.className="msg bad";return}',
    '  var mark=root.querySelector("[data-sc-mark]").checked;',
    '  btn.disabled=true;msg.textContent="Saving...";msg.className="msg";',
    '  google.script.run.withSuccessHandler(function(r){',
    '    btn.disabled=false;',
    '    if(!r||!r.ok){msg.textContent=(r&&r.message)||"Not saved.";msg.className="msg bad";return}',
    '    msg.textContent=r.message;msg.className="msg ok";',
    '    a.interview={total:r.total,rec:r.recommendation};',
    '    var rating=root.querySelector(\'[data-f="rating"]\'); if(rating) rating.value=String(r.rating);',
    '    if(mark){',
    '      var st=root.querySelector(\'[data-f="status"]\'); if(st){st.value="Interviewed";mailHint(st)}',
    '      var pill=root.querySelector(".pill"); pill.textContent="Interviewed"; pill.className="pill Interviewed";',
    '      a.status="Interviewed";',
    '    }',
    '  }).withFailureHandler(function(e){btn.disabled=false;msg.textContent=(e&&e.message)||"Not saved.";msg.className="msg bad"})',
    '   .webInterview({code:CODE,row:a.row,id:a.id,scores:scores,recommendation:rec,',
    '                  notes:root.querySelector("[data-sc-notes]").value,markInterviewed:mark});',
    '}',

    'function save(i){',
    '  var a=ROWS[i];',
    '  var root=document.querySelector(\'.row[data-i="\'+i+\'"]\');',
    '  var btn=root.querySelector("[data-save]"),msg=root.querySelector("[data-msg]");',
    '  var get=function(f){return root.querySelector(\'[data-f="\'+f+\'"]\').value};',
    '  btn.disabled=true;msg.textContent="Saving...";msg.className="msg";',
    '  google.script.run.withSuccessHandler(function(r){',
    '    btn.disabled=false;',
    '    if(!r||!r.ok){msg.textContent=(r&&r.message)||"Not saved.";msg.className="msg bad";return}',
    '    msg.textContent=r.message;msg.className="msg ok";',
    '    a.status=get("status");a.rating=get("rating");a.notes=get("notes");',
    '    var pill=root.querySelector(".pill");pill.textContent=a.status;',
    '    pill.className="pill "+a.status.replace(/[^A-Za-z-]/g,"");',
    '  }).withFailureHandler(function(e){btn.disabled=false;msg.textContent=(e&&e.message)||"Not saved.";msg.className="msg bad"})',
    '   .webUpdate({code:CODE,row:a.row,id:a.id,status:get("status"),rating:get("rating"),notes:get("notes"),',
    '                notify:!!(root.querySelector(\'[data-f2="notify"]\')||{}).checked,detail:get("detail")});',
    '}',

    'el("go").addEventListener("click",function(){boot(el("code").value.trim().toUpperCase())});',
    'el("code").addEventListener("keydown",function(e){if(e.key==="Enter")el("go").click()});',
    'el("refresh").addEventListener("click",load);',
    'el("fRole").addEventListener("change",load);',
    'el("fStatus").addEventListener("change",load);',
    'var t;el("fQ").addEventListener("input",function(){clearTimeout(t);t=setTimeout(load,350)});',
    'boot("");',   // Workspace users in the Staff Access tab skip the code box
  ].join('\n');
}
