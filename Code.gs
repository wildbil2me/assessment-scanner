/**
 * Quiz Sheets — Google Apps Script backend (paired with index.html)
 *
 * CENTRAL-BRIDGE MODEL (same shape as the sibling "Roll Call!" app):
 * one deployment of this script serves every class. Each class is its own
 * Google Sheet, generated on demand; the list of classes lives in this
 * teacher's User Properties, so each teacher who deploys the bridge gets a
 * private class list. Requires deployment mode "Execute as: User accessing
 * the web app" so the registry and the sheets belong to the signed-in teacher.
 *
 * SETUP:
 * 1. Create a NEW standalone Apps Script project (script.google.com → New project),
 *    delete the starter code, paste this entire file.
 * 2. Add a second file: File → + → HTML, named "index.html", and paste the entire
 *    contents of index.html into it. This is what serveApp() hands out at the bare
 *    /exec URL. Re-paste it whenever index.html changes — the copies don't sync.
 * 3. Run → setup once, and ACCEPT the authorization prompt.
 * 4. Deploy → New deployment → Web app:
 *      - Execute as: User accessing the web app
 *      - Who has access: Anyone within your organization (or Anyone)
 * 5. Open the /exec URL. That IS the app, already connected to itself — no URL to
 *    paste. "Create New Class" makes a fresh Sheet for you.
 *    (index.html still works opened straight from disk too; there it asks for the
 *    /exec URL on its connect screen.)
 *
 * SCOPES / RE-AUTHORIZATION:
 * Apps Script decides which OAuth scopes to ask for by statically scanning this
 * file, and it asks ONCE — at the moment you authorize. If the code later starts
 * using a service it wasn't using when you granted access, the grant is stale and
 * calls to that service fail at runtime with:
 *   "You do not have permission to call DriveApp.getFileById ..."
 * The web app CANNOT prompt you to fix this, because index.html reaches it via a
 * <script> tag (see the TRANSPORT note below) and a consent screen can't render
 * there. So the grant must be refreshed from the editor: Run → setup, and accept.
 * If no prompt appears, the grant is already current — revoke this project at
 * https://myaccount.google.com/permissions and Run → setup again.
 *
 * Services used, and what each costs you:
 *   SpreadsheetApp    — always (creating/reading/writing class Sheets)
 *   PropertiesService — always (the class registry)
 *   CacheService      — always (the writeId replay guard)
 *   HtmlService       — always (serving index.html); costs no scope
 *   ScriptApp         — always (serveApp reads this deployment's own URL); no new scope
 *   DriveApp          — ONLY when creating a class into a chosen folder. Everything
 *                       else avoids it deliberately, so a narrow grant still works.
 *
 * Per-class Sheet layout:
 *   Tab 1  "student-info" — the class roster:
 *     Row 1: ID | Name (Last, First) | Last Name | First Name
 *     Row 2+: one student per row. C/D auto-split from B.
 *   Every later tab is one quiz:
 *     Row 1: QUIZ SHEETS | <createdISO> | <numQuestions> | <choicesPerQ> | <pointsPerQ>
 *     Row 2: KEY      |  (blank)     | (blank) | <total pts> | (blank) | Q1 key | Q2 key | ...
 *     Row 3: Timestamp | Student | ID | Score | Percent | Q1 | Q2 | ...
 *     Row 4+: one scored row per student response
 */

// ── QUIZ TAB LAYOUT ─────────────────────────────────────────────────────────
var MARKER = 'QUIZ SHEETS';
var META_ROW = 1;
var KEY_ROW = 2;
var HEADER_ROW = 3;
var FIRST_DATA_ROW = 4;
var FIRST_Q_COL = 6; // column F

// ── STUDENT-INFO (ROSTER) TAB LAYOUT ────────────────────────────────────────
var STUDENT_INFO_SHEET = 'student-info';
var SI_ID    = 1;  // column A — student ID
var SI_NAME  = 2;  // column B — "Last, First"
var SI_LAST  = 3;  // column C — last name  (formula: split of B)
var SI_FIRST = 4;  // column D — first name (formula: split of B)
var SI_HEADER_ROW = 1;
var SI_FIRST_DATA_ROW = 2;
var MAX_STUDENTS = 300;

