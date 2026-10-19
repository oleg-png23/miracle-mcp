const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'chat-prompt.js'), 'utf8'), context);
const prompt = context.MiraclesPrompt;

test('build includes the full advertised tool objects and user task', () => {
  const tools = [{
    name: 'arbitrary.native_tool', description: 'Inspect thing',
    inputSchema: { type: 'object', required: ['target'], properties: { target: { type: 'string' } } },
    annotations: { readOnlyHint: true }, execution: { taskSupport: 'optional' }, _meta: { vendor: 'native' }
  }];
  const built = prompt.build(tools, 'Inspect Workspace');
  assert(built.includes(JSON.stringify(tools, null, 2)));
  assert(built.includes('Inspect Workspace'));
  assert(built.includes('arbitrary.native_tool'));
});

test('legacy intro, text, marker and safety guidance remain available', () => {
  assert.equal(prompt.text, prompt.intro);
  assert(prompt.intro.startsWith(prompt.marker));
  for (const phrase of ['unique id', 'actual result', 'user\'s language', 'system-level access', 'manual Lua/Luau', 'session limit']) {
    assert(prompt.intro.includes(phrase));
  }
});
