/**
 * Headless harness for Code.gs: mocks the Apps Script services just enough to
 * drive the real bridge code and assert the sheet layout it produces.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODE_GS = join(ROOT, 'Code.gs');

// The URL the mocked deployment reports as its own. serveApp() bakes this into
// the HTML it serves.
const EXEC_URL = 'https://script.google.com/macros/s/AKfycbxTEST/exec';

let failures = 0, checks = 0;
function ok(cond, label) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); }
  else { failures++; console.log('  ✗ ' + label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, label + '  (got ' + JSON.stringify(actual) + ')');
}

// ── Apps Script mocks ────────────────────────────────────────────────────────
const A1 = /^([A-Z]+)(\d+)$/;
function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  _each(fn) {
    for (let r = 0; r < this.numRows; r++)
      for (let c = 0; c < this.numCols; c++) fn(this.row + r, this.col + c, r, c);
  }
  setValues(vals) {
    this._each((r, c, i, j) => this.sheet._set(r, c, { v: vals[i][j], f: null }));
    return this;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numCols; c++) {
        const cell = this.sheet._get(this.row + r, this.col + c);
        row.push(cell ? (cell.v ?? '') : '');
      }
      out.push(row);
    }
    return out;
  }
  setValue(v) { this.sheet._set(this.row, this.col, { v, f: null }); return this; }
  getValue() { const c = this.sheet._get(this.row, this.col); return c ? (c.v ?? '') : ''; }
  setFormulaR1C1(f) { this._each((r, c) => this.sheet._set(r, c, { v: '', f })); return this; }
  getFormulas() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = [];
      for (let c = 0; c < this.numCols; c++) {
        const cell = this.sheet._get(this.row + r, this.col + c);
        row.push(cell && cell.f ? cell.f : '');
      }
      out.push(row);
    }
    return out;
  }
  // formatting no-ops — chainable
  setFontWeight() { return this; } setBackground() { return this; } setBackgrounds() { return this; }
  setFontColor() { return this; } setFontSize() { return this; } setNumberFormat() { return this; }
  setNote(n) { this.sheet._notes.push(n); return this; }
  setVerticalAlignment() { return this; }
}

let gid = 100;
class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this._notes = []; this._gid = gid++; this.widths = {}; }
  _key(r, c) { return r + ',' + c; }
  _set(r, c, cell) { this.cells.set(this._key(r, c), cell); }
  _get(r, c) { return this.cells.get(this._key(r, c)); }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getSheetId() { return this._gid; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = A1.exec(a.trim());
      if (!m) throw new Error('mock: unsupported A1 range ' + a);
      return new Range(this, +m[2], colToNum(m[1]), 1, 1);
    }
    return new Range(this, a, b, c ?? 1, d ?? 1);
  }
  // Google Sheets counts a formula as content even when it evaluates to "" —
  // mirror that, since it's what getRoster actually reads against.
  getLastRow() {
    let max = 0;
    for (const [k, cell] of this.cells) {
      const r = +k.split(',')[0];
      const has = (cell.v !== '' && cell.v !== null && cell.v !== undefined) || cell.f;
      if (has && r > max) max = r;
    }
    return max;
  }
  getLastColumn() {
    let max = 0;
    for (const [k, cell] of this.cells) {
      const c = +k.split(',')[1];
      const has = (cell.v !== '' && cell.v !== null && cell.v !== undefined) || cell.f;
      if (has && c > max) max = c;
    }
    return max;
  }
  getMaxColumns() { return 26; }
  setFrozenRows() { return this; } setFrozenColumns() { return this; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
}

class Spreadsheet {
  constructor(name) { this.name = name; this.id = 'SS_' + Math.random().toString(36).slice(2, 10); this.sheets = [new Sheet('Sheet1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getName() { return this.name; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(name, pos) {
    const s = new Sheet(name);
    if (typeof pos === 'number') this.sheets.splice(pos, 0, s); else this.sheets.push(s);
    return s;
  }
  deleteSheet(sh) { this.sheets = this.sheets.filter(s => s !== sh); }
}

const DB = new Map();     // sheetId -> Spreadsheet
const PROPS = new Map();  // userProperties

const sandbox = {
  console,
  SpreadsheetApp: {
    create(name) { const ss = new Spreadsheet(name); DB.set(ss.getId(), ss); return ss; },
    openById(id) { const ss = DB.get(id); if (!ss) throw new Error('not found: ' + id); return ss; },
  },
  PropertiesService: {
    getUserProperties: () => ({
      getProperty: k => (PROPS.has(k) ? PROPS.get(k) : null),
      setProperty: (k, v) => PROPS.set(k, v),
    }),
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'teacher@school.edu' }) },
  ContentService: {
    MimeType: { JSON: 'json', JAVASCRIPT: 'javascript' },
    createTextOutput: s => ({
      _s: s, _mime: null,
      setMimeType(m) { this._mime = m; return this; },
      getContent: () => s,
      getMimeType() { return this._mime; },
    }),
  },
  CacheService: (() => {
    const c = new Map();
    return { getScriptCache: () => ({ get: k => (c.has(k) ? c.get(k) : null), put: (k, v) => c.set(k, v) }) };
  })(),
  // Drive is gated behind a flag so a test can simulate the real-world case of a
  // grant that never included the Drive scope (the error a teacher actually hit).
  DriveApp: {
    _denied: false,
    _guard() {
      if (this._denied) {
        throw new Error('You do not have permission to call DriveApp.getFileById. ' +
                        'Required permissions: (https://www.googleapis.com/auth/drive.readonly ' +
                        '|| https://www.googleapis.com/auth/drive)');
      }
    },
    getFileById(id) { this._guard(); return { moveTo() {}, getId: () => id }; },
    getFolderById(id) {
      this._guard();
      return { getName: () => 'Folder ' + id, getUrl: () => 'https://drive.google.com/drive/folders/' + id };
    },
  },
  Logger: { log: () => {} },
  ScriptApp: {
    getOAuthToken: () => 'tok',
    // serveApp() asks the deployment for its own URL. _url is swapped in 8d to
    // prove the /dev URL is refused.
    _url: EXEC_URL,
    getService() { const u = this._url; return { getUrl: () => u }; },
  },
  // createHtmlOutputFromFile reads the copy of index.html living INSIDE the Apps
  // Script project. On disk that copy is the real index.html, which is what makes
  // 8d a genuine check that serveApp's regex still matches the live file.
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createHtmlOutputFromFile: name => ({ getContent: () => fs.readFileSync(join(ROOT, name), 'utf8') }),
    createHtmlOutput: html => ({
      _html: html, _title: '', _xFrame: '',
      setTitle(t) { this._title = t; return this; },
      setXFrameOptionsMode(m) { this._xFrame = m; return this; },
      getContent() { return this._html; },
    }),
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(CODE_GS, 'utf8'), sandbox);

// call the bridge the way index.html does: a JSON POST body
const call = req => JSON.parse(sandbox.handle({ postData: { contents: JSON.stringify(req) } }).getContent());

// ── 1. create a class ────────────────────────────────────────────────────────
console.log('\n1. createClass → new Sheet with student-info as tab 1');
const created = call({ action: 'createClass', name: 'Period 3 — Biology' });
ok(created.ok, 'createClass returns ok');
eq(created.classId, 'period-3-biology', 'classId is a slug of the name');
const ss = DB.get(created.sheetId);
eq(ss.getSheets().length, 1, 'new class Sheet has exactly one tab');
eq(ss.getSheets()[0].getName(), 'student-info', 'tab 1 is named student-info');
ok(!ss.getSheetByName('Sheet1'), 'the default Sheet1 was repurposed, not left behind');

const si = ss.getSheetByName('student-info');
eq(si.getRange(1, 1).getValue(), 'ID', 'A1 header = ID');
eq(si.getRange(1, 2).getValue(), 'Name (Last, First)', 'B1 header = Name (Last, First)');
eq(si.getRange(1, 3).getValue(), 'Last Name', 'C1 header = Last Name');
eq(si.getRange(1, 4).getValue(), 'First Name', 'D1 header = First Name');
ok(/SPLIT\(RC2/.test(si.getRange(2, 3).getFormulas()[0][0]), 'C2 splits column B for the last name');
ok(/SPLIT\(RC2/.test(si.getRange(2, 4).getFormulas()[0][0]), 'D2 splits column B for the first name');
ok(si.getRange(2, 3).getFormulas()[0][0].includes(',1,1'), 'C takes the 1st split field (last)');
ok(si.getRange(2, 4).getFormulas()[0][0].includes(',1,2'), 'D takes the 2nd split field (first)');

// ── 2. registry ──────────────────────────────────────────────────────────────
console.log('\n2. listClasses');
const listed = call({ action: 'listClasses' });
eq(listed.classes.length, 1, 'one class registered');
eq(listed.classes[0].name, 'Period 3 — Biology', 'name round-trips');
ok(listed.classes[0].sheetUrl.includes('/spreadsheets/d/'), 'sheetUrl points at the Sheet');

// ── 3. import students ───────────────────────────────────────────────────────
console.log('\n3. addStudents → ID in A, "Last, First" in B');
const imp = call({ action: 'addStudents', classId: created.classId, students: [
  { id: '10432', last: 'Smith', first: 'Jane' },
  { id: '10433', last: 'Doe',   first: 'John' },
]});
eq(imp.added, 2, 'reports 2 added');
eq(si.getRange(2, 1).getValue(), '10432', 'A2 = first student ID');
eq(si.getRange(2, 2).getValue(), 'Smith, Jane', 'B2 = "Last, First"');
eq(si.getRange(3, 1).getValue(), '10433', 'A3 = second student ID');
eq(si.getRange(3, 2).getValue(), 'Doe, John', 'B3 = "Last, First"');

console.log('\n3b. a second import appends after the existing rows');
call({ action: 'addStudents', classId: created.classId, students: [{ id: '10434', last: 'Ng', first: 'Ada' }] });
eq(si.getRange(4, 1).getValue(), '10434', 'A4 = appended student ID (no overwrite)');
eq(si.getRange(2, 2).getValue(), 'Smith, Jane', 'B2 still intact after the append');

// ── 4. roster read-back ──────────────────────────────────────────────────────
console.log('\n4. getRoster');
const roster = call({ action: 'getRoster', classId: created.classId });
eq(roster.students.length, 3, 'reads back 3 students (blank formula rows skipped)');
eq(roster.students[0].id, '10432', 'student 1 id');
eq(roster.students[0].last, 'Smith', 'student 1 last name');
eq(roster.students[0].first, 'Jane', 'student 1 first name');
eq(roster.students[2].last, 'Ng', 'student 3 last name');

// ── 5. quizzes are subsequent tabs ───────────────────────────────────────────
console.log('\n5. createQuiz → a new tab AFTER student-info');
const quiz = call({ action: 'createQuiz', classId: created.classId, name: 'Ch. 5 Vocab', numQuestions: 3, choicesPerQ: 4, key: ['A', 'B', 'C'] });
ok(quiz.ok, 'createQuiz ok');
eq(ss.getSheets().length, 2, 'Sheet now has 2 tabs');
eq(ss.getSheets()[0].getName(), 'student-info', 'student-info is still tab 1');
eq(ss.getSheets()[1].getName(), 'Ch. 5 Vocab', 'the quiz is tab 2');

console.log('\n5b. listQuizzes excludes the roster tab');
const quizzes = call({ action: 'listQuizzes', classId: created.classId });
eq(quizzes.quizzes.length, 1, 'exactly 1 quiz listed');
eq(quizzes.quizzes[0].name, 'Ch. 5 Vocab', 'student-info is not reported as a quiz');

console.log('\n5c. a quiz may not squat on the reserved roster tab name');
call({ action: 'createQuiz', classId: created.classId, name: 'student-info', numQuestions: 1, key: ['A'] });
eq(ss.getSheets()[0].getName(), 'student-info', 'the real roster tab survives');
ok(ss.getSheets().some(s => s.getName() === 'student-info quiz'), 'the quiz got renamed out of the way');
eq(call({ action: 'getRoster', classId: created.classId }).students.length, 3, 'roster still readable afterwards');

// ── 6. grading still works, scoped to the class ──────────────────────────────
console.log('\n6. submit + getResults');
const sub = call({ action: 'submit', classId: created.classId, quiz: 'Ch. 5 Vocab', student: 'Smith, Jane', studentId: '10432', answers: ['A', 'B', 'X'] });
eq(sub.score, 2, 'scores 2 of 3');
eq(sub.possible, 3, '3 points possible');
const res = call({ action: 'getResults', classId: created.classId, quiz: 'Ch. 5 Vocab' });
eq(res.rows.length, 1, 'one response row');
eq(res.rows[0].studentId, '10432', 'response carries the student ID');

// ── 7. class isolation + errors ──────────────────────────────────────────────
console.log('\n7. second class is isolated');
const b = call({ action: 'createClass', name: 'Period 4 — Chemistry' });
eq(call({ action: 'listQuizzes', classId: b.classId }).quizzes.length, 0, 'new class starts with no quizzes');
eq(call({ action: 'getRoster', classId: b.classId }).students.length, 0, 'new class starts with an empty roster');
eq(call({ action: 'listClasses' }).classes.length, 2, 'both classes registered');
eq(DB.get(b.sheetId).getSheets()[0].getName(), 'student-info', 'second class also gets student-info as tab 1');

console.log('\n7b. a missing/unknown class is a clean error, not a crash');
eq(call({ action: 'listQuizzes' }).ok, false, 'no classId → ok:false');
ok(/No class selected/.test(call({ action: 'listQuizzes' }).error), 'no classId → actionable message');
ok(/Unknown class/.test(call({ action: 'listQuizzes', classId: 'nope' }).error), 'bad classId → actionable message');

console.log('\n7c. deleteClass unregisters without touching the Sheet');
call({ action: 'deleteClass', classId: b.classId });
eq(call({ action: 'listClasses' }).classes.length, 1, 'class removed from the registry');
ok(DB.has(b.sheetId), 'the Google Sheet itself still exists in Drive');

// ── 8. JSONP transport ───────────────────────────────────────────────────────
// The bridge is deployed "Execute as: User accessing the web app", so index.html
// must reach it by <script> tag, not fetch. That means GET + ?callback=, and
// every param arriving as a string.
console.log('\n8. JSONP over GET (the transport index.html actually uses)');

function callJsonp(params, cbName) {
  const p = {};
  Object.keys(params).forEach(k => {
    const v = params[k];
    p[k] = (typeof v === 'object') ? JSON.stringify(v) : String(v);
  });
  p.callback = cbName || 'cb1';
  const out = sandbox.handle({ parameter: p });
  return { text: out.getContent(), mime: out.getMimeType() };
}
function unwrap(res, cbName) {
  const m = new RegExp('^' + (cbName || 'cb1') + '\\(([\\s\\S]*)\\)$').exec(res.text);
  if (!m) throw new Error('not JSONP-wrapped: ' + res.text);
  return JSON.parse(m[1]);
}

const jp = callJsonp({ action: 'listQuizzes', classId: created.classId });
eq(jp.mime, 'javascript', 'JSONP response is served as JavaScript, not JSON');
ok(/^cb1\(/.test(jp.text) && /\)$/.test(jp.text), 'response is wrapped in the callback');
eq(unwrap(jp).quizzes.length, 2, 'listQuizzes works over GET');

console.log('\n8b. array params survive the trip as JSON strings');
const gq = unwrap(callJsonp({ action: 'createQuiz', classId: created.classId, name: 'GET Quiz',
                              numQuestions: 3, choicesPerQ: 5, key: ['C', 'A', 'B'] }));
ok(gq.ok, 'createQuiz over GET ok');
eq(gq.quiz.key.join(''), 'CAB', 'key array round-trips through the query string');
const gs = unwrap(callJsonp({ action: 'submit', classId: created.classId, quiz: 'GET Quiz',
                              student: 'Ng, Ada', studentId: '10434', answers: ['C', 'A', 'X'] }));
eq(gs.score, 2, 'answers array round-trips and scores over GET');
const ga = unwrap(callJsonp({ action: 'addStudents', classId: created.classId,
                              students: [{ id: '10435', last: 'Roy', first: 'Kim' }] }));
eq(ga.added, 1, 'students array round-trips over GET');
eq(unwrap(callJsonp({ action: 'getRoster', classId: created.classId })).students.length, 4, 'roster now has 4');

console.log('\n8c. writeId makes a retried write idempotent');
const before = unwrap(callJsonp({ action: 'getResults', classId: created.classId, quiz: 'GET Quiz' })).rows.length;
const w = { action: 'submit', classId: created.classId, quiz: 'GET Quiz', student: 'Doe, John',
            studentId: '10433', answers: ['C', 'A', 'B'], writeId: 'W-retry-1' };
const first  = unwrap(callJsonp(w));
const second = unwrap(callJsonp(w));   // the retry the offline queue would send
const after  = unwrap(callJsonp({ action: 'getResults', classId: created.classId, quiz: 'GET Quiz' })).rows.length;
eq(after - before, 1, 'a duplicate writeId adds exactly ONE row, not two');
eq(second.score, first.score, 'the retry replays the original result rather than rescoring');
const w2 = Object.assign({}, w, { writeId: 'W-retry-2' });
unwrap(callJsonp(w2));
eq(unwrap(callJsonp({ action: 'getResults', classId: created.classId, quiz: 'GET Quiz' })).rows.length - after, 1,
   'a genuinely new writeId still writes');

console.log('\n8d. bare /exec URL serves the app, with this deployment\'s URL baked in');
const served = sandbox.handle({ parameter: {} });
const servedHtml = served.getContent();
// Serving HTML at all is what proves the bare URL returns before dispatch_ can
// complain about the classId it was never given.
ok(/<canvas|<script/.test(servedHtml), 'bare GET serves index.html, not JSON');
// The regex in serveApp has to keep matching the real index.html. If the constant
// is renamed or restyled (var/double quotes), the replace silently no-ops and the
// served app falls back to the connect screen — the bug this check exists to catch.
ok(servedHtml.includes("const DEFAULT_BRIDGE_URL = " + JSON.stringify(EXEC_URL) + ";"),
   'serveApp rewrites DEFAULT_BRIDGE_URL to the live /exec URL');
ok(!/const DEFAULT_BRIDGE_URL = '';/.test(servedHtml), 'the empty file:// default is gone from the served copy');
// Confirmed against a real deployment: the sandbox iframe answers getUserMedia with
// "Permissions policy violation: camera is not allowed in this document." The served
// build must therefore know to drop camera mode — silently failing to flip this flag
// would put a permanently dead button in front of teachers.
ok(servedHtml.includes('const SERVED_BUILD = true;'), 'serveApp marks the served build');
ok(!/const SERVED_BUILD = false;/.test(servedHtml), 'the file:// default is gone from the served copy');
eq(served._title, 'Quiz Sheets', 'served page is titled');
eq(served._xFrame, 'ALLOWALL', 'served page can be framed (HtmlService sandboxes it into an iframe)');

// getUrl() returns the /dev URL when the script is run from the editor. Baking that
// in would hand the app a URL that fails every call — worse than asking.
sandbox.ScriptApp._url = 'https://script.google.com/macros/s/AKfycbxTEST/dev';
const devHtml = sandbox.handle({ parameter: {} }).getContent();
ok(/const DEFAULT_BRIDGE_URL = '';/.test(devHtml),
   'a /dev URL is refused — the served app falls through to the connect screen');
// Deliberately asymmetric: the /dev URL is unusable so it isn't baked in, but a page
// served from /dev is still sandboxed and still has no camera.
ok(devHtml.includes('const SERVED_BUILD = true;'), 'a /dev serve is still marked as served');
sandbox.ScriptApp._url = EXEC_URL;

console.log('\n8d-2. ?action=ping still answers with JSON (health checks, not humans)');
const pinged = unwrap(callJsonp({ action: 'ping' }));
eq(pinged.ok, true, 'ping is still JSON and still ok');
eq(pinged.pong, true, 'ping still pongs');

console.log('\n8e. a typo reports the typo');
const bad = unwrap(callJsonp({ action: 'listQuizes', classId: created.classId })); // sic
eq(bad.ok, false, 'unknown action → ok:false');
ok(/Unknown action/.test(bad.error), 'unknown action names itself, not "No class selected"');

console.log('\n8f. the callback name is echoed into executable JS — it must be validated');
const evil = sandbox.handle({ parameter: { action: 'ping', callback: 'alert(1);//' } });
ok(!/alert\(1\)/.test(evil.getContent()), 'a non-identifier callback is refused, not reflected');
eq(evil.getMimeType(), 'json', 'the refusal is served as JSON, not JavaScript');
const okCb = callJsonp({ action: 'ping' }, 'myCb_$2');
ok(/^myCb_\$2\(/.test(okCb.text), 'a legitimate identifier callback is honored');

// ── 9. Drive scope is not required for the common path ───────────────────────
// Regression: createClass used to call DriveApp.getFileById unconditionally, just
// to report which folder the Sheet landed in. That made every class creation fail
// for anyone whose OAuth grant lacked the Drive scope.
console.log('\n9. creating a class works without any Drive permission');
sandbox.DriveApp._denied = true;

const noDrive = call({ action: 'createClass', name: 'Period 5 — Physics' });
ok(noDrive.ok, 'createClass succeeds with Drive access denied');
eq(noDrive.folder, null, 'no folder was requested, so none is reported');
eq(DB.get(noDrive.sheetId).getSheets()[0].getName(), 'student-info', 'the Sheet is still built correctly');
ok(call({ action: 'addStudents', classId: noDrive.classId,
          students: [{ id: '1', last: 'Ito', first: 'Rei' }] }).ok, 'importing needs no Drive either');
ok(call({ action: 'createQuiz', classId: noDrive.classId, name: 'Q1', numQuestions: 1, key: ['A'] }).ok,
   'creating a quiz needs no Drive either');

console.log('\n9b. asking for a folder is what costs the Drive scope');
const denied = call({ action: 'createClass', name: 'Period 6 — Latin', folderId: 'FOLDER123' });
eq(denied.ok, false, 'a folder request fails cleanly when Drive is denied');
ok(/do not have permission/.test(denied.error), 'and it surfaces the real Google error');

sandbox.DriveApp._denied = false;
const withFolder = call({ action: 'createClass', name: 'Period 7 — Art', folderId: 'FOLDER123' });
ok(withFolder.ok, 'with Drive granted, the folder path works');
eq(withFolder.folder.name, 'Folder FOLDER123', 'and reports the folder it filed the Sheet into');

// ── 10. getGradebook — the whole class in one call ───────────────────────────
console.log('\n10. getGradebook crosses the roster with every quiz');
const gb = call({ action: 'createClass', name: 'Period 8 — History' });
const GB = gb.classId;
call({ action: 'addStudents', classId: GB, students: [
  { id: '900', last: 'Ada',  first: 'Ann' },
  { id: '901', last: 'Bell', first: 'Bo'  },
  { id: '902', last: 'Cruz', first: 'Cy'  },
]});
// Two quizzes, created a day apart so "recent" is well defined.
call({ action: 'createQuiz', classId: GB, name: 'Unit 1', numQuestions: 2, key: ['A', 'B'] });
call({ action: 'createQuiz', classId: GB, name: 'Unit 2', numQuestions: 2, key: ['C', 'D'] });
const gbSS = DB.get(gb.sheetId);
gbSS.getSheetByName('Unit 1').getRange(1, 2).setValue('2025-01-01T09:00:00.000Z');
gbSS.getSheetByName('Unit 2').getRange(1, 2).setValue('2025-02-01T09:00:00.000Z');

call({ action: 'submit', classId: GB, quiz: 'Unit 1', student: 'Ada, Ann',  studentId: '900', answers: ['A', 'B'] });
call({ action: 'submit', classId: GB, quiz: 'Unit 1', student: 'Bell, Bo',  studentId: '901', answers: ['A', 'X'] });
call({ action: 'submit', classId: GB, quiz: 'Unit 2', student: 'Ada, Ann',  studentId: '900', answers: ['X', 'X'] });

let g = call({ action: 'getGradebook', classId: GB });
ok(g.ok, 'getGradebook returns ok');
eq(g.students.length, 3, 'one row per roster student');
eq(g.quizzes.length, 2, 'both quizzes returned');
eq(g.quizzes[0].name, 'Unit 2', 'newest quiz first');
eq(g.quizzes[0].possible, 2, 'possible points come from the key');

const ada = g.students.find(s => s.id === '900');
const bell = g.students.find(s => s.id === '901');
const cruz = g.students.find(s => s.id === '902');
eq(ada.scores[0].percent, 0, 'Ada scored 0% on the newest quiz');
eq(ada.scores[1].percent, 100, 'Ada scored 100% on the older one');
eq(ada.avg, 50, 'average across taken quizzes');
eq(bell.scores[0], null, 'Bell never took Unit 2 → null, not 0');
eq(bell.scores[1].percent, 50, 'Bell scored 50% on Unit 1');
eq(bell.avg, 50, 'a skipped quiz does not drag the average to 0');
eq(cruz.avg, null, 'a student with no scans has a null average');
eq(cruz.taken, 0, 'and has taken nothing');
ok(cruz.scores.every(s => s === null), 'all of Cruz\'s cells are empty');

console.log('\n10b. a rescan supersedes the earlier attempt');
call({ action: 'submit', classId: GB, quiz: 'Unit 2', student: 'Ada, Ann', studentId: '900', answers: ['C', 'D'] });
g = call({ action: 'getGradebook', classId: GB });
eq(g.students.find(s => s.id === '900').scores[0].percent, 100, 'newest scan wins');
eq(g.students.find(s => s.id === '900').scores.filter(x => x).length, 2, 'and does not add a duplicate cell');

console.log('\n10c. scans whose ID is not on the roster are surfaced, not dropped');
call({ action: 'submit', classId: GB, quiz: 'Unit 1', student: 'Ghost', studentId: '999', answers: ['A', 'B'] });
g = call({ action: 'getGradebook', classId: GB });
eq(g.students.length, 3, 'the ghost does not become a roster row');
ok(g.unmatched.some(u => u.studentId === '999'), 'the ghost is reported as unmatched');

console.log('\n10d. limit keeps the most recent quizzes');
g = call({ action: 'getGradebook', classId: GB, limit: 1 });
eq(g.quizzes.length, 1, 'limit honored');
eq(g.quizzes[0].name, 'Unit 2', 'and it keeps the newest');
eq(g.totalQuizzes, 2, 'while still reporting the true total');
eq(g.students[0].scores.length, 1, 'score rows are trimmed to match');

console.log('\n10e. a class with no quizzes / no roster does not crash');
const empty = call({ action: 'createClass', name: 'Period 9 — Empty' });
const ge = call({ action: 'getGradebook', classId: empty.classId });
ok(ge.ok, 'empty class returns ok');
eq(ge.students.length, 0, 'no students');
eq(ge.quizzes.length, 0, 'no quizzes');

console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks FAILED' : '✓ all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