// ── WEB APP ENTRY POINTS ────────────────────────────────────────────────────
//
// TRANSPORT: JSONP over GET, exactly like the sibling app's bridge — and for the
// same reason. This web app is deployed "Execute as: User accessing the web app",
// which means Google MUST identify the caller, so anonymous access is not on
// offer and every request has to carry the user's Google session. A cross-origin
// fetch() from a file:// page carries no such session: Google 302s it to the
// login screen, the login screen sends no CORS headers, and the browser reports
// a bare "Failed to fetch". A <script> tag is not subject to CORS and does send
// the session cookie, so it sails through. That is why reads AND writes are both
// GETs with a ?callback= here.
//
// Consequence: array params (key, answers, students) arrive as JSON *strings*,
// hence parseArrayParam below. Writes carry a writeId so a retry of a write that
// actually landed — but whose response was lost — is not applied twice.

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

// Mutating actions. Only these get the writeId dedupe treatment; caching a read
// would just serve stale data.
var WRITE_ACTIONS = {
  createClass: 1, registerClass: 1, updateClass: 1, deleteClass: 1,
  createQuiz: 1, submit: 1, updateKey: 1, deleteQuiz: 1, addStudents: 1
};

function handle(e) {
  var req = {};
  var k;
  if (e && e.parameter) { for (k in e.parameter) req[k] = e.parameter[k]; }
  // A JSON POST body still works (handy for curl / future callers); it wins over
  // query params of the same name.
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (k in body) req[k] = body[k];
    } catch (err) {
      return respond({ ok: false, error: 'Could not parse request JSON: ' + err }, req.callback);
    }
  }
  var cb = req.callback;

  // Bare URL with no ?action= — someone opened the /exec link in a browser, so
  // serve them the app itself. Health-check callers want ?action=ping, which
  // still answers with JSON.
  if (!req.action) return serveApp();

  try {
    // Replay guard: the offline queue retries writes, so a write may arrive twice
    // if it executed but its response was lost. Retries carry the same writeId —
    // return the original result rather than applying it again.
    if (req.writeId && WRITE_ACTIONS[req.action]) {
      var seen = cacheGet_('wid_' + req.writeId);
      if (seen) return respond(JSON.parse(seen), cb);
    }

    var result = dispatch_(req);

    if (req.writeId && WRITE_ACTIONS[req.action]) {
      cachePut_('wid_' + req.writeId, JSON.stringify(result));
    }
    return respond(result, cb);
  } catch (err) {
    return respond({ ok: false, error: String(err && err.message ? err.message : err) }, cb);
  }
}

function dispatch_(req) {
  // Class-management actions — no spreadsheet needed
  switch (req.action) {
    case 'ping':          return { ok: true, pong: true, version: 2,
                                   email: safeEmail(), classCount: Object.keys(getClasses()).length };
    case 'listClasses':   return listClasses(req.includeArchived === true || req.includeArchived === 'true');
    case 'createClass':   return createClass(req);
    case 'registerClass': return registerClass(req);
    case 'inspectSheet':  return inspectSheet(req);
    case 'updateClass':   return updateClass(req);
    case 'deleteClass':   return deleteClass(req);
    case 'getToken':      return { ok: true, token: ScriptApp.getOAuthToken() };
  }

  // Everything below is class-scoped. Check the action is real BEFORE opening a
  // spreadsheet, so a typo reports the typo instead of "No class selected".
  if (!CLASS_ACTIONS[req.action]) {
    return { ok: false, error: 'Unknown action: ' + req.action };
  }

  var ss = openClass(req.classId);
  switch (req.action) {
    case 'createQuiz':  return createQuiz(ss, req);
    case 'listQuizzes': return listQuizzes(ss);
    case 'submit':      return submit(ss, req);
    case 'getResults':  return getResults(ss, req);
    case 'updateKey':   return updateKey(ss, req);
    case 'deleteQuiz':  return deleteQuiz(ss, req);
    case 'addStudents': return addStudents(ss, req);
    case 'getRoster':   return getRoster(ss);
    case 'getGradebook': return getGradebook(ss, req);
  }
}

var CLASS_ACTIONS = {
  createQuiz: 1, listQuizzes: 1, submit: 1, getResults: 1,
  updateKey: 1, deleteQuiz: 1, addStudents: 1, getRoster: 1,
  getGradebook: 1
};

/**
 * Serve index.html with THIS deployment's own /exec URL baked in, so a teacher on
 * a phone or an iPad opens one link and is already connected — no pasting a URL
 * into the connect screen, and no getting index.html onto the device at all.
 *
 * Why the URL must be injected server-side: HtmlService sandboxes the page into an
 * iframe on a googleusercontent.com origin, so the page's window.location is the
 * sandbox URL, not this web app's. It genuinely cannot see its own bridge — only
 * the server can, via ScriptApp.getService().getUrl(). (That same sandbox origin
 * is also why the Served build still talks JSONP: it is cross-origin to the
 * bridge even when the bridge is what served it.)
 *
 * index.html is untouched by this and still runs from file://, where
 * DEFAULT_BRIDGE_URL stays '' and the connect screen asks as usual.
 *
 * NOTE: the filename below is the HTML file *inside the Apps Script project* —
 * paste index.html in as a second file named "index.html" (File → + → HTML).
 * Its contents must be re-pasted whenever index.html changes here; the two copies
 * do not sync themselves.
 */
