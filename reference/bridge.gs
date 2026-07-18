// ══════════════════════════════════════════════════════════════════════════════
//  Roll Call! Bridge  –  Apps Script Web App
//  Deploy as: Execute as User  |  Who has access: Anyone within Saint John's High School
// ══════════════════════════════════════════════════════════════════════════════

// ── CLASS REGISTRY ─────────────────────────────────────────────────────────────
// Classes are stored in User Properties so each teacher has a private class list.
// Requires deployment mode "Execute as: User accessing the web app".
function getClasses() {
  var raw = PropertiesService.getUserProperties().getProperty('classes');
  return raw ? JSON.parse(raw) : {};
}

function saveClasses(reg) {
  PropertiesService.getUserProperties().setProperty('classes', JSON.stringify(reg));
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class';
}

// ── TERMS ─────────────────────────────────────────────────────────────────────
// A class's grading periods. Stored per class in the registry as
// terms: [{ id, label }] where id doubles as the sheet tab name. Classes
// without a terms entry (all pre-existing ones) default to quarters — zero
// migration needed. The dashboard sends terms only at class creation.
const DEFAULT_TERMS = [
  { id: 'Q1', label: 'Q1' }, { id: 'Q2', label: 'Q2' },
  { id: 'Q3', label: 'Q3' }, { id: 'Q4', label: 'Q4' }
];

function getClassTerms(classId) {
  var reg   = getClasses();
  var entry = reg[classId];
  var terms = entry && entry.terms;
  return (terms && terms.length) ? terms : DEFAULT_TERMS;
}

function getClassTermIds(classId) {
  return getClassTerms(classId).map(function (t) { return t.id; });
}

// Remember the furthest term the teacher has actually taken attendance in, so the next load
// opens there. Called on every writeAttendance.
//
// FORWARD-ONLY, deliberately. Past-day edits write with the term that is on screen, so a
// teacher who flips back to Q1 to fix one wrong cell would otherwise reset their startup term
// to Q1 and get dumped there tomorrow morning. Moving only forward means fixing old data is
// free of consequences. To pin an earlier term on purpose there is the starting-term override
// in the Class Manager, which beats this (see resolveActiveTerm).
//
// Stored separately from `quarter`: that field is the user-facing override ('Auto' = null), and
// silently rewriting it would change a setting the teacher can see and did not touch.
function touchActiveTerm(classId, term) {
  var reg   = getClasses();
  var entry = reg[classId];
  if (!entry || !term) return;
  var ids  = getClassTermIds(classId);
  var next = ids.indexOf(term);
  var cur  = entry.lastTerm ? ids.indexOf(entry.lastTerm) : -1;
  if (next < 0 || next <= cur) return;   // unknown term, or not a step forward — leave it be
  entry.lastTerm = term;
  saveClasses(reg);
}

// Sanitize a dashboard-supplied terms array: ids become sheet tab names, so
// keep them short and drop anything malformed. Returns null for "use default".
function sanitizeTerms(terms) {
  if (!terms || !terms.length || terms.length > 12) return null;
  var reserved = [HALL_PASS_SHEET, TARDY_DISMISSED_SHEET, ROSTER_SHEET, CLASS_INFO_SHEET, META_SHEET]
    .map(function (s) { return s.toLowerCase(); });
  var seen  = {};
  var clean = [];
  for (var i = 0; i < terms.length; i++) {
    var id = String(terms[i].id || '').trim().substring(0, 20);
    // ids become sheet tab names — reject blanks, duplicates, reserved names
    if (!id || seen[id.toLowerCase()] || reserved.indexOf(id.toLowerCase()) >= 0) return null;
    seen[id.toLowerCase()] = true;
    clean.push({ id: id, label: String(terms[i].label || id).trim().substring(0, 30) });
  }
  return clean;
}

// ── SETUP ─────────────────────────────────────────────────────────────────────
// One-time helper: run this from the Apps Script editor after pasting the code
// (Run → setup). It triggers the authorization prompt ahead of time and logs
// your remaining deploy steps — check View → Logs / Execution log.
function setup() {
  var classCount = Object.keys(getClasses()).length;
  Logger.log('Roll Call! bridge setup check');
  Logger.log('─────────────────────────────');
  Logger.log('Authorization: OK (you just granted it by running this).');
  Logger.log('Class registry: %s class(es) registered for %s.',
             String(classCount), Session.getEffectiveUser().getEmail() || 'this account');
  Logger.log('Sheet schema version: %s.', String(SCHEMA_VERSION));
  Logger.log('');
  Logger.log('Next steps:');
  Logger.log('1. Deploy → New deployment → Web app.');
  Logger.log('   Execute as: User accessing the web app | Access: match your school domain.');
  Logger.log('2. Copy the Web App URL (ends in /exec).');
  Logger.log('3. Open dashboard.html and paste the URL into the connect screen.');
  Logger.log('   The first-run wizard walks you through creating your first class.');
}

// ── ONE-OFF MIGRATION ─────────────────────────────────────────────────────────
// Editor-run only, not wired to the UI. Sheets created before the meta tab
// existed have no way to identify themselves, so linking one would be refused.
// An already-registered class keeps working untouched (the gate only runs on
// link), so this is only needed if such a sheet must be re-linked.
//
// Usage: edit the two values below, then Run → stampMetaSheet.
// DELETE THIS FUNCTION once the sheet(s) that predate SCHEMA_VERSION 1 have been
// stamped — it writes the current version onto a layout nobody verified, which
// is exactly what the version marker exists to prevent, and is safe here only
// because a human is asserting the layout is right.
function stampMetaSheet() {
  var sheetId = '';                     // ← the spreadsheet's id
  var terms   = DEFAULT_TERMS;          // ← its real term structure, e.g. [{id:'S1',label:'S1'}, …]

  if (!sheetId) throw new Error('Set sheetId first.');
  var ss = SpreadsheetApp.openById(sheetId);
  var clean = sanitizeTerms(terms);
  if (!clean) throw new Error('terms is malformed.');
  clean.forEach(function (t) {
    if (!ss.getSheetByName(t.id)) throw new Error('No tab named ' + t.id + ' — check terms.');
  });
  if (!ss.getSheetByName(ROSTER_SHEET)) throw new Error('No ' + ROSTER_SHEET + ' tab.');
  var existing = ss.getSheetByName(META_SHEET);
  if (existing) ss.deleteSheet(existing);
  buildMetaSheet(ss.insertSheet(META_SHEET), clean);
  Logger.log('Stamped %s (v%s) with terms: %s',
             ss.getName(), String(SCHEMA_VERSION), clean.map(function (t) { return t.id; }).join(', '));
}

// ── SHEET STRUCTURE ───────────────────────────────────────────────────────────
const COL_LAST       = 3;   // column C — last name
const COL_FIRST      = 4;   // column D — first name
const COL_PRESENT    = 5;   // column E
const COL_TARDY      = 6;   // column F
const COL_ABSENT     = 7;   // column G
const COL_EVENT      = 8;   // column H
const COL_DISMISSED  = 9;   // column I — dismissal count (formula)
const COL_PCT        = 10;  // column J
const COL_DATA_START = 12;  // column L — first attendance date column

const ROW_DOW       = 2;
const ROW_DATE      = 5;
const ROW_EXCEPTION = 6;
const ROW_STUDENTS  = 6;
// Raised 35 → 60 (Phase 5). Newly generated sheets carry formulas for all 60
// rows; sheets built from the old template only have formulas through ~row 35,
// so their effective cap stays ~30 until regenerated.
const MAX_STUDENTS  = 60;

const HALL_PASS_SHEET        = 'Hall Passes';
const TARDY_DISMISSED_SHEET  = 'Tardy / Dismissed';
const ROSTER_SHEET           = 'Raw Input';
const CLASS_INFO_SHEET       = 'Class Info';

// A generated class spreadsheet identifies itself with a hidden meta tab holding
// the schema version and the term structure. Linking an existing sheet requires
// it (see inspectSheetTerms) — no meta tab means we can't know what we're
// looking at, so we refuse rather than register something broken.
const META_SHEET     = '_Roll Call';
const SCHEMA_VERSION = 1;   // bump when the sheet layout contract changes
const EXCEPTION_MARKERS = ['day off', 'snow day', 'dropped', 'holiday', 'no school'];
// The marks a date cell can hold. Used to tell recorded attendance apart from
// anything else that lives in a date column (row 6 doubles as the exception row).
const ATTENDANCE_CODES = ['P', 'T', 'A', 'E', 'D'];

// ── ROSTER COLUMN OFFSETS (relative to col C = index 0) ──────────────────────
const RI_FULL_NAME       = 0;   // C — Full Name
const RI_LAST            = 1;   // D — Last Name
const RI_FIRST           = 2;   // E — First Name
const RI_NICKNAME        = 3;   // F — Nickname
const RI_STUDENT_EMAIL   = 4;   // G — Student Email
const RI_GUARDIAN1_NAME  = 5;   // H — Guardian 1 Name
const RI_GUARDIAN1_EMAIL = 6;   // I — Guardian 1 Email
const RI_GUARDIAN2_NAME  = 7;   // J — Guardian 2 Name
const RI_GUARDIAN2_EMAIL = 8;   // K — Guardian 2 Email
const RI_COUNSELOR_NAME  = 9;   // L — Counselor Name
const RI_COUNSELOR_EMAIL = 10;  // M — Counselor Email
const RI_GRAD_YEAR       = 11;  // N — Graduation Year
const RI_NOTES           = 12;  // O — Notes

// ── WEB APP ENTRY POINTS ──────────────────────────────────────────────────────

