/** Pulls the real parseImportLine out of index.html and exercises it. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = fs.readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const m = /function parseImportLine\(line\) \{[\s\S]*?\n\}/.exec(html);
if (!m) { console.error('could not find parseImportLine in index.html'); process.exit(1); }
const parseImportLine = new Function('return (' + m[0] + ')')();

let failures = 0, checks = 0;
function check(line, expect) {
  const got = parseImportLine(line);
  for (const k of Object.keys(expect)) {
    checks++;
    const a = got[k] ?? null, e = expect[k] ?? null;
    if (a === e) console.log('  ✓ ' + JSON.stringify(line) + ' → ' + k + '=' + JSON.stringify(a));
    else { failures++; console.log('  ✗ ' + JSON.stringify(line) + ' → ' + k + '=' + JSON.stringify(a) + ' expected ' + JSON.stringify(e)); }
  }
}

console.log('\nID, Last, First — the documented format');
check('10432, Smith, Jane', { id: '10432', last: 'Smith', first: 'Jane', warning: null, isHeader: undefined });
check('10433,Doe,John',     { id: '10433', last: 'Doe',   first: 'John', warning: null });

console.log('\nheader rows are detected and excluded by default');
check('ID, Last Name, First Name', { isHeader: true });
check('Student ID, Last, First',   { isHeader: true });
check('id,last name,first name',   { isHeader: true });

console.log('\nextra columns are flagged, not silently dropped');
check('10432, Smith, Jane, jane@school.edu', { id: '10432', last: 'Smith', first: 'Jane', warning: '1 extra column ignored' });
check('10432, Smith, Jane, a, b',            { warning: '2 extra columns ignored' });

console.log('\nname-only lines still import, with a warning');
check('Smith, Jane', { id: '', last: 'Smith', first: 'Jane', warning: 'No ID — expected "ID, Last, First"' });
check('Smith',       { id: '', last: 'Smith', first: '',     warning: 'No commas found — expected "ID, Last, First"' });

console.log('\nwhitespace is trimmed');
check('  10432 ,  Smith  ,  Jane  ', { id: '10432', last: 'Smith', first: 'Jane' });

console.log('\na real student is never mistaken for a header');
// leads with a numeric ID, so it's a student row even though the names look label-ish
check('10432, Last, First', { id: '10432', last: 'Last', first: 'First', isHeader: undefined });
check('10499, Idris, Sam',  { id: '10499', last: 'Idris', first: 'Sam', isHeader: undefined });

console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks FAILED' : '✓ all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