function serveApp() {
  var html = HtmlService.createHtmlOutputFromFile('index.html').getContent();
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  // Only bake in a real deployment URL. getUrl() returns the /dev test URL when the
  // script is run from the editor, and the app can't use that — better to fall
  // through to the connect screen than to hand it a URL that fails every call.
  if (url.slice(-5) === '/exec') {
    html = html.replace(/const DEFAULT_BRIDGE_URL = '[^']*';/,
      'const DEFAULT_BRIDGE_URL = ' + JSON.stringify(url) + ';');
  }
  // Tell the page it is the Served build, so it can drop the camera mode that
  // this sandbox refuses to permit. Unconditional — unlike the URL above, this is
  // true even when serving from the /dev test URL.
  html = html.replace(/const SERVED_BUILD = false;/, 'const SERVED_BUILD = true;');
  return HtmlService.createHtmlOutput(html)
    .setTitle('Quiz Sheets')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * JSONP-aware response: wraps JSON in callback(...) when a callback param is
 * present. This is what lets index.html talk to the bridge from a file:// origin
 * against an auth-gated deployment (see the transport note above).
 */
function respond(data, callback) {
  var body = JSON.stringify(data);
  if (callback) {
    // Only ever emit a callback name we know is a plain identifier — the value
    // is echoed into executable JS, so anything else would be an injection.
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
      return ContentService.createTextOutput('{"ok":false,"error":"Bad callback name"}')
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(callback + '(' + body + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/** Array params arrive JSON-encoded over GET; accept a real array too. */
function parseArrayParam(v) {
  if (v === null || v === undefined || v === '') return [];
  if (Object.prototype.toString.call(v) === '[object Array]') return v;
  try {
    var a = JSON.parse(v);
    return Object.prototype.toString.call(a) === '[object Array]' ? a : [];
  } catch (e) { return []; }
}

// CacheService is best-effort — never let a cache hiccup fail a real write.
function cacheGet_(k) { try { return CacheService.getScriptCache().get(k); } catch (e) { return null; } }
function cachePut_(k, v) { try { CacheService.getScriptCache().put(k, v, 21600); } catch (e) {} }

function safeEmail() {
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

/**
 * One-time helper: Run → setup from the editor after pasting the code. It
 * triggers the authorization prompt and logs your remaining deploy steps
 * (View → Executions / Logs).
 */
function setup() {
  var n = Object.keys(getClasses()).length;
  Logger.log('Quiz Sheets bridge setup check');
  Logger.log('───────────────────────────');
  Logger.log('Authorization: OK (granted by running this).');
  Logger.log('Classes registered for %s: %s', safeEmail() || 'this account', String(n));
  Logger.log('');
  Logger.log('Next: Deploy → New deployment → Web app.');
  Logger.log('  Execute as: User accessing the web app | Access: your org (or Anyone).');
  Logger.log('  Copy the /exec URL into the Quiz Sheets connect screen.');
}

// ── CLASS REGISTRY ──────────────────────────────────────────────────────────
// Stored in User Properties so each teacher has a private class list.

function getClasses() {
  var raw = PropertiesService.getUserProperties().getProperty('classes');
  return raw ? JSON.parse(raw) : {};
}

function saveClasses(reg) {
  PropertiesService.getUserProperties().setProperty('classes', JSON.stringify(reg));
}

function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class';
}

function openClass(classId) {
  if (!classId) throw new Error('No class selected (missing classId).');
  var reg = getClasses();
  var entry = reg[classId];
  if (!entry) throw new Error('Unknown class: ' + classId);
  return SpreadsheetApp.openById(entry.sheetId);
}

function listClasses(includeArchived) {
  var reg = getClasses();
  var out = [];
  Object.keys(reg).forEach(function (id) {
    var c = reg[id];
    if (!includeArchived && c.archived) return;
    var url = '';
    try { url = SpreadsheetApp.openById(c.sheetId).getUrl(); } catch (e) { url = ''; }
    out.push({ id: id, name: c.name, archived: !!c.archived, sheetId: c.sheetId || '', sheetUrl: url });
  });
  return { ok: true, classes: out };
}

// Register a classId → sheet mapping. Shared by createClass and registerClass.
function registerClassEntry(name, sheetId) {
  if (!name)    throw new Error('name is required');
  if (!sheetId) throw new Error('sheetId is required');
  var reg  = getClasses();
  var base = slugify(name);
  var id   = base, n = 2;
  while (reg[id] && reg[id].sheetId !== sheetId) { id = base + '-' + n++; }
  reg[id] = { name: name, sheetId: sheetId, archived: false };
  saveClasses(reg);
  return id;
}

function createClass(req) {
  var name = String(req.name || '').trim();
  if (!name) throw new Error('name is required');
  var ss = generateClassSpreadsheet(name);

  // Drive is touched ONLY when a folder was actually asked for. SpreadsheetApp
  // .create() needs no Drive grant by itself, and a new Sheet lands in My Drive
  // regardless — so confirming that fact via DriveApp.getParents() would make
  // EVERY class creation demand a full Drive scope to buy nothing but a nicer
  // message. That cost belongs only to the optional folder feature. (See the
  // SCOPES note at the top of this file.)
  var folderInfo = null;
  if (req.folderId) {
    var folder = DriveApp.getFolderById(String(req.folderId).trim());
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    folderInfo = { name: folder.getName(), url: folder.getUrl() };
  }

  var id = registerClassEntry(name, ss.getId());
  return { ok: true, classId: id, name: name, sheetId: ss.getId(), sheetUrl: ss.getUrl(), folder: folderInfo };
}

// Link an existing Sheet as a class. If it has no student-info tab yet, one is
// added, so a plain empty Sheet can be adopted too.
function registerClass(req) {
  var name    = String(req.name || '').trim();
  var sheetId = extractSheetId(req.sheetId || req.url || '');
  if (!name)    throw new Error('name is required');
  if (!sheetId) throw new Error('A Sheet ID or URL is required');
  var ss;
  try { ss = SpreadsheetApp.openById(sheetId); }
  catch (e) { throw new Error("Can't open that Sheet — check the link and that you have access."); }
  if (!ss.getSheetByName(STUDENT_INFO_SHEET)) {
    buildStudentInfoSheet(ss.insertSheet(STUDENT_INFO_SHEET, 0));
  }
  var id = registerClassEntry(name, ss.getId());
  return { ok: true, classId: id, name: name, sheetId: ss.getId(), sheetUrl: ss.getUrl() };
}

// Read-only preview for the "add existing sheet" form.
function inspectSheet(req) {
  var sheetId = extractSheetId(req.sheetId || req.url || '');
  if (!sheetId) throw new Error('A Sheet ID or URL is required');
  var ss;
  try { ss = SpreadsheetApp.openById(sheetId); }
  catch (e) { throw new Error("Can't open that Sheet — check the link and that you have access."); }
  var quizzes = 0;
  ss.getSheets().forEach(function (sh) { if (isQuizSheet(sh)) quizzes++; });
  return {
    ok: true, name: ss.getName(), sheetId: ss.getId(), sheetUrl: ss.getUrl(),
    hasRoster: !!ss.getSheetByName(STUDENT_INFO_SHEET), quizzes: quizzes
  };
}

function updateClass(req) {
  var reg = getClasses();
  var c = reg[req.classId];
  if (!c) throw new Error('Unknown class: ' + req.classId);
  if (req.name     !== undefined) c.name     = String(req.name).trim() || c.name;
  if (req.archived !== undefined) c.archived = (req.archived === true || req.archived === 'true');
  saveClasses(reg);
  return { ok: true };
}

// Removes the class from THIS teacher's registry only. The Google Sheet is left
// untouched in Drive and can be re-linked later with "Add existing sheet".
function deleteClass(req) {
  var reg = getClasses();
  delete reg[req.classId];
  saveClasses(reg);
  return { ok: true };
}

function extractSheetId(s) {
  s = String(s || '').trim();
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || s.match(/^([a-zA-Z0-9_-]{20,})$/);
  return m ? m[1] : '';
}

// ── CLASS SPREADSHEET GENERATOR ─────────────────────────────────────────────

function generateClassSpreadsheet(name) {
  var ss = SpreadsheetApp.create(name);
  // The blank spreadsheet ships with one sheet ("Sheet1") — repurpose it as the
  // roster so student-info is always tab 1.
  buildStudentInfoSheet(ss.getSheets()[0].setName(STUDENT_INFO_SHEET));
  return ss;
}

function buildStudentInfoSheet(sh) {
  sh.getRange(SI_HEADER_ROW, 1, 1, 4)
    .setValues([['ID', 'Name (Last, First)', 'Last Name', 'First Name']])
    .setFontWeight('bold').setBackground('#e8f0fe');

  sh.getRange('B' + (SI_FIRST_DATA_ROW - 1))
    .setNote('Enter each student as "Last, First" in this column — Last/First split automatically into C/D.');

  // C/D auto-split from the "Last, First" name in B (values typed over the
  // formula still win, same as the sibling app's roster).
  var n = MAX_STUDENTS;
  sh.getRange(SI_FIRST_DATA_ROW, SI_LAST, n, 1)
    .setFormulaR1C1('=IFERROR(TRIM(INDEX(SPLIT(RC' + SI_NAME + ',","),1,1)),"")');
  sh.getRange(SI_FIRST_DATA_ROW, SI_FIRST, n, 1)
    .setFormulaR1C1('=IFERROR(TRIM(INDEX(SPLIT(RC' + SI_NAME + ',","),1,2)),"")');

  sh.setFrozenRows(SI_HEADER_ROW);
  sh.setColumnWidth(SI_ID, 110);
  sh.setColumnWidth(SI_NAME, 200);
  sh.setColumnWidth(SI_LAST, 140);
  sh.setColumnWidth(SI_FIRST, 140);
  return sh;
}

// ── ROSTER (student-info) ───────────────────────────────────────────────────

function getRoster(ss) {
  var sh = ss.getSheetByName(STUDENT_INFO_SHEET);
  if (!sh) return { ok: true, students: [] };
  var lastRow = sh.getLastRow();
  if (lastRow < SI_FIRST_DATA_ROW) return { ok: true, students: [] };
  var rows = sh.getRange(SI_FIRST_DATA_ROW, 1, lastRow - SI_HEADER_ROW, 4).getValues();
  var students = [];
  rows.forEach(function (r) {
    var id    = String(r[SI_ID - 1]    || '').trim();
    var name  = String(r[SI_NAME - 1]  || '').trim();
    var last  = String(r[SI_LAST - 1]  || '').trim();
    var first = String(r[SI_FIRST - 1] || '').trim();
    if (!id && !name && !last && !first) return;
    if ((!last && !first) && name) {
      var parts = name.split(',');
      last  = (parts[0] || '').trim();
      first = (parts[1] || '').trim();
    }
    students.push({ id: id, name: name, last: last, first: first });
  });
  return { ok: true, students: students };
}

// Batch import. req.students is a JSON array of { id, last, first }. Appends
// after the last filled roster row; column A gets the ID, column B gets
// "Last, First" (C/D auto-split via their formulas).
function addStudents(ss, req) {
  var students = parseArrayParam(req.students);
  if (!students.length) throw new Error('No students to add');

  var sh = ss.getSheetByName(STUDENT_INFO_SHEET);
  if (!sh) sh = buildStudentInfoSheet(ss.insertSheet(STUDENT_INFO_SHEET, 0));

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var nameCol = sh.getRange(SI_FIRST_DATA_ROW, SI_NAME, MAX_STUDENTS, 1).getValues();
    var nextSlot = 0;
    for (var i = 0; i < nameCol.length; i++) {
      if (nameCol[i][0] !== '' && nameCol[i][0] !== null) nextSlot = i + 1; else break;
    }
    if (nextSlot + students.length > MAX_STUDENTS) {
      throw new Error('That would exceed the ' + MAX_STUDENTS + '-student limit for this roster.');
    }
    var startRow = SI_FIRST_DATA_ROW + nextSlot;
    var ids   = [];
    var names = [];
    students.forEach(function (s) {
      var last  = String(s.last  || '').trim();
      var first = String(s.first || '').trim();
      var name  = first ? (last + ', ' + first) : last;
      ids.push([String(s.id || '').trim()]);
      names.push([name]);
    });
    sh.getRange(startRow, SI_ID,   ids.length,   1).setValues(ids);
    sh.getRange(startRow, SI_NAME, names.length, 1).setValues(names);
    return { ok: true, added: students.length };
  } finally {
    lock.releaseLock();
  }
}

// ── QUIZ HELPERS ────────────────────────────────────────────────────────────

function sanitizeTabName(name) {
  var clean = String(name || '').replace(/[\[\]\*\/\\\?:]/g, ' ').trim().slice(0, 80);
  // never let a quiz collide with the reserved roster tab name
  if (clean.toLowerCase() === STUDENT_INFO_SHEET) clean = clean + ' quiz';
  return clean || 'Quiz';
}

function uniqueTabName(ss, base) {
  var name = base, i = 2;
  while (ss.getSheetByName(name)) { name = base + ' (' + i + ')'; i++; }
  return name;
}

function isQuizSheet(sheet) {
  try {
    if (sheet.getName() === STUDENT_INFO_SHEET) return false;
    return sheet.getRange(META_ROW, 1).getValue() === MARKER;
  } catch (err) { return false; }
}

function getQuizSheet(ss, quizName) {
  var sheet = ss.getSheetByName(quizName);
  if (!sheet || !isQuizSheet(sheet)) throw new Error('Quiz tab not found: "' + quizName + '"');
  return sheet;
}

function quizMeta(sheet) {
  var meta = sheet.getRange(META_ROW, 1, 1, 5).getValues()[0];
  var n = Number(meta[2]) || 0;
  var key = [];
  if (n > 0) {
    key = sheet.getRange(KEY_ROW, FIRST_Q_COL, 1, n).getValues()[0].map(String);
  }
  return {
    name: sheet.getName(),
    gid: sheet.getSheetId(),
    created: String(meta[1]),
    numQuestions: n,
    choicesPerQ: Number(meta[3]) || 5,
    pointsPerQ: Number(meta[4]) || 1,
    key: key,
    responses: Math.max(0, sheet.getLastRow() - HEADER_ROW)
  };
}

/** Exact-match scoring; blank key entries are unscored (0 pts possible). */
function scoreAnswers(answers, key, pointsPerQ) {
  var earned = 0, possible = 0;
  for (var i = 0; i < key.length; i++) {
    var k = String(key[i] || '').toUpperCase().trim();
    if (!k) continue;
    possible += pointsPerQ;
    var a = String(answers[i] || '').toUpperCase().trim();
    if (a === k) earned += pointsPerQ;
  }
  return { earned: earned, possible: possible, percent: possible ? Math.round(1000 * earned / possible) / 10 : 0 };
}

// ── QUIZ ACTIONS ────────────────────────────────────────────────────────────

function createQuiz(ss, req) {
  var n = Number(req.numQuestions);
  if (!n || n < 1 || n > 200) throw new Error('numQuestions must be 1-200');
  var choices = Math.min(Math.max(Number(req.choicesPerQ) || 5, 2), 10);
  var pointsPerQ = Number(req.pointsPerQ) || 1;
  var key = parseArrayParam(req.key).map(function (k) { return String(k || '').toUpperCase().trim(); });
  while (key.length < n) key.push('');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var tabName = uniqueTabName(ss, sanitizeTabName(req.name));
    var sheet = ss.insertSheet(tabName);

    sheet.getRange(META_ROW, 1, 1, 5).setValues([[MARKER, new Date().toISOString(), n, choices, pointsPerQ]]);

    var totalPts = key.filter(String).length * pointsPerQ;
    var keyRow = ['KEY', '', '', totalPts, ''].concat(key.slice(0, n));
    sheet.getRange(KEY_ROW, 1, 1, keyRow.length).setValues([keyRow]);

    var header = ['Timestamp', 'Student', 'ID', 'Score', 'Percent'];
    for (var i = 1; i <= n; i++) header.push('Q' + i);
    header.push('Image'); // trailing Drive fileId of the scanned sheet (submit fills it)
    sheet.getRange(HEADER_ROW, 1, 1, header.length).setValues([header]).setFontWeight('bold');

    sheet.setFrozenRows(HEADER_ROW);
    sheet.setFrozenColumns(3);
    sheet.getRange(KEY_ROW, 1, 1, keyRow.length).setFontWeight('bold').setBackground('#e8f0fe');
    sheet.getRange(META_ROW, 1, 1, 5).setFontColor('#999999').setFontSize(8);
    sheet.setColumnWidth(1, 150);
    for (var c = FIRST_Q_COL; c < FIRST_Q_COL + n; c++) sheet.setColumnWidth(c, 36);

    return { ok: true, quiz: quizMeta(sheet) };
  } finally {
    lock.releaseLock();
  }
}

function listQuizzes(ss) {
  var quizzes = [];
  ss.getSheets().forEach(function (sheet) {
    if (isQuizSheet(sheet)) quizzes.push(quizMeta(sheet));
  });
  return { ok: true, quizzes: quizzes };
}

function submit(ss, req) {
  var sheet = getQuizSheet(ss, req.quiz);
  var meta = quizMeta(sheet);
  var answers = parseArrayParam(req.answers).map(function (a) { return String(a || '').toUpperCase().trim(); });
  while (answers.length < meta.numQuestions) answers.push('');
  answers = answers.slice(0, meta.numQuestions);

  var s = scoreAnswers(answers, meta.key, meta.pointsPerQ);
  var row = [
    req.timestamp ? new Date(req.timestamp) : new Date(),
    String(req.student || ''),
    String(req.studentId || ''),
    s.earned,
    s.percent / 100
  ].concat(answers);
  // A trailing "Image" column, one past the answer columns, holds the Drive
  // fileId of the scanned sheet photo (empty for manual entries). It sits AFTER
  // the answers so markWrongAnswers' per-question highlighting is untouched, and
  // getResults reads it back for the review/override screen. Only appended when
  // present so pre-image sheets keep their exact width.
  if (req.imageId) row.push(String(req.imageId));

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var r = sheet.getLastRow() + 1;
    if (r < FIRST_DATA_ROW) r = FIRST_DATA_ROW;
    sheet.getRange(r, 1, 1, row.length).setValues([row]);
    sheet.getRange(r, 5).setNumberFormat('0.0%');
    markWrongAnswers(sheet, r, answers, meta.key);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, score: s.earned, possible: s.possible, percent: s.percent };
}

