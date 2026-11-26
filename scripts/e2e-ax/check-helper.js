// Sanity-check the page-side helper strings embedded in extension/background.js.
// Extracts each `<NAME> = \`...\`;` template literal, evaluates it, and verifies
// the resulting source parses as a JS function expression.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '..', 'extension', 'background.js');
const src = fs.readFileSync(file, 'utf8');

const names = ['READ_PAGE_HELPER', 'AX_RECT_HELPER', 'AX_FOCUS_HELPER', 'AX_SET_VALUE_HELPER', 'AX_SELECT_TEXT_HELPER'];
let fail = 0;
for (const name of names) {
  const start = src.indexOf('const ' + name + ' = `');
  if (start === -1) { console.log('SKIP ' + name + ' (not found)'); continue; }
  const bodyStart = start + ('const ' + name + ' = `').length;
  const end = src.indexOf('`;', bodyStart);
  if (end === -1) { console.log('FAIL ' + name + ' (unterminated)'); fail++; continue; }
  const body = src.slice(bodyStart, end);
  let value;
  try {
    value = new Function('return `' + body + '`')();
  } catch (e) {
    console.log('FAIL ' + name + ' (template eval): ' + e.message);
    fail++;
    continue;
  }
  try {
    new Function('return (' + value + ')');
    console.log('OK   ' + name + ' (' + value.length + ' chars)');
  } catch (e) {
    console.log('FAIL ' + name + ' (parses): ' + e.message);
    fail++;
  }
}
process.exit(fail ? 1 : 0);