// All actions come in as GET requests so no CORS preflight is needed and
// the POST→redirect→GET body-stripping problem is avoided entirely.
// Reads: JSONP <script> tag with callback.
// Writes: JSONP too, sent from the dashboard's persistent outbox; the callback
// acknowledges the write so the client can dequeue it. Retries carry a writeId
// that the idempotency guard below uses to skip already-applied writes.
function doGet(e) {
  var p = e.parameter;

  // Bare URL (no ?action=) → serve the web app HTML
  if (!p.action) {
    return serveDashboard();
  }

  try {
    // Idempotency guard: the dashboard's write outbox retries on timeout, so a
    // write may arrive twice if it executed but its response was lost. Retried
    // requests carry the same writeId — skip ones we've already applied.
    if (p.writeId && CacheService.getScriptCache().get('wid_' + p.writeId)) {
      return respond({ ok: true, deduped: true }, p.callback);
    }

    // Class-management actions — no spreadsheet needed
    switch (p.action) {
      case 'listClasses':
        return respond(actionListClasses(p.includeArchived === 'true'), p.callback);
      case 'inspectSheet':
        return respond(actionInspectSheet(p.sheetId), p.callback);
      // Terms are derived from the sheet here, server-side, rather than accepted
      // from the client. A p.terms pass-through would make the browser the
      // courier for a value the server just computed (inspect returns terms, the
      // page holds them, the page sends them back) with nothing re-checking them
      // against the sheet — which is this bug, reintroduced through its own fix.
      case 'registerClass':
        return respond(actionRegisterClass(p.name, p.sheetId, inspectSheetTerms(p.sheetId).terms), p.callback);
      case 'updateClass':
        return respond(actionUpdateClass(p.classId, JSON.parse(p.updates)), p.callback);
      case 'deleteClass':
        return respond(actionDeleteClass(p.classId), p.callback);
      case 'createClass':
        return respond(actionCreateClass(p.name, p.folderId, p.terms ? JSON.parse(p.terms) : null), p.callback);
      case 'getToken':
        return respond({ token: ScriptApp.getOAuthToken() }, p.callback);
    }

    // Class data actions — require an open spreadsheet
    const ss = openClass(p.classId);
    switch (p.action) {
      case 'getInitialData':
        return respond(buildInitialData(ss, resolveActiveTerm(ss, p.classId)), p.callback);
      case 'getQuarterData':
        return respond({ quarter: p.quarter, data: loadQuarter(ss, p.quarter) }, p.callback);
      case 'getHallPasses':
        return respond({ hallPasses: loadHallPasses(ss) }, p.callback);
      case 'writeAttendance':
        writeAttendance(ss, p.quarter, JSON.parse(p.updates));
        touchActiveTerm(p.classId, p.quarter);   // this term is where the teacher is working now
        return respondOk(p);
      case 'logHallPass':
        logHallPass(ss, JSON.parse(p.pass));
        return respondOk(p);
      case 'addStudent':
        addStudent(ss, p);
        return respondOk(p);
      case 'addStudents':
        addStudents(ss, p);
        return respondOk(p);
      case 'logTardyDismissed':
        logTardyDismissed(ss, p);
        return respondOk(p);
      case 'getTardyDismissed':
        return respond({ tardyDismissed: loadTardyDismissed(ss) }, p.callback);
      case 'getQuarterDates':
        return respond(loadQuarterDates(ss, getClassTermIds(p.classId)), p.callback);
      case 'setQuarterStart':
        setQuarterStart(ss, p.quarter, p.date);
        return respondOk(p);
      case 'previewQuarterEnd':
        return respond(previewQuarterEnd(ss, p.quarter, p.date), p.callback);
      case 'setQuarterEnd':
        // Params arrive as strings, hence === '1'.
        setQuarterEnd(ss, p.quarter, p.date, p.allowDataLoss === '1');
        return respondOk(p);
      case 'setDayException':
        setDayException(ss, p.quarter, parseInt(p.sheetCol, 10), p.label || '');
        return respondOk(p);
      case 'getRoster':
        return respond({ roster: loadRoster(ss) }, p.callback);
      case 'sendStudentReport':
        return respond(sendStudentReport(ss, p), p.callback);
      case 'sendAtRiskSummary':
        return respond(sendAtRiskSummary(ss, p), p.callback);
      case 'sendHallPassSummary':
        return respond(sendHallPassSummary(ss, p), p.callback);
      default:
        return respond({ error: 'Unknown action: ' + p.action }, p.callback);
    }
  } catch (ex) {
    return respond({ error: ex.message }, p.callback);
  }
}

// ── ROUTING HELPERS ───────────────────────────────────────────────────────────