/** Light red background on incorrect answers so the tab reads at a glance. */
function markWrongAnswers(sheet, row, answers, key) {
  var colors = [];
  for (var i = 0; i < key.length; i++) {
    var k = String(key[i] || '').toUpperCase().trim();
    var a = String(answers[i] || '').toUpperCase().trim();
    colors.push(!k ? null : (a === k ? null : '#fce8e6'));
  }
  sheet.getRange(row, FIRST_Q_COL, 1, key.length).setBackgrounds([colors]);
}

function getResults(ss, req) {
  var sheet = getQuizSheet(ss, req.quiz);
  var meta = quizMeta(sheet);
  var lastRow = sheet.getLastRow();
  var rows = [];
  if (lastRow >= FIRST_DATA_ROW) {
    var n = meta.numQuestions;
    // Answers are columns 6..(5+n); the optional trailing "Image" column (Drive
    // fileId) is one past that. Clamp the read to the sheet's real width so tabs
    // that never stored an image — still 5+n columns wide — aren't read out of
    // bounds, and slice answers explicitly so the image id never leaks into them.
    var width = Math.min(6 + n, sheet.getMaxColumns());
    var values = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - HEADER_ROW, width).getValues();
    rows = values.filter(function (v) { return v[0]; }).map(function (v) {
      return {
        timestamp: v[0] instanceof Date ? v[0].toISOString() : String(v[0]),
        student: String(v[1]),
        studentId: String(v[2]),
        score: Number(v[3]),
        percent: Math.round(Number(v[4]) * 1000) / 10,
        answers: v.slice(5, 5 + n).map(String),
        imageId: String(v[5 + n] || '')
      };
    });
  }
  return { ok: true, quiz: meta, rows: rows };
}

