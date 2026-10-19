const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('preview transport stays offline, blocks execution and isolates stored credentials', async () => {
  const values = new Map([['miracles.settings', JSON.stringify({bridgeToken:'private-real-token'})]]);
  const context = {window:{},matchMedia:()=>({matches:false}),document:{addEventListener(){}},
    localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},
    navigator:{clipboard:{writeText:async()=>{}}},
    fetch:()=>assert.fail('The preview must never access the network')};
  vm.runInNewContext(fs.readFileSync('website/preview/scripts/bridge-client.js','utf8'),context);
  const client = context.window.MiraclesBridge;
  assert.equal((await client.storage.read()).bridgeToken,'preview-only');
  assert.equal((await client.request('any','/api/status')).native_mcp.state,'ready');
  await assert.rejects(client.request('any','/api/execute'),/Preview only/);
  await assert.rejects(client.request('any','/api/tools/call'),/Preview only/);
  await client.storage.set({bridgeToken:'sensitive',host:'remote.example',dashboardWallpaper:'aurora'});
  assert.equal((await client.storage.read()).host,'127.0.0.1:19731');
  assert.equal((await client.storage.read()).bridgeToken,'preview-only');
  assert.equal((await client.storage.read()).dashboardWallpaper,'aurora');
  assert.match(values.get('miracles.settings'),/private-real-token/);
  assert.doesNotMatch(values.get('miracle.website.preview.settings'),/sensitive/);
});

test('generated dashboard has no network transport or real editor storage keys', () => {
  const script = fs.readFileSync('website/preview/scripts/dashboard.js','utf8');
  assert.doesNotMatch(script,/\bfetch\s*\(/);
  const editor = fs.readFileSync('website/preview/scripts/executor.js','utf8');
  assert.doesNotMatch(editor,/['"]miracles\.(code|pending)['"]/);
});