// Serve the dashboard with THIS deployment's own /exec URL baked in, so the Served
// (iPad) build never has to ask for it.
//
// Why it can't be done in the browser: HtmlService sandboxes the page into an iframe on
// a googleusercontent.com origin, so `window.location` is the sandbox URL, not the Web
// App URL. The page genuinely cannot see its own bridge — only the server can, via
// ScriptApp.getService().getUrl(). (The same sandbox origin is why reads/writes still go
// through JSONP here: they are cross-origin even in the Served context.)
//
// Without this, a teacher on the iPad pastes the bridge URL into the connect screen by
// hand — and pastes it AGAIN whenever the sandbox origin rotates and takes localStorage
// with it, which is a known Apps Script behavior.
//
// The dashboard already falls back to DEFAULT_BRIDGE_URL when localStorage is empty, so
// rewriting that one constant is the whole fix. `dashboard.html` itself is untouched and
// still runs from file://, where the constant stays '' and the connect screen asks. Note
// the filename below is the HTML file *inside the Apps Script project* — leave it alone.
function serveDashboard() {
  var html = HtmlService.createHtmlOutputFromFile('dashboard.html').getContent();
  var url  = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  // Only bake in a real deployment URL. getUrl() returns the /dev test URL when the script
  // is run from the editor, and the dashboard can't use that — better to fall through to
  // the connect screen than to hand it a URL that will fail every fetch.
  if (url.slice(-5) === '/exec') {
    html = html.replace(/var DEFAULT_BRIDGE_URL = '[^']*';/,
      'var DEFAULT_BRIDGE_URL = ' + JSON.stringify(url) + ';');
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle('Roll Call!')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function openClass(classId) {
  var reg = getClasses();
  var entry = reg[classId];
  if (!entry) throw new Error('Unknown classId: ' + classId);
  return SpreadsheetApp.openById(entry.sheetId);
}

// JSONP-aware response: wraps JSON in callback(...) when callback param is present.
// This lets dashboard.html load data via <script> tag from a file:// origin.
function respond(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// Success response for mutations. Records the request's writeId (6h TTL — the
// CacheService maximum) so a retried duplicate of this write is skipped by the
// idempotency guard in doGet.
function respondOk(p) {
  if (p.writeId) {
    try { CacheService.getScriptCache().put('wid_' + p.writeId, '1', 21600); } catch (e) {}
  }
  return respond({ ok: true }, p.callback);
}

// ── CLASS MANAGEMENT ACTIONS ──────────────────────────────────────────────────

function actionListClasses(includeArchived) {
  var reg = getClasses();
  var result = [];
  Object.keys(reg).forEach(function (id) {
    var c = reg[id];
    if (!includeArchived && c.archived) return;
    result.push({ id: id, name: c.name, archived: !!c.archived, quarter: c.quarter || null,
                  sheetId: c.sheetId || '', terms: c.terms || null });
  });
  return { classes: result };
}

// The gate for linking an existing sheet, and the only place a linked class's
// terms are derived. Opens the sheet, checks it is one of ours and that it says
// what it is, and either returns { name, terms, version } or throws a message
// the teacher can act on. Both actionInspectSheet (the UI's preview) and the
// registerClass dispatch call this, so verifying a sheet and storing its terms
// are the same act — nothing can store terms that were never checked.
function inspectSheetTerms(sheetId) {
  if (!sheetId) throw new Error('sheetId is required');
  var ss;
  try {
    ss = SpreadsheetApp.openById(sheetId);
  } catch (e) {
    throw new Error('Can\'t open that sheet — check the link and that you have access.');
  }

  var meta = ss.getSheetByName(META_SHEET);
  if (!meta) throw new Error('This does not appear to be a valid Roll Call sheet.');

  var rows = meta.getRange(1, 1, 3, 2).getValues();
  var vals = {};
  rows.forEach(function (r) { vals[String(r[0]).trim()] = r[1]; });

  var version = Number(vals.schemaVersion) || 0;
  if (version > SCHEMA_VERSION) {
    throw new Error('This sheet was made by a newer version of Roll Call — update your bridge.');
  }
  // An older version is fine — accept it. There is nothing to migrate at v1;
  // the marker exists so that v2 has somewhere to land.

  var parsed = null;
  try { parsed = JSON.parse(vals.terms); } catch (e) { parsed = null; }
  // The meta tab is hidden, not immutable — a teacher can unhide and edit it,
  // so what we read here is untrusted input and goes through sanitizeTerms.
  // NOTE: sanitizeTerms returns null for two different reasons — "malformed"
  // and "use the default quarters". In actionCreateClass it means the second;
  // here only the first is reachable (the meta tab always names its terms), so
  // null is invalid, never a cue to fall back to Q1–Q4. Falling back would be
  // the original bug: a sheet silently treated as quarters.
  var terms = sanitizeTerms(parsed);
  if (!terms) throw new Error('This does not appear to be a valid Roll Call sheet.');

  // Verify the sheet is telling the truth: every term it names must be a real
  // tab, and Raw Input must still be there. Raw Input is not merely a tab the
  // bridge reads — every term tab's name columns are live formulas into it, and
  // both ways of losing it fail silently. Deleted: the IFERROR swallows the
  // #REF! and every name goes blank rather than red. Renamed: Sheets rewrites
  // the formulas to follow, so the sheet still looks right, but loadRoster's
  // getSheetByName misses and the class shows no students against a sheet that
  // visibly has them.
  var needed = terms.map(function (t) { return t.id; }).concat([ROSTER_SHEET]);
  for (var i = 0; i < needed.length; i++) {
    if (!ss.getSheetByName(needed[i])) {
      throw new Error('This sheet is either not a Roll Call sheet, or its tab names have been ' +
                      'edited. See the Troubleshooting section of the installation guide.');
    }
  }

  return { name: ss.getName(), terms: terms, version: version };
}

// Read-only preview for the link form. Thin wrapper — the checking lives in
// inspectSheetTerms so it can't drift from what registerClass stores.
function actionInspectSheet(sheetId) {
  var info = inspectSheetTerms(sheetId);
  return { ok: true, name: info.name, terms: info.terms, version: info.version };
}

// Terms arrive already sanitized from both callers — actionCreateClass runs
// sanitizeTerms on what the dashboard sent, and inspectSheetTerms sanitizes what
// it read from the meta tab. No client-supplied value ever reaches this.
function actionRegisterClass(name, sheetId, terms) {
  if (!name)    throw new Error('name is required');
  if (!sheetId) throw new Error('sheetId is required');
  var reg  = getClasses();
  var base = slugify(name);
  var id   = base;
  var n    = 2;
  while (reg[id] && reg[id].sheetId !== sheetId) { id = base + '-' + n++; }
  reg[id] = { name: name, sheetId: sheetId, archived: false };
  if (terms) reg[id].terms = terms;
  saveClasses(reg);
  return { ok: true, classId: id, terms: terms || null };
}

function actionUpdateClass(classId, updates) {
  var reg = getClasses();
  if (!reg[classId]) throw new Error('Unknown classId: ' + classId);
  if (updates.name     !== undefined) reg[classId].name     = updates.name;
  if (updates.archived !== undefined) reg[classId].archived = !!updates.archived;
  if (updates.quarter  !== undefined) reg[classId].quarter  = updates.quarter || null;
  saveClasses(reg);
  return { ok: true };
}

function actionDeleteClass(classId) {
  var reg = getClasses();
  delete reg[classId];
  saveClasses(reg);
  return { ok: true };
}

function actionCreateClass(name, folderId, terms) {
  if (!name) throw new Error('name is required');
  terms = sanitizeTerms(terms); // null → default quarters
  var ssNew = generateClassSpreadsheet(name, terms || DEFAULT_TERMS);
  var file = DriveApp.getFileById(ssNew.getId());
  if (folderId) {
    var folder = DriveApp.getFolderById(folderId);
    file.moveTo(folder);
  }
  var folderInfo = null;
  var parents = file.getParents();
  if (parents.hasNext()) {
    var p = parents.next();
    folderInfo = { name: p.getName(), url: p.getUrl() };
  }
  var result = actionRegisterClass(name, ssNew.getId(), terms);
  return { ok: true, classId: result.classId, sheetId: ssNew.getId(), folder: folderInfo };
}

// ── CLASS SPREADSHEET GENERATOR ───────────────────────────────────────────────
// Builds a class spreadsheet from scratch with everything the bridge reads and
// writes: Q1–Q4 attendance tabs, Raw Input roster, Hall Passes, Tardy /
// Dismissed, and Class Info. Layout contract (see SHEET STRUCTURE constants):
//   Term sheets — row 2 = day-of-week, row 5 = dates (L5 = term start, the
//   rest auto-fill next weekdays via WORKDAY), rows 6+ = students. C/D pull
//   names from Raw Input; E–I count P/T/A/E/D over the date range; J =
//   attendance rate, defined as (P+T+E+D)/(P+T+A+E+D) — i.e. everything except
//   absences counts as attended. Teachers can edit the J-column formula if
//   their school computes the rate differently.
//   The width of the date row IS the term's length — no end date is stored
//   anywhere; it is derived by scanning row 5 for the last real date. Every
//   term is provisioned the same at creation and the teacher sets the real end
//   in Settings → Term Dates, which physically adds or removes date columns.
const LEGACY_LAST_DATE_COL = 56;  // column BD — the fixed width of pre-terms sheets

// A new term spans 90 calendar days. Weekends aren't columns, so that's 64-65
// weekday columns depending on which day of the week the term starts; provision
// the upper bound. The teacher adjusts the real end in Settings → Term Dates.
const TERM_DEFAULT_COLS = 65;

function generateClassSpreadsheet(name, terms) {
  var ss = SpreadsheetApp.create(name);
  var termList = terms || DEFAULT_TERMS;

  termList.forEach(function (t, ti) {
    var sh = ti === 0 ? ss.getSheets()[0].setName(t.id) : ss.insertSheet(t.id);
    buildQuarterSheet(sh, t.label || t.id, TERM_DEFAULT_COLS);
  });
  buildRosterSheet(ss.insertSheet(ROSTER_SHEET));
  buildHallPassSheet(ss.insertSheet(HALL_PASS_SHEET));
  buildTardySheet(ss.insertSheet(TARDY_DISMISSED_SHEET));
  buildClassInfoSheet(ss.insertSheet(CLASS_INFO_SHEET));
  buildMetaSheet(ss.insertSheet(META_SHEET), termList);

  return ss;
}

function buildQuarterSheet(sh, q, nDates) {
  nDates = nDates || (LEGACY_LAST_DATE_COL - COL_DATA_START + 1);
  var lastDateCol = COL_DATA_START + nDates - 1;
  if (sh.getMaxColumns() < lastDateCol + 2) {
    sh.insertColumnsAfter(sh.getMaxColumns(), lastDateCol + 2 - sh.getMaxColumns());
  }
  var lastRow = ROW_STUDENTS + MAX_STUDENTS - 1;

  sh.getRange('A1').setValue(q + ' Attendance').setFontWeight('bold');
  sh.getRange('C4').setValue('Set the term start date in Settings (or type it into L5) — the remaining weekdays fill in automatically.')
    .setFontStyle('italic').setFontColor('#999999');

  // Column headers for the summary block (row 5, C:J — the date row only
  // begins at column L, so these cells are free)
  sh.getRange(ROW_DATE, COL_LAST, 1, 8)
    .setValues([['Last Name', 'First Name', 'P', 'T', 'A', 'E', 'D', 'Att %']])
    .setFontWeight('bold');

  // Day-of-week row (2) and date row (5). L5 is the term start (written by
  // setQuarterStart); the rest chain forward one weekday at a time.
  sh.getRange(ROW_DOW, COL_DATA_START, 1, nDates)
    .setFormulaR1C1('=IF(R5C="","",TEXT(R5C,"ddd"))');
  sh.getRange(ROW_DATE, COL_DATA_START + 1, 1, nDates - 1)
    .setFormulaR1C1('=IF(RC[-1]="","",WORKDAY(RC[-1],1))');
  sh.getRange(ROW_DATE, COL_DATA_START, 1, nDates).setNumberFormat('M/d');

  // Student rows: names pulled from Raw Input (sheet row 6 ↔ roster row 4)
  var n = MAX_STUDENTS;
  sh.getRange(ROW_STUDENTS, COL_LAST, n, 1)
    .setFormulaR1C1('=IFERROR(TRIM(INDEX(SPLIT(\'' + ROSTER_SHEET + '\'!R[-2]C3,","),1,1)),"")');
  sh.getRange(ROW_STUDENTS, COL_FIRST, n, 1)
    .setFormulaR1C1('=IFERROR(TRIM(INDEX(SPLIT(\'' + ROSTER_SHEET + '\'!R[-2]C3,","),1,2)),"")');

  rewriteCountFormulas(sh, nDates);

  sh.setFrozenRows(ROW_DATE);
  sh.setFrozenColumns(COL_FIRST);
  sh.setColumnWidth(COL_LAST, 110);
  sh.setColumnWidth(COL_FIRST, 110);
  for (var c = COL_PRESENT; c <= COL_PCT; c++) sh.setColumnWidth(c, 48);
  for (var d = COL_DATA_START; d <= lastDateCol; d++) sh.setColumnWidth(d, 56);
  sh.getRange(1, 1, lastRow, lastDateCol).setVerticalAlignment('middle');
}

// The P/T/A/E/D counts and the attendance rate, written across the date range
// COL_DATA_START..COL_DATA_START+nDates-1. Shared by the generator and the
// resizer: insertColumnsAfter lands new columns OUTSIDE the baked-in COUNTIF
// range, so every resize must rewrite these or the new days go uncounted.
function rewriteCountFormulas(sh, nDates) {
  var lastDateCol = COL_DATA_START + nDates - 1;
  var n = MAX_STUDENTS;
  var countRange = 'RC' + COL_DATA_START + ':RC' + lastDateCol;
  [['P', COL_PRESENT], ['T', COL_TARDY], ['A', COL_ABSENT], ['E', COL_EVENT], ['D', COL_DISMISSED]]
    .forEach(function (pair) {
      sh.getRange(ROW_STUDENTS, pair[1], n, 1)
        .setFormulaR1C1('=IF(RC' + COL_LAST + '="","",COUNTIF(' + countRange + ',"' + pair[0] + '"))');
    });
  // Attendance rate: everything except absences counts as attended
  sh.getRange(ROW_STUDENTS, COL_PCT, n, 1).setFormulaR1C1(
    '=IF(RC' + COL_LAST + '="","",IF(RC5+RC6+RC7+RC8+RC9=0,"",(RC5+RC6+RC8+RC9)/(RC5+RC6+RC7+RC8+RC9)))'
  );
  sh.getRange(ROW_STUDENTS, COL_PCT, n, 1).setNumberFormat('0%');
}

function buildRosterSheet(sh) {
  sh.getRange(3, 3, 1, 13).setValues([[
    'Full Name', 'Last Name', 'First Name', 'Nickname', 'Student Email',
    'Guardian 1 Name', 'Guardian 1 Email', 'Guardian 2 Name', 'Guardian 2 Email',
    'Counselor Name', 'Counselor Email', 'Graduation Year', 'Notes'
  ]]).setFontWeight('bold');
  sh.getRange('C1').setValue('Enter students as "Last, First" in the Full Name column — Last/First split automatically.')
    .setFontStyle('italic').setFontColor('#999999');
  // Rows 4–33: Last/First split from Full Name (kept as values-if-typed-over)
  sh.getRange(4, 4, MAX_STUDENTS, 1)
    .setFormulaR1C1('=IFERROR(TRIM(INDEX(SPLIT(RC3,","),1,1)),"")');
  sh.getRange(4, 5, MAX_STUDENTS, 1)
    .setFormulaR1C1('=IFERROR(TRIM(INDEX(SPLIT(RC3,","),1,2)),"")');
  sh.setFrozenRows(3);
  sh.setColumnWidth(3, 160);
}

function buildHallPassSheet(sh) {
  sh.getRange(1, 1, 1, 9).setValues([[
    'ID', 'Last Name', 'First Name', 'Date of Pass', 'Pass Type',
    'Check-Out Time', 'Check-In Time', 'Duration', 'Notes'
  ]]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('D2:D').setNumberFormat('M/d/yyyy');
  sh.getRange('F2:G').setNumberFormat('h:mm:ss am/pm');
  sh.setColumnWidth(9, 220);
}

function buildTardySheet(sh) {
  sh.getRange(1, 1, 1, 7).setValues([[
    'ID', 'Last Name', 'First Name', 'Arrival Time', 'Dismissed Time', 'Notes', 'Entry Date'
  ]]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(6, 220);
}

function buildClassInfoSheet(sh) {
  sh.getRange(1, 1, 4, 1)
    .setValues([['Teacher Name'], ['School'], ['Admin Email'], ['Counselor Email']])
    .setFontWeight('bold');
  sh.setColumnWidth(1, 140);
  sh.setColumnWidth(2, 240);
}

// The sheet's identity card: what layout contract it was built to, and which
// tabs are its terms. Read by inspectSheetTerms when linking the sheet back.
//
// Hidden, because this is machine state — teachers are invited to edit their
// sheets, and a visible tab invites deletion. Its own tab rather than a corner
// of Class Info, because Class Info is teacher-facing and read by fixed offset
// (B1:B4 in loadRoster), so an inserted row would shift metadata out from under
// the reader.
function buildMetaSheet(sh, terms) {
  sh.getRange(1, 1, 3, 2).setValues([
    ['schemaVersion', SCHEMA_VERSION],
    ['terms',         JSON.stringify(terms)],
    ['created',       new Date().toISOString()]
  ]);
  sh.getRange(1, 1, 3, 1).setFontWeight('bold');
  sh.getRange('A5').setValue('Roll Call! uses this tab to recognize this spreadsheet. Do not edit or delete it.')
    .setFontStyle('italic').setFontColor('#999999');
  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(2, 320);
  sh.hideSheet();
}

// ── INITIAL DATA LOADER ───────────────────────────────────────────────────────

function buildInitialData(ss, quarter) {
  quarter = quarter || 'Q1';
  var qData = loadQuarter(ss, quarter);
  var todayDay = qData.days[0];
  return {
    activeQuarter: quarter,
    quarters: { [quarter]: qData },
    isTodaySchoolDay: !!(todayDay && todayDay.isToday && !todayDay.isException && todayDay.sheetCol > 0)
  };
}

// Which term is "now", judged from the sheets' date rows.
//
// The LAST term whose date row contains today wins — not the first. This matters because
// term date rows can OVERLAP: a new tab is provisioned with TERM_DEFAULT_COLS columns of
// WORKDAY-chained dates (~90 calendar days), which is longer than a quarter really is, so
// until the teacher sets the real end in Settings an earlier term's row runs past its end
// and into the next term. Once Q2's start date is set, today exists in Q1's row AND Q2's
// row. Returning the first match pinned every class to Q1 forever — the teacher could take
// attendance in Q2 all week and still be dropped back into Q1 on every load. (Setting real
// ends makes this heuristic MORE accurate, since the rows stop overlapping.)
//
// Preferring the last match is safe: dates chain FORWARD from a term's start, so today can
// only appear in a term's row if today >= that term's start. A later term containing today
// therefore means that term has actually begun. Terms with no start date have an empty row
// and match nothing, so they can never win by accident.
function detectActiveQuarter(ss, termIds) {
  var quarters = termIds || DEFAULT_TERMS.map(function (t) { return t.id; });
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var todayTime = today.getTime();
  var todayMatch = null;   // last term whose row contains today
  var lastSeen   = null;   // last term with any past dates — fallback once every term has ended

  for (var qi = 0; qi < quarters.length; qi++) {
    var qName = quarters[qi];
    var sheet = ss.getSheetByName(qName);
    if (!sheet) continue;

    var lastCol = sheet.getLastColumn();
    var numCols = lastCol - COL_DATA_START + 1;
    if (numCols < 1) continue;

    var dateRow = sheet.getRange(ROW_DATE, COL_DATA_START, 1, numCols).getValues()[0];
    var hasPastDates = false;

    for (var c = 0; c < dateRow.length; c++) {
      var dv = dateRow[c];
      if (String(dv).trim().toUpperCase() === 'X') break;
      if (!dv) continue;
      var cd = new Date(dv); cd.setHours(0, 0, 0, 0);
      if (cd.getTime() === todayTime) todayMatch = qName;  // keep scanning — a later term wins
      if (cd < today) hasPastDates = true;
    }
    if (hasPastDates) lastSeen = qName;
  }
  return todayMatch || lastSeen || quarters[0];
}

// The term to open a class on. Two signals can move it FORWARD — the calendar
// (detectActiveQuarter) and the teacher's own usage (lastTerm, set by touchActiveTerm when
// attendance is written) — and we take whichever is later, so neither can drag the class
// backwards. An explicit starting-term override still beats both: that one is a deliberate
// choice made in the Class Manager, and it means "always open here".
function resolveActiveTerm(ss, classId) {
  var ids      = getClassTermIds(classId);
  var entry    = getClasses()[classId] || {};
  var override = entry.quarter;
  if (override && ids.indexOf(override) >= 0) return override;

  var detected = detectActiveQuarter(ss, ids);
  var lastTerm = entry.lastTerm;
  if (!lastTerm || ids.indexOf(lastTerm) < 0) return detected;
  return ids.indexOf(lastTerm) > ids.indexOf(detected) ? lastTerm : detected;
}

// ── ATTENDANCE WRITER ─────────────────────────────────────────────────────────

function writeAttendance(ss, quarterName, updates) {
  const sheet = ss.getSheetByName(quarterName);
  if (!sheet) throw new Error('Sheet not found: ' + quarterName);

  // Group by column so each column is written in a single setValues call
  const byCol = {};
  updates.forEach(function (u) {
    if (!byCol[u.sheetCol]) byCol[u.sheetCol] = [];
    byCol[u.sheetCol].push(u);
  });

  Object.keys(byCol).forEach(function (col) {
    const group = byCol[col].slice().sort(function (a, b) { return a.rowIndex - b.rowIndex; });
    const minRow  = group[0].rowIndex;
    const numRows = group[group.length - 1].rowIndex - minRow + 1;
    const values  = [];
    for (var i = 0; i < numRows; i++) values.push(['']);
    group.forEach(function (u) { values[u.rowIndex - minRow] = [u.code ? u.code.toUpperCase() : '']; });
    sheet.getRange(ROW_STUDENTS + minRow, Number(col), numRows, 1).setValues(values);
  });

}

// ── HALL PASS WRITER ──────────────────────────────────────────────────────────

function logHallPass(ss, pass) {
  const sheet = ss.getSheetByName(HALL_PASS_SHEET);
  if (!sheet) throw new Error('Hall Passes sheet not found');

  const HEADER_ROW = 1;
  const lastCol    = sheet.getLastColumn();
  const headers    = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });

  const col = {
    id:       headers.indexOf('id')             + 1,
    last:     headers.indexOf('last name')      + 1,
    first:    headers.indexOf('first name')     + 1,
    date:     headers.indexOf('date of pass')   + 1,
    type:     headers.indexOf('pass type')      + 1,
    checkout: headers.indexOf('check-out time') + 1,
    checkin:  headers.indexOf('check-in time')  + 1,
    duration: headers.indexOf('duration')       + 1,
    note:     headers.indexOf('notes')          + 1
  };

  const checkOut = new Date(pass.checkOut);
  const checkIn  = new Date(pass.checkIn);
  const mins     = Math.round((checkIn - checkOut) / 60000);
  const newRow   = Math.max(sheet.getLastRow() + 1, HEADER_ROW + 1);

  if (col.id       > 0) sheet.getRange(newRow, col.id      ).setValue(newRow - HEADER_ROW);
  if (col.last     > 0) sheet.getRange(newRow, col.last    ).setValue(pass.last);
  if (col.first    > 0) sheet.getRange(newRow, col.first   ).setValue(pass.first);
  if (col.date     > 0) sheet.getRange(newRow, col.date    ).setValue(new Date(pass.date));
  if (col.type     > 0) sheet.getRange(newRow, col.type    ).setValue(pass.type);
  if (col.checkout > 0) sheet.getRange(newRow, col.checkout).setValue(checkOut);
  if (col.checkin  > 0) sheet.getRange(newRow, col.checkin ).setValue(checkIn);
  if (col.duration > 0) sheet.getRange(newRow, col.duration).setValue(mins);
  if (col.note     > 0) sheet.getRange(newRow, col.note    ).setValue(pass.note || '');
}

// ── TARDY / DISMISSED WRITER ──────────────────────────────────────────────────

function logTardyDismissed(ss, p) {
  var sheet = ss.getSheetByName(TARDY_DISMISSED_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(TARDY_DISMISSED_SHEET);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['ID', 'Last Name', 'First Name', 'Arrival Time', 'Dismissed Time', 'Notes', 'Entry Date']);
  }
  var counter   = sheet.getLastRow();
  var arrival   = p.type === 'tardy'   ? p.time : '';
  var dismissed = p.type === 'dismiss' ? p.time : '';
  var dateStr   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, yyyy');
  sheet.appendRow([counter, p.last, p.first, arrival, dismissed, p.note || '', dateStr]);
}

// ── TARDY / DISMISSED LOADER ────────────────────────────────────────────────

function loadTardyDismissed(ss) {
  var sheet = ss.getSheetByName(TARDY_DISMISSED_SHEET);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  var headers    = data[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var colLast    = headers.indexOf('last name')      >= 0 ? headers.indexOf('last name')      : headers.indexOf('last');
  var colFirst   = headers.indexOf('first name')     >= 0 ? headers.indexOf('first name')     : headers.indexOf('first');
  var colArrival = headers.indexOf('arrival time')   >= 0 ? headers.indexOf('arrival time')   : headers.indexOf('arrival');
  var colDismiss = headers.indexOf('dismissed time') >= 0 ? headers.indexOf('dismissed time') : headers.indexOf('dismissed');
  var colNotes   = headers.indexOf('notes');
  var colDate    = headers.indexOf('entry date')     >= 0 ? headers.indexOf('entry date')     : headers.indexOf('date');
  var records = [];
  for (var r = 1; r < data.length; r++) {
    var row   = data[r];
    var last  = String(colLast  >= 0 ? row[colLast]  : row[1] || '').trim();
    var first = String(colFirst >= 0 ? row[colFirst] : row[2] || '').trim();
    if (!last && !first) continue;
    var arrival = colArrival >= 0 ? fmtTime(row[colArrival]) : '';
    var dismiss = colDismiss >= 0 ? fmtTime(row[colDismiss]) : '';
    var note    = colNotes   >= 0 ? String(row[colNotes]   || '').trim() : '';
    var date    = colDate    >= 0 ? fmtDate(row[colDate])   : '';
    if (arrival) records.push({ last: last, first: first, type: 'tardy',   time: arrival, date: date, note: note });
    if (dismiss) records.push({ last: last, first: first, type: 'dismiss', time: dismiss, date: date, note: note });
  }
  return records.reverse();
}

// ── QUARTER DATE READER / WRITER ─────────────────────────────────────────────

function loadQuarterDates(ss, termIds) {
  var tz = Session.getScriptTimeZone();
  var result = {};
  (termIds || DEFAULT_TERMS.map(function (t) { return t.id; })).forEach(function (q) {
    var sheet = ss.getSheetByName(q);
    if (!sheet) { result[q] = { start: '', end: '' }; return; }
    var n = sheet.getLastColumn() - COL_DATA_START + 1;
    if (n < 1) { result[q] = { start: '', end: '' }; return; }
    // Single row read covers both the start date (first cell) and the end
    // date (scanned below) — avoids a second Sheets-service round trip per term.
    var row = sheet.getRange(ROW_DATE, COL_DATA_START, 1, n).getValues()[0];
    var sv = row[0];
    var ev = termEndDateFromRow(row);
    result[q] = {
      start: sv instanceof Date ? Utilities.formatDate(sv, tz, 'yyyy-MM-dd') : '',
      end:   ev instanceof Date ? Utilities.formatDate(ev, tz, 'yyyy-MM-dd') : ''
    };
  });
  return { quarterDates: result };
}

// Last real date in the term's date row — sheets no longer share a fixed width
// (a generated semester tab is wider than a quarter tab), so scan instead of
// reading a hardcoded end column. An X still terminates the range early.
function termEndDateFromRow(row) {
  var last = null;
  for (var i = 0; i < row.length; i++) {
    if (String(row[i]).trim().toUpperCase() === 'X') break;
    if (row[i] instanceof Date) last = row[i];
  }
  return last;
}

function parseIsoDate(s) {
  var parts = String(s || '').split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

// How many date columns a term running start..end needs.
//
// Mirrors the sheet's date chain exactly: L5 holds the start as typed (even a
// weekend day, if that's what the teacher entered) and every column after it is
// the next WORKDAY. So the count is 1 for the start column plus every weekday
// strictly after the start, through end. Returns 0 when end precedes start.
function countWeekdays(start, end) {
  var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  var e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (e < d) return 0;
  var n = 1;
  while (true) {
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    if (d > e) break;
    n++;
  }
  return n;
}

// How many date columns this term sheet actually has provisioned.
//
// Deliberately NOT getLastColumn(). loadQuarterDates uses that and it's fine
// there — if it over-reports (a legacy template copy, a teacher's stray note in
// a far-right cell) a reader just returns a cosmetically wrong end date. The
// resizer would compute `have` too large and deleteColumns past the real data.
// Same assumption, wildly different blast radius. So scan row 5 for the last
// cell that is genuinely part of the date row: the start value in L5, or one of
// the WORKDAY chain formulas after it. A typed-in note is neither.
function dateColCount(sheet) {
  var maxCol = sheet.getMaxColumns();
  if (maxCol < COL_DATA_START) return 0;
  var n   = maxCol - COL_DATA_START + 1;
  var rng = sheet.getRange(ROW_DATE, COL_DATA_START, 1, n);
  var f   = rng.getFormulas()[0];
  var v   = rng.getValues()[0];
  var last = 0;
  for (var i = 0; i < n; i++) {
    if (String(f[i]).trim() !== '' || v[i] instanceof Date) last = i + 1;
  }
  return last;
}

function setQuarterStart(ss, quarterName, dateStr) {
  var sheet = ss.getSheetByName(quarterName);
  if (!sheet) throw new Error('Sheet not found: ' + quarterName);
  sheet.getRange(ROW_DATE, COL_DATA_START).setValue(parseIsoDate(dateStr));
}

// What shrinking this term to wantCols would destroy. Only P/T/A/E/D count as
// marks: row 6 is both the first student row AND the exception row, so a
// "snow day" label there must not read as attendance data.
function termTrimImpact(sheet, wantCols) {
  var have = dateColCount(sheet);
  var out = { removedCols: 0, markedDays: 0, markedCells: 0, firstRemovedIso: '', lastRemovedIso: '' };
  if (wantCols >= have) return out;

  var firstCol = COL_DATA_START + wantCols;
  var nCols    = have - wantCols;
  out.removedCols = nCols;

  var tz      = Session.getScriptTimeZone();
  var dateRow = sheet.getRange(ROW_DATE, firstCol, 1, nCols).getValues()[0];
  var lastRow = sheet.getLastRow();
  var marks   = lastRow >= ROW_STUDENTS
    ? sheet.getRange(ROW_STUDENTS, firstCol, lastRow - ROW_STUDENTS + 1, nCols).getValues()
    : [];

  for (var c = 0; c < nCols; c++) {
    var inCol = 0;
    for (var r = 0; r < marks.length; r++) {
      if (ATTENDANCE_CODES.indexOf(String(marks[r][c] || '').trim().toUpperCase()) >= 0) inCol++;
    }
    if (!inCol) continue;
    out.markedCells += inCol;
    out.markedDays++;
    var dv = dateRow[c];
    if (dv instanceof Date) {
      var iso = Utilities.formatDate(dv, tz, 'yyyy-MM-dd');
      if (!out.firstRemovedIso) out.firstRemovedIso = iso;
      out.lastRemovedIso = iso;
    }
  }
  return out;
}

// Physically add or remove date columns so the term is wantCols wide.
function resizeTermDates(sheet, wantCols) {
  var have = dateColCount(sheet);
  if (have < 1) throw new Error('This term sheet has no date columns.');
  if (wantCols === have) return;

  if (wantCols > have) {
    var firstNew = COL_DATA_START + have;
    var nNew     = wantCols - have;
    sheet.insertColumnsAfter(firstNew - 1, nNew);
    // A new column arrives EMPTY, which breaks IF(RC[-1]="",…) for every column
    // to its right — writing the formulas back is mandatory, not cosmetic.
    sheet.getRange(ROW_DOW, firstNew, 1, nNew)
      .setFormulaR1C1('=IF(R5C="","",TEXT(R5C,"ddd"))');
    sheet.getRange(ROW_DATE, firstNew, 1, nNew)
      .setFormulaR1C1('=IF(RC[-1]="","",WORKDAY(RC[-1],1))')
      .setNumberFormat('M/d');
    for (var c = firstNew; c < firstNew + nNew; c++) sheet.setColumnWidth(c, 56);
  } else {
    sheet.deleteColumns(COL_DATA_START + wantCols, have - wantCols);
  }
  // Mandatory in both directions: inserted columns land outside the baked-in
  // COUNTIF range and would never be counted.
  rewriteCountFormulas(sheet, wantCols);
}

// READ — what would happen if the teacher set this term's end to endStr.
// This is the real gate on data loss; the guard in setQuarterEnd is a backstop
// (drainOutbox dequeues a write whether or not the bridge threw, so a write's
// error surfaces nowhere).
function previewQuarterEnd(ss, quarterName, endStr) {
  var sheet = ss.getSheetByName(quarterName);
  if (!sheet) throw new Error('Sheet not found: ' + quarterName);
  var start = sheet.getRange(ROW_DATE, COL_DATA_START).getValue();
  if (!(start instanceof Date)) throw new Error('Set the term start date first.');

  var want = countWeekdays(start, parseIsoDate(endStr));
  if (want < 1) throw new Error('The term end must be on or after the term start.');

  var have   = dateColCount(sheet);
  var impact = want < have
    ? termTrimImpact(sheet, want)
    : { removedCols: 0, markedDays: 0, markedCells: 0, firstRemovedIso: '', lastRemovedIso: '' };
  impact.quarter = quarterName;
  impact.have    = have;
  impact.want    = want;
  return impact;
}

// WRITE — resize the term's date row so its last date is endStr.
function setQuarterEnd(ss, quarterName, endStr, allowDataLoss) {
  var sheet = ss.getSheetByName(quarterName);
  if (!sheet) throw new Error('Sheet not found: ' + quarterName);
  var start = sheet.getRange(ROW_DATE, COL_DATA_START).getValue();
  if (!(start instanceof Date)) throw new Error('Set the term start date first.');

  var want = countWeekdays(start, parseIsoDate(endStr));
  if (want < 1) throw new Error('The term end must be on or after the term start.');

  var have = dateColCount(sheet);
  if (want === have) return;
  if (want < have && !allowDataLoss && termTrimImpact(sheet, want).markedCells > 0) {
    throw new Error('Shortening this term would delete recorded attendance.');
  }
  resizeTermDates(sheet, want);
}

// Mark / clear a day as a no-school exception. The marker lives in the
// exception row (row 6 — shared with the first student row by the sheet's
// convention; an exception day's student cells are never read, so this is
// safe). label '' clears the marker, resuming the day.
function setDayException(ss, quarterName, sheetCol, label) {
  var sheet = ss.getSheetByName(quarterName);
  if (!sheet) throw new Error('Sheet not found: ' + quarterName);
  if (!sheetCol || sheetCol < COL_DATA_START) throw new Error('Invalid day column: ' + sheetCol);
  sheet.getRange(ROW_EXCEPTION, sheetCol).setValue(label);
}

// ── QUARTER LOADER ────────────────────────────────────────────────────────────

function loadQuarter(ss, quarterName) {
  const empty = { name: quarterName, days: [], students: [], totalClasses: 0, termStart: '', termEnd: '' };
  const sheet = ss.getSheetByName(quarterName);
  if (!sheet) return empty;

  const lastCol = sheet.getLastColumn();
  const numCols = lastCol - COL_DATA_START + 1;
  if (numCols < 1) return empty;

  const hdr      = sheet.getRange(ROW_DOW, COL_DATA_START, ROW_EXCEPTION - ROW_DOW + 1, numCols).getValues();
  const dowRow   = hdr[0];
  const dateRow  = hdr[ROW_DATE - ROW_DOW];
  const exRow    = hdr[ROW_EXCEPTION - ROW_DOW];

  const today   = new Date(); today.setHours(23, 59, 59, 999);
  const todayMN = new Date(); todayMN.setHours(0, 0, 0, 0);

  var todayColIndex    = -1;
  var todayIsException = false;
  var todayDate        = '';
  var todayDow         = '';
  var totalClasses     = 0;
  const pastValidCols  = [];

  for (var c = 0; c < dateRow.length; c++) {
    const dv = dateRow[c];
    if (String(dv).trim().toUpperCase() === 'X') break;
    if (!dv) continue;

    const cd  = new Date(dv); cd.setHours(0, 0, 0, 0);
    const ex  = String(exRow[c] || '').trim().toLowerCase();
    const isEx = EXCEPTION_MARKERS.some(function (m) { return ex.includes(m); });

    if (cd.getTime() === todayMN.getTime()) {
      todayColIndex    = c;
      todayIsException = isEx;
      todayDate        = fmtDate(dv);
      todayDow         = String(dowRow[c] || '').trim();
      if (!isEx) totalClasses++;
      continue;
    }
    if (cd > today) continue;
    if (!isEx) totalClasses++;
    pastValidCols.push({
      sheetCol: COL_DATA_START + c, colIndex: c,
      dow: String(dowRow[c] || '').trim(), date: fmtDate(dv),
      isoDate: Utilities.formatDate(cd, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      isException: isEx, exceptionLabel: isEx ? String(exRow[c] || '').trim() : ''
    });
  }

  const tz = Session.getScriptTimeZone();
  const todayIso = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // The term's real span. The end is still derived (last real date in row 5) —
  // but the row's width is now the teacher's to set, so it means something.
  const startVal  = dateRow[0];
  const endVal    = termEndDateFromRow(dateRow);
  const termStart = startVal instanceof Date ? Utilities.formatDate(startVal, tz, 'yyyy-MM-dd') : '';
  const termEnd   = endVal   instanceof Date ? Utilities.formatDate(endVal,   tz, 'yyyy-MM-dd') : '';

  const validCols = [];
  if (todayColIndex >= 0) {
    validCols.push({
      sheetCol: COL_DATA_START + todayColIndex, colIndex: todayColIndex,
      dow: todayDow, date: todayDate, isToday: true,
      isoDate: todayIso,
      isException: todayIsException,
      exceptionLabel: todayIsException ? String(exRow[todayColIndex] || '').trim() : ''
    });
  } else {
    validCols.push({
      sheetCol: -1, colIndex: -1, dow: '', date: 'Today', isToday: true,
      isoDate: todayIso,
      isException: true, exceptionLabel: 'No School'
    });
  }
  pastValidCols.slice().reverse().forEach(function (d) { validCols.push(d); });

  const lastRow        = sheet.getLastRow();
  const numStudentRows = Math.min(MAX_STUDENTS, lastRow - ROW_STUDENTS + 1);
  if (numStudentRows < 1) {
    return {
      name: quarterName, days: validCols, students: [], totalClasses: totalClasses,
      termStart: termStart, termEnd: termEnd
    };
  }

  const studentVals = sheet.getRange(ROW_STUDENTS, 1, numStudentRows, lastCol).getValues();
  const students    = [];
  for (var r = 0; r < studentVals.length; r++) {
    const row   = studentVals[r];
    const first = String(row[COL_FIRST - 1] || '').trim();
    const last  = String(row[COL_LAST  - 1] || '').trim();
    if (!first && !last) continue;

    var dismissedCount = Number(row[COL_DISMISSED - 1]) || 0;

    students.push({
      id:         r + 1,
      first:      first,
      last:       last,
      present:    Number(row[COL_PRESENT - 1]) || 0,
      tardy:      Number(row[COL_TARDY   - 1]) || 0,
      absent:     Number(row[COL_ABSENT  - 1]) || 0,
      event:      Number(row[COL_EVENT   - 1]) || 0,
      dismissed:  dismissedCount,
      pct:        row[COL_PCT - 1],
      attendance: validCols.map(function (vc) {
        return vc.sheetCol > 0 ? String(row[vc.sheetCol - 1] || '').trim().toUpperCase() : '';
      })
    });
  }

  return {
    name: quarterName, days: validCols, students: students, totalClasses: totalClasses,
    termStart: termStart, termEnd: termEnd
  };
}

// ── HALL PASSES LOADER ────────────────────────────────────────────────────────

function loadHallPasses(ss) {
  const sheet = ss.getSheetByName(HALL_PASS_SHEET);
  if (!sheet) return [];

  const HEADER_ROW = 1;
  const lastRow    = sheet.getLastRow();
  if (lastRow < HEADER_ROW + 1) return [];

  const data = sheet.getRange(HEADER_ROW, 1, lastRow - HEADER_ROW + 1, sheet.getLastColumn()).getValues();
  if (data.length < 2) return [];

  const headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const col = {
    first:    headers.indexOf('first name'),
    last:     headers.indexOf('last name'),
    date:     headers.indexOf('date of pass'),
    checkout: headers.indexOf('check-out time'),
    checkin:  headers.indexOf('check-in time'),
    type:     headers.indexOf('pass type'),
    duration: headers.indexOf('duration'),
    note:     headers.indexOf('notes')
  };

  const passes = [];
  for (var r = 1; r < data.length; r++) {
    const row   = data[r];
    const first = String(row[col.first] || '').trim();
    const last  = String(row[col.last]  || '').trim();
    if (!first && !last) continue;

    passes.push({
      first:    first,
      last:     last,
      date:     col.date     >= 0 ? fmtDate(row[col.date])           : '',
      checkOut: col.checkout >= 0 ? fmtTime(row[col.checkout])       : '',
      checkIn:  col.checkin  >= 0 ? fmtTime(row[col.checkin])        : '',
      mins:     col.duration >= 0 ? parseDurationMins(row[col.duration]) : null,
      type:     col.type     >= 0 ? String(row[col.type]  || '').trim() : '',
      note:     col.note     >= 0 ? String(row[col.note]  || '').trim() : ''
    });
  }

  return passes.reverse(); // most-recent first
}

// ── ADD STUDENT ───────────────────────────────────────────────────────────────

function addStudent(ss, p) {
  var sheet = ss.getSheetByName('Raw Input');
  if (!sheet) throw new Error('Raw Input sheet not found');
  var colC = sheet.getRange(4, 3, MAX_STUDENTS, 1).getValues();
  var emptyRow = -1;
  for (var i = 0; i < colC.length; i++) {
    if (colC[i][0] === '' || colC[i][0] === null) { emptyRow = 4 + i; break; }
  }
  if (emptyRow === -1) throw new Error('Raw Input sheet is full (' + MAX_STUDENTS + ' students max)');
  sheet.getRange(emptyRow, COL_LAST).setValue(p.last + ', ' + p.first);
}

function addStudents(ss, p) {
  var names = JSON.parse(p.names);  // array of "Last, First" strings
  var sheet = ss.getSheetByName('Raw Input');
  if (!sheet) throw new Error('Raw Input sheet not found');
  var colC = sheet.getRange(4, 3, MAX_STUDENTS, 1).getValues();
  var nextSlot = 0;
  for (var i = 0; i < colC.length; i++) {
    if (colC[i][0] !== '' && colC[i][0] !== null) nextSlot = i + 1;
    else break;
  }
  for (var n = 0; n < names.length; n++) {
    if (nextSlot + n >= MAX_STUDENTS) throw new Error('Raw Input sheet is full (' + MAX_STUDENTS + ' students max)');
    sheet.getRange(4 + nextSlot + n, COL_LAST).setValue(names[n].trim());
  }
}

// ── ROSTER ────────────────────────────────────────────────────────────────────

function loadRoster(ss) {
  var result = { teacher: {}, students: [] };

  // Teacher / school metadata from Class Info sheet (col B, rows 1–4)
  var infoSheet = ss.getSheetByName(CLASS_INFO_SHEET);
  if (infoSheet) {
    var info = infoSheet.getRange(1, 2, 4, 1).getValues();
    result.teacher = {
      name:           String(info[0][0] || '').trim(),
      school:         String(info[1][0] || '').trim(),
      adminEmail:     String(info[2][0] || '').trim(),
      counselorEmail: String(info[3][0] || '').trim()
    };
  }

  // Student rows from Raw Input sheet (C4:O33)
  var rosterSheet = ss.getSheetByName(ROSTER_SHEET);
  if (!rosterSheet) return result;

  var rows = rosterSheet.getRange(4, 3, MAX_STUDENTS, 13).getValues();
  rows.forEach(function(r) {
    var fullName = String(r[RI_FULL_NAME] || '').trim();
    var last     = String(r[RI_LAST]      || '').trim();
    var first    = String(r[RI_FIRST]     || '').trim();

    if (!fullName && !last && !first) return; // skip empty rows

    // Parse Full Name ("Last, First") if separate columns are empty
    if (!last && !first && fullName) {
      var parts = fullName.split(',');
      last  = (parts[0] || '').trim();
      first = (parts[1] || '').trim();
    }

    result.students.push({
      fullName:       fullName,
      last:           last,
      first:          first,
      nickname:       String(r[RI_NICKNAME]        || '').trim(),
      studentEmail:   String(r[RI_STUDENT_EMAIL]   || '').trim(),
      guardian1Name:  String(r[RI_GUARDIAN1_NAME]  || '').trim(),
      guardian1Email: String(r[RI_GUARDIAN1_EMAIL] || '').trim(),
      guardian2Name:  String(r[RI_GUARDIAN2_NAME]  || '').trim(),
      guardian2Email: String(r[RI_GUARDIAN2_EMAIL] || '').trim(),
      counselorName:  String(r[RI_COUNSELOR_NAME]  || '').trim(),
      counselorEmail: String(r[RI_COUNSELOR_EMAIL] || '').trim(),
      gradYear:       String(r[RI_GRAD_YEAR]        || '').trim(),
      notes:          String(r[RI_NOTES]            || '').trim()
    });
  });

  return result;
}

// ── REPORTS ───────────────────────────────────────────────────────────────────

function getClassName(classId) {
  if (!classId) return '';
  var reg = getClasses();
  return (reg[classId] && reg[classId].name) ? reg[classId].name : classId;
}

function checkAtRiskBridge(student, p) {
  var mode     = p.thresholdMode || 'pct';
  var critPct  = parseFloat(p.critPct  || 90);
  var warnPct  = parseFloat(p.warnPct  || 95);
  var critDays = parseFloat(p.critDays || 5);
  var warnDays = parseFloat(p.warnDays || 3);
  var pctNum   = student.pct ? Math.round(parseFloat(student.pct) * 100) : null;
  if (mode === 'days') {
    var isCritD = student.absent >= critDays;
    return { isCrit: isCritD, isWarn: !isCritD && student.absent >= warnDays, pctNum: pctNum };
  }
  if (pctNum === null) return { isCrit: false, isWarn: false, pctNum: null };
  var isCritP = pctNum < critPct;
  return { isCrit: isCritP, isWarn: !isCritP && pctNum < warnPct, pctNum: pctNum };
}

// Consecutive absences that trip the at-risk flag in the emails this bridge sends.
// KEEP IN SYNC with CONSEC_ABSENCE_LIMIT in dashboard.html — the dashboard runs the same
// check for its badges, and if the two disagree a student flagged in the UI will not be
// flagged in the email (or vice versa).
var CONSEC_ABSENCE_LIMIT = 3;

function hasConsecAbsencesBridge(attendance) {
  var count = 0;
  for (var i = 1; i < attendance.length; i++) {
    if (attendance[i] === 'A') { if (++count >= CONSEC_ABSENCE_LIMIT) return true; }
    else count = 0;
  }
  return false;
}

function buildEmailShell(subject, bodyHtml, teacher, className, quarter) {
  var tz       = Session.getScriptTimeZone();
  var dateStr  = Utilities.formatDate(new Date(), tz, 'MMM d, yyyy');
  var subtitle = [className, quarter, dateStr].filter(function (x) { return x; }).join(' · ');
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:20px;background:#f0f2f5;font-family:Arial,Helvetica,sans-serif">' +
    '<table style="width:100%;max-width:600px;border-collapse:collapse;margin:0 auto">' +
    '<tr><td style="background:#0d2137;padding:18px 24px;border-radius:8px 8px 0 0">' +
      '<div style="color:#fff;font-size:18px;font-weight:700">&#128203; Roll Call!</div>' +
      '<div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:4px">' + subtitle + '</div>' +
    '</td></tr>' +
    '<tr><td style="background:#fff;padding:24px;border-left:1px solid #e0e4ea;border-right:1px solid #e0e4ea">' +
      bodyHtml +
    '</td></tr>' +
    '<tr><td style="background:#f5f6fa;padding:12px 24px;font-size:11px;color:#8a9bb0;border:1px solid #e0e4ea;border-top:none;border-radius:0 0 8px 8px">' +
      'Generated by Roll Call!' +
      (teacher.name  ? ' &middot; ' + teacher.name  : '') +
      (teacher.school ? ' &middot; ' + teacher.school : '') +
    '</td></tr>' +
    '</table></body></html>';
}

function buildStudentEmailBody(student, qData, atRisk, rosterRec, passes, tdRecords) {
  var pctNum    = atRisk.pctNum;
  var rateColor = pctNum === null ? '#666' : atRisk.isCrit ? '#e74c3c' : atRisk.isWarn ? '#e67e22' : '#27ae60';
  var html = '';

  html += '<h2 style="margin:0 0 16px;font-size:18px;color:#1a1a2e">' + student.last + ', ' + student.first + '</h2>';

  html += '<div style="text-align:center;padding:12px 0 16px">' +
    '<div style="font-size:48px;font-weight:800;color:' + rateColor + '">' + (pctNum !== null ? pctNum + '%' : '&mdash;') + '</div>' +
    '<div style="font-size:12px;color:#8a9bb0;margin-top:4px">Attendance Rate</div>' +
  '</div>';

  if (atRisk.isCrit) {
    html += '<div style="background:#fdeaea;border:1px solid #f0a0a0;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;font-weight:700;color:#c0392b">&#9888; At Risk &mdash; ' + (pctNum !== null ? pctNum + '% attendance rate' : student.absent + ' days absent') + '</div>';
  } else if (atRisk.isWarn) {
    html += '<div style="background:#fff3cd;border:1px solid #f5d060;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;font-weight:700;color:#c0700a">&#9888; Attendance Warning &mdash; ' + (pctNum !== null ? pctNum + '% attendance rate' : student.absent + ' days absent') + '</div>';
  } else if (hasConsecAbsencesBridge(student.attendance)) {
    html += '<div style="background:#fff3cd;border:1px solid #f5d060;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;font-weight:700;color:#c0700a">&#9888; ' + CONSEC_ABSENCE_LIMIT + ' or more consecutive absences detected</div>';
  }

  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr>';
  [['Present', student.present, '#27ae60', '#eafaf1'],
   ['Tardy',   student.tardy,   '#e67e22', '#fef5ea'],
   ['Absent',  student.absent,  '#e74c3c', '#fdeaea'],
   ['Event',   student.event,   '#c0392b', '#fdeaea']].forEach(function (cell, idx) {
    if (idx > 0) html += '<td style="width:4px"></td>';
    html += '<td style="text-align:center;padding:12px;background:' + cell[3] + ';border-radius:6px">' +
      '<div style="font-size:22px;font-weight:800;color:' + cell[2] + '">' + cell[1] + '</div>' +
      '<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.5px">' + cell[0] + '</div>' +
    '</td>';
  });
  html += '</tr></table>';

  // Recent attendance calendar (last 15 school days, skipping today)
  var schoolDays = [];
  for (var di = 1; di < qData.days.length && schoolDays.length < 15; di++) {
    var d = qData.days[di];
    if (!d.isException) schoolDays.push({ d: d, code: (student.attendance[di] || '').toUpperCase() });
  }
  if (schoolDays.length) {
    html += '<div style="font-size:10px;font-weight:700;color:#8a9bb0;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px">Recent Attendance</div>';
    html += '<table style="border-collapse:collapse;width:100%;table-layout:fixed"><tr>';
    schoolDays.slice().reverse().forEach(function (entry) {
      var code = entry.code;
      var bg    = code === 'P' ? '#eafaf1' : code === 'T' ? '#fef5ea' : code === 'A' ? '#fdeaea' : code === 'E' ? '#fdeaea' : '#f3f4f6';
      var color = code === 'P' ? '#27ae60' : code === 'T' ? '#e67e22' : code === 'A' ? '#e74c3c' : code === 'E' ? '#c0392b' : '#c0cad5';
      var lbl   = code || '&ndash;';
      var dow   = (entry.d.dow || '').substring(0, 2).toUpperCase();
      var date  = String(entry.d.date || '').replace(/,?\s*\d{4}/, '').trim();
      html += '<td style="text-align:center;padding:2px">' +
        '<div style="font-size:8px;color:#a0aab8">' + dow + '</div>' +
        '<div style="background:' + bg + ';color:' + color + ';font-weight:800;font-size:11px;border-radius:50%;width:26px;height:26px;line-height:26px;text-align:center;margin:2px auto;border:1.5px solid ' + color + '">' + lbl + '</div>' +
        '<div style="font-size:8px;color:#a0aab8">' + date + '</div>' +
      '</td>';
    });
    html += '</tr></table>';
  }

  passes    = passes    || [];
  tdRecords = tdRecords || [];

  if (tdRecords.length) {
    var tardyCnt   = tdRecords.filter(function(r) { return r.type === 'tardy';   }).length;
    var dismissCnt = tdRecords.filter(function(r) { return r.type === 'dismiss'; }).length;
    var tdTh = '<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #e0e4ea;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0;background:#f5f6fa">';
    html += '<div style="margin-top:14px">';
    html += '<div style="font-size:9px;font-weight:700;color:#8a9bb0;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">Tardy &amp; Dismissal History</div>';
    var tdParts = [];
    if (tardyCnt)   tdParts.push('<span style="color:#e67e22;font-weight:700">' + tardyCnt   + ' tardy</span>');
    if (dismissCnt) tdParts.push('<span style="color:#7c3aed;font-weight:700">' + dismissCnt + ' dismissed</span>');
    if (tdParts.length) html += '<div style="font-size:12px;margin-bottom:6px">' + tdParts.join(' &nbsp;&middot;&nbsp; ') + '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>' +
      tdTh + 'Type</th>' + tdTh + 'Date</th>' + tdTh + 'Time</th>' +
      '</tr></thead><tbody>';
    tdRecords.forEach(function(r, idx) {
      var rowBg     = idx % 2 === 0 ? '#fff' : '#fafbfc';
      var typeColor = r.type === 'tardy' ? '#e67e22' : '#7c3aed';
      var typeBg    = r.type === 'tardy' ? '#fef5ea' : '#f3eaff';
      html += '<tr style="background:' + rowBg + '">' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6"><span style="background:' + typeBg + ';color:' + typeColor + ';padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700">' + (r.type === 'tardy' ? 'Tardy' : 'Dismissed') + '</span></td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">' + (r.date || '&mdash;') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">' + r.time + '</td>' +
        '</tr>';
      if (r.note) html += '<tr style="background:' + rowBg + '"><td colspan="3" style="padding:2px 8px 8px 20px;border-bottom:1px solid #f3f4f6;font-size:11px;color:#8090a8;font-style:italic"><span style="font-style:normal;font-weight:700">Note:</span> ' + r.note + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  if (passes.length) {
    var pTh = '<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #e0e4ea;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0;background:#f5f6fa">';
    html += '<div style="margin-top:14px">';
    html += '<div style="font-size:9px;font-weight:700;color:#8a9bb0;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">Hall Pass History</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>' +
      pTh + 'Type</th>' + pTh + 'Date</th>' + pTh + 'Out</th>' + pTh + 'In</th>' + pTh + 'Min</th>' +
      '</tr></thead><tbody>';
    passes.forEach(function(p, idx) {
      var rowBg     = idx % 2 === 0 ? '#fff' : '#fafbfc';
      var typeColor = p.type === 'Bathroom' ? '#5b6fcc' : p.type === 'Nurse' ? '#e74c3c' : '#27ae60';
      var typeBg    = p.type === 'Bathroom' ? '#eef0fb' : p.type === 'Nurse' ? '#fdeaea' : '#eafaf1';
      html += '<tr style="background:' + rowBg + '">' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6"><span style="background:' + typeBg + ';color:' + typeColor + ';padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700">' + p.type + '</span></td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">' + p.date + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">' + p.checkOut + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6">' + (p.checkIn || '&mdash;') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right">' + (p.mins != null ? p.mins : '&mdash;') + '</td>' +
        '</tr>';
      if (p.note) html += '<tr style="background:' + rowBg + '"><td colspan="5" style="padding:2px 8px 8px 20px;border-bottom:1px solid #f3f4f6;font-size:11px;color:#8090a8;font-style:italic"><span style="font-style:normal;font-weight:700">Note:</span> ' + p.note + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  if (rosterRec && (rosterRec.guardian1Name || rosterRec.guardian1Email)) {
    html += '<div style="margin-top:14px;padding:10px;background:#f8f9fb;border-radius:6px;font-size:12px;color:#3a4050">' +
      '<div style="font-weight:700;margin-bottom:6px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Guardian Contact</div>';
    if (rosterRec.guardian1Name) html += '<div>' + rosterRec.guardian1Name + (rosterRec.guardian1Email ? ' &lt;' + rosterRec.guardian1Email + '&gt;' : '') + '</div>';
    if (rosterRec.guardian2Name) html += '<div>' + rosterRec.guardian2Name + (rosterRec.guardian2Email ? ' &lt;' + rosterRec.guardian2Email + '&gt;' : '') + '</div>';
    html += '</div>';
  }

  return html;
}

function sendStudentReport(ss, p) {
  var quarter = p.quarter   || 'Q1';
  var first   = String(p.studentFirst || '').trim();
  var last    = String(p.studentLast  || '').trim();
  var recip   = String(p.recipients   || '').trim();
  if (!first || !last) throw new Error('studentFirst and studentLast are required');
  if (!recip)          throw new Error('recipients is required');

  var qData     = loadQuarter(ss, quarter);
  var roster    = loadRoster(ss);
  var teacher   = roster.teacher || {};
  var className = getClassName(p.classId);

  var student = null;
  for (var i = 0; i < qData.students.length; i++) {
    if (qData.students[i].first.toLowerCase() === first.toLowerCase() &&
        qData.students[i].last.toLowerCase()  === last.toLowerCase()) {
      student = qData.students[i]; break;
    }
  }
  if (!student) throw new Error('Student not found: ' + first + ' ' + last);

  var rosterRec = {};
  for (var j = 0; j < roster.students.length; j++) {
    var rs = roster.students[j];
    if (rs.first.toLowerCase() === first.toLowerCase() &&
        rs.last.toLowerCase()  === last.toLowerCase()) { rosterRec = rs; break; }
  }

  var atRisk    = checkAtRiskBridge(student, p);

  var allPasses = loadHallPasses(ss);
  var studentPasses = allPasses.filter(function(pass) {
    return pass.first.toLowerCase() === first.toLowerCase() &&
           pass.last.toLowerCase()  === last.toLowerCase();
  });

  var allTD = loadTardyDismissed(ss);
  var tdRecords = allTD.filter(function(r) {
    return r.first.toLowerCase() === first.toLowerCase() &&
           r.last.toLowerCase()  === last.toLowerCase();
  });

  var introHtml = (p.introText && p.introText.trim())
    ? '<p style="font-size:14px;color:#2c3e50;line-height:1.6;margin:0 0 16px">' + p.introText.trim().replace(/\n/g, '<br>') + '</p>'
    : '';
  var bodyHtml  = introHtml + buildStudentEmailBody(student, qData, atRisk, rosterRec, studentPasses, tdRecords);
  var subject   = (p.subject && p.subject.trim()) || ('Attendance Report: ' + last + ', ' + first + ' — ' + className + ' ' + quarter);
  var html      = buildEmailShell(subject, bodyHtml, teacher, className, quarter);

  var emails = recip.split(',').map(function (e) { return e.trim(); }).filter(function (e) { return e.length > 0; });
  MailApp.sendEmail({ to: emails.join(','), subject: subject, htmlBody: html, name: teacher.name || 'Roll Call!' });
  return { sent: true, count: emails.length };
}

function sendAtRiskSummary(ss, p) {
  var quarter   = p.quarter || 'Q1';
  var recip     = String(p.recipients || '').trim();
  if (!recip)   throw new Error('recipients is required');

  var qData     = loadQuarter(ss, quarter);
  var roster    = loadRoster(ss);
  var teacher   = roster.teacher || {};
  var className = getClassName(p.classId);

  var atRisk = [];
  qData.students.forEach(function (s) {
    var ar = checkAtRiskBridge(s, p);
    var hasConsec = hasConsecAbsencesBridge(s.attendance);
    if (ar.isCrit || ar.isWarn || hasConsec) atRisk.push({ s: s, isCrit: ar.isCrit, isWarn: ar.isWarn, pctNum: ar.pctNum });
  });

  var _introAR  = (p.introText && p.introText.trim())
    ? '<p style="font-size:14px;color:#2c3e50;line-height:1.6;margin:0 0 16px">' + p.introText.trim().replace(/\n/g, '<br>') + '</p>'
    : '';
  var bodyHtml  = _introAR +
    '<h2 style="margin:0 0 4px;font-size:18px;color:#1a1a2e">At-Risk Attendance Summary</h2>' +
    '<div style="font-size:13px;color:#8a9bb0;margin-bottom:16px">' + className + ' &middot; ' + quarter + ' &middot; ' + atRisk.length + ' student' + (atRisk.length !== 1 ? 's' : '') + '</div>';

  if (!atRisk.length) {
    bodyHtml += '<div style="color:#27ae60;font-size:14px;padding:16px 0">No students are currently at-risk or flagged.</div>';
  } else {
    bodyHtml += '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<thead><tr>' +
      '<th style="text-align:left;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Student</th>' +
      '<th style="text-align:center;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Absent</th>' +
      '<th style="text-align:center;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Rate</th>' +
      '<th style="text-align:center;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Status</th>' +
      '</tr></thead><tbody>';
    atRisk.forEach(function (entry, idx) {
      var s = entry.s;
      var badgeBg    = entry.isCrit ? '#fdeaea' : '#fff3cd';
      var badgeColor = entry.isCrit ? '#c0392b' : '#c0700a';
      var badgeLabel = entry.isCrit ? 'At Risk' : (entry.isWarn ? 'Warning' : CONSEC_ABSENCE_LIMIT + '+ Absent');
      var rowBg      = idx % 2 === 0 ? '#fff' : '#fafbfc';
      bodyHtml += '<tr style="background:' + rowBg + '">' +
        '<td style="padding:8px 10px;border-bottom:1px solid #f3f4f6">' + s.last + ', ' + s.first + '</td>' +
        '<td style="text-align:center;padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#e74c3c;font-weight:700">' + s.absent + '</td>' +
        '<td style="text-align:center;padding:8px 10px;border-bottom:1px solid #f3f4f6;font-weight:700">' + (entry.pctNum !== null ? entry.pctNum + '%' : '&mdash;') + '</td>' +
        '<td style="text-align:center;padding:8px 10px;border-bottom:1px solid #f3f4f6"><span style="background:' + badgeBg + ';color:' + badgeColor + ';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">' + badgeLabel + '</span></td>' +
      '</tr>';
    });
    bodyHtml += '</tbody></table>';
  }

  var subject = (p.subject && p.subject.trim()) || ('At-Risk Attendance: ' + className + ' ' + quarter);
  var html    = buildEmailShell(subject, bodyHtml, teacher, className, quarter);
  var emails  = recip.split(',').map(function (e) { return e.trim(); }).filter(function (e) { return e.length > 0; });
  MailApp.sendEmail({ to: emails.join(','), subject: subject, htmlBody: html, name: teacher.name || 'Roll Call!' });
  return { sent: true, count: emails.length };
}

function sendHallPassSummary(ss, p) {
  var recip = String(p.recipients || '').trim();
  if (!recip) throw new Error('recipients is required');

  var passes    = loadHallPasses(ss);
  var roster    = loadRoster(ss);
  var teacher   = roster.teacher || {};
  var className = getClassName(p.classId);

  var byStudent = {};
  passes.forEach(function (pass) {
    var key = (pass.last + '|' + pass.first).toLowerCase();
    if (!byStudent[key]) byStudent[key] = { name: pass.last + ', ' + pass.first, bath: 0, nurse: 0, quick: 0, other: 0, total: 0, mins: 0 };
    var r    = byStudent[key];
    var type = (pass.type || '').toLowerCase();
    if (type === 'bathroom') r.bath++;
    else if (type === 'nurse') r.nurse++;
    else if (type === 'quick') r.quick++;
    else r.other++;
    r.total++;
    if (pass.mins != null) r.mins += pass.mins;
  });

  var rows = Object.keys(byStudent).map(function (k) { return byStudent[k]; });
  rows.sort(function (a, b) { return b.total - a.total; });

  var _introHP  = (p.introText && p.introText.trim())
    ? '<p style="font-size:14px;color:#2c3e50;line-height:1.6;margin:0 0 16px">' + p.introText.trim().replace(/\n/g, '<br>') + '</p>'
    : '';
  var bodyHtml  = _introHP +
    '<h2 style="margin:0 0 4px;font-size:18px;color:#1a1a2e">Hall Pass Summary</h2>' +
    '<div style="font-size:13px;color:#8a9bb0;margin-bottom:16px">' + className + ' &middot; ' + passes.length + ' total pass' + (passes.length !== 1 ? 'es' : '') + '</div>';

  if (!rows.length) {
    bodyHtml += '<div style="color:#a0aab8;font-size:13px;padding:16px 0">No hall pass records found.</div>';
  } else {
    bodyHtml += '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<thead><tr>' +
      '<th style="text-align:left;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Student</th>' +
      '<th style="text-align:center;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Bath</th>' +
      '<th style="text-align:center;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Nurse</th>' +
      '<th style="text-align:center;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Quick</th>' +
      '<th style="text-align:center;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Total</th>' +
      '<th style="text-align:center;padding:6px 10px;background:#f5f6fa;border-bottom:2px solid #e0e4ea;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8a9bb0">Min Out</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r, idx) {
      var rowBg = idx % 2 === 0 ? '#fff' : '#fafbfc';
      bodyHtml += '<tr style="background:' + rowBg + '">' +
        '<td style="padding:7px 10px;border-bottom:1px solid #f3f4f6">' + r.name + '</td>' +
        '<td style="text-align:center;padding:7px 10px;border-bottom:1px solid #f3f4f6">' + (r.bath  || '&mdash;') + '</td>' +
        '<td style="text-align:center;padding:7px 10px;border-bottom:1px solid #f3f4f6">' + (r.nurse || '&mdash;') + '</td>' +
        '<td style="text-align:center;padding:7px 10px;border-bottom:1px solid #f3f4f6">' + (r.quick || '&mdash;') + '</td>' +
        '<td style="text-align:center;padding:7px 10px;border-bottom:1px solid #f3f4f6;font-weight:700">' + r.total + '</td>' +
        '<td style="text-align:center;padding:7px 10px;border-bottom:1px solid #f3f4f6">' + (r.mins  || '&mdash;') + '</td>' +
      '</tr>';
    });
    bodyHtml += '</tbody></table>';
  }

  var subject = (p.subject && p.subject.trim()) || ('Hall Pass Summary: ' + className);
  var html    = buildEmailShell(subject, bodyHtml, teacher, className, '');
  var emails  = recip.split(',').map(function (e) { return e.trim(); }).filter(function (e) { return e.length > 0; });
  MailApp.sendEmail({ to: emails.join(','), subject: subject, htmlBody: html, name: teacher.name || 'Roll Call!' });
  return { sent: true, count: emails.length };
}

// ── FORMAT HELPERS ────────────────────────────────────────────────────────────

// Duration cells formatted as [h]:mm:ss come back from getValues() as Date objects
// (Apps Script maps fractional-day time values to JS Dates relative to 1899-12-30).
// Plain integer values (written by logHallPass as whole minutes) pass through as-is.
function parseDurationMins(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) {
    return val.getHours() * 60 + val.getMinutes() + Math.round(val.getSeconds() / 60);
  }
  var n = Number(val);
  return isNaN(n) || n === 0 ? null : Math.round(n);
}

function fmtDate(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'MMM d');
  return String(val);
}

// 'h:mm:ss a' = no leading zero, matches the UI's formatTime() output
function fmtTime(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'h:mm:ss a');
  // Normalize legacy strings that may have a leading zero ("09:…" → "9:…")
  return String(val).trim().replace(/^0(\d:)/, '$1');
}