// ── GRADEBOOK ───────────────────────────────────────────────────────────────
//
// The whole class in one call: the roster crossed with every quiz. The client's
// scores grid needs this as a single JSONP round trip — asking it to call
// getResults once per quiz would reopen this spreadsheet N times, and the page
// would get slower with every quiz the teacher ever gives.
//
// Only columns A–E of each quiz tab are read (timestamp/name/id/score/percent);
// the per-question answers are getResults' job and would multiply the payload
// by numQuestions for nothing.
//
// req.limit (optional) keeps only the N most recent quizzes.
function getGradebook(ss, req) {
  var roster = getRoster(ss).students;

  var quizSheets = ss.getSheets().filter(isQuizSheet);
  var quizzes = quizSheets.map(function (sheet) {
    var meta = sheet.getRange(META_ROW, 1, 1, 5).getValues()[0];
    var n = Number(meta[2]) || 0;
    var pts = Number(meta[4]) || 1;
    return {
      sheet: sheet,
      name: sheet.getName(),
      gid: sheet.getSheetId(),
      created: String(meta[1]),
      numQuestions: n,
      pointsPerQ: pts,
      possible: keyPossible(sheet, n, pts)
    };
  });

  // Newest first, so "recent" means recent regardless of tab order. Tabs with an
  // unparseable created stamp sort last rather than poisoning the comparison.
  quizzes.sort(function (a, b) {
    var ta = Date.parse(a.created), tb = Date.parse(b.created);
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });

  var limit = Number(req && req.limit) || 0;
  var total = quizzes.length;
  if (limit > 0 && quizzes.length > limit) quizzes = quizzes.slice(0, limit);

  // studentId → { qi → best row }. Ids are compared as trimmed strings because
  // the roster stores them as text and a scan may arrive numeric.
  var byId = {};
  var unmatched = [];
  quizzes.forEach(function (q, qi) {
    var lastRow = q.sheet.getLastRow();
    if (lastRow < FIRST_DATA_ROW) return;
    var values = q.sheet.getRange(FIRST_DATA_ROW, 1, lastRow - HEADER_ROW, 5).getValues();
    values.forEach(function (v) {
      if (!v[0]) return;
      var sid = String(v[2] || '').trim();
      var entry = {
        ts: v[0] instanceof Date ? v[0].getTime() : Date.parse(String(v[0])) || 0,
        student: String(v[1] || ''),
        score: Number(v[3]) || 0,
        percent: Math.round(Number(v[4]) * 1000) / 10
      };
      if (!sid) { unmatched.push({ quiz: q.name, student: entry.student, percent: entry.percent }); return; }
      if (!byId[sid]) byId[sid] = {};
      // A rescan of the same paper appends a new row rather than replacing the
      // old one, so the newest timestamp is the one that counts.
      var prev = byId[sid][qi];
      if (!prev || entry.ts >= prev.ts) byId[sid][qi] = entry;
    });
  });

  var rosterIds = {};
  roster.forEach(function (s) { if (s.id) rosterIds[String(s.id).trim()] = true; });

  var students = roster.map(function (s) {
    var sid = String(s.id || '').trim();
    var got = byId[sid] || {};
    var scores = quizzes.map(function (q, qi) {
      var e = got[qi];
      if (!e) return null;           // null = never took it; distinct from a real 0
      return { percent: e.percent, score: e.score, possible: q.possible };
    });
    var taken = scores.filter(function (x) { return x !== null; });
    var avg = taken.length
      ? Math.round((taken.reduce(function (t, x) { return t + x.percent; }, 0) / taken.length) * 10) / 10
      : null;
    return { id: s.id, name: s.name, last: s.last, first: s.first, scores: scores, avg: avg, taken: taken.length };
  });

  // Scans whose ID matches nobody on the roster are reported, not silently
  // dropped — a mis-bubbled ID should be visible to the teacher.
  quizzes.forEach(function (q, qi) {
    Object.keys(byId).forEach(function (sid) {
      if (rosterIds[sid]) return;
      var e = byId[sid][qi];
      if (e) unmatched.push({ quiz: q.name, studentId: sid, student: e.student, percent: e.percent });
    });
  });

  return {
    ok: true,
    quizzes: quizzes.map(function (q) {
      return { name: q.name, gid: q.gid, created: q.created,
               numQuestions: q.numQuestions, pointsPerQ: q.pointsPerQ, possible: q.possible };
    }),
    students: students,
    unmatched: unmatched,
    totalQuizzes: total
  };
}

/** Total points a quiz is out of — blank key entries are unscored, as in scoreAnswers. */
function keyPossible(sheet, numQuestions, pointsPerQ) {
  if (!numQuestions) return 0;
  var key = sheet.getRange(KEY_ROW, FIRST_Q_COL, 1, numQuestions).getValues()[0];
  var possible = 0;
  key.forEach(function (k) { if (String(k || '').trim()) possible += pointsPerQ; });
  return possible;
}

/** Replace the answer key and rescore every existing response row. */
function updateKey(ss, req) {
  var sheet = getQuizSheet(ss, req.quiz);
  var meta = quizMeta(sheet);
  var key = parseArrayParam(req.key).map(function (k) { return String(k || '').toUpperCase().trim(); });
  while (key.length < meta.numQuestions) key.push('');
  key = key.slice(0, meta.numQuestions);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sheet.getRange(KEY_ROW, FIRST_Q_COL, 1, meta.numQuestions).setValues([key]);
    sheet.getRange(KEY_ROW, 4).setValue(key.filter(String).length * meta.pointsPerQ);

    var lastRow = sheet.getLastRow();
    if (lastRow >= FIRST_DATA_ROW) {
      var numRows = lastRow - HEADER_ROW;
      var answersRange = sheet.getRange(FIRST_DATA_ROW, FIRST_Q_COL, numRows, meta.numQuestions);
      var all = answersRange.getValues();
      for (var i = 0; i < all.length; i++) {
        var answers = all[i].map(String);
        var s = scoreAnswers(answers, key, meta.pointsPerQ);
        sheet.getRange(FIRST_DATA_ROW + i, 4, 1, 2).setValues([[s.earned, s.percent / 100]]);
        markWrongAnswers(sheet, FIRST_DATA_ROW + i, answers, key);
      }
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, quiz: quizMeta(sheet), rescored: Math.max(0, sheet.getLastRow() - HEADER_ROW) };
}

function deleteQuiz(ss, req) {
  var sheet = getQuizSheet(ss, req.quiz);
  ss.deleteSheet(sheet);
  return { ok: true };
}
