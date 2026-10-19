const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');

function makeResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
function worker(initialSettings = {}, options = {}) {
  const listeners = {}, calls = [];
  const settings = { ...initialSettings };
  let token = options.validToken || 'fresh-token';
  let instance = options.instance || 'instance-a';
  let authFailures = options.authFailures || 0;
  const host = options.host || settings.host || '127.0.0.1:19731';
  const origin = 'http://' + host;
  const nativeState = options.nativeState || 'ready';
  const context = {
    URL, AbortSignal, console, importScripts() {},
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      const method = init.method || 'GET';
      let body = {};
      try { body = JSON.parse(init.body || '{}'); } catch {}
      if (url.endsWith('/api/bootstrap')) {
        assert.equal(method, 'POST');
        assert.deepEqual(body, {});
        token = options.bootstrapToken || 'fresh-token';
        instance = options.bootstrapInstance || instance;
        return makeResponse(200, { host, bridgeToken: token, instance_id: instance });
      }
      if (url.endsWith('/api/auth')) {
        if (authFailures > 0) { authFailures--; return makeResponse(401, { ok: false, code: 'TOKEN_REJECTED', message: 'token expired' }); }
        return body.token === token ? makeResponse(200, { ok: true }) : makeResponse(401, { ok: false, code: 'TOKEN_REJECTED' });
      }
      if (url.endsWith('/api/status')) {
        return makeResponse(200, { online: true, studio_linked: nativeState === 'ready', native_mcp: { state: nativeState, message: 'Studio state' }, instance_id: instance });
      }
      if (url.endsWith('/api/usage/event')) return makeResponse(200, {ok:true});
      if (url.endsWith('/api/tools/list')) {
        if (body.token !== token) return makeResponse(401, { ok: false, code: 'TOKEN_REJECTED' });
        if (options.listStatus) return makeResponse(options.listStatus, { ok: false, code: 'LIST_ERROR', message: 'list denied' });
        return makeResponse(200, { ok: true, instance_id: instance, tools: [{ name: 'studio.inspect', description: 'Inspect Studio', inputSchema: { type: 'object' } }] });
      }
      if (url.endsWith('/api/tools/call')) {
        if (body.token !== token) return makeResponse(401, { ok: false, code: 'TOKEN_REJECTED', message: 'expired' });
        if (options.callStatus) return makeResponse(options.callStatus, { ok: false, code: 'CALL_DENIED', message: 'call denied' });
        calls.push({ toolBody: body });
        return makeResponse(200, { ok: true, instance_id: instance, result: options.toolResult || { content: [{ type: 'text', text: 'ok' }] } });
      }
      throw new Error('Unexpected request ' + url);
    },
    chrome: {
      runtime: { onInstalled: { addListener: fn => { listeners.install = fn; } }, onStartup: { addListener: fn => { listeners.startup = fn; } }, onMessage: { addListener: fn => { listeners.message = fn; } }, getURL: file => 'chrome-extension://test/' + file },
      action: { onClicked: { addListener: fn => { listeners.click = fn; } } },
      tabs: {
        create: async values => { calls.push({opened: values.url}); },
        query: async () => options.tabs || [],
        update: async (id, values) => { calls.push({tabId: id, ...values}); }
      },
      windows: {update: async (id, values) => { calls.push({windowId: id, ...values}); }},
      storage: { local: { get: async () => ({ ...settings }), set: async next => Object.assign(settings, next) } }
    }
  };
  context.self = context;
  vm.runInNewContext(source, context);
  return { context, calls, listeners, settings, origin };
}

test('health bootstraps missing tokens and verifies stale tokens before readiness', async () => {
  const absent = worker();
  const first = await absent.context.checkBridgeHealth();
  assert.equal(first.code, 'READY');
  assert.equal(absent.settings.bridgeToken, 'fresh-token');
  assert.equal(absent.calls[0].url, absent.origin + '/api/bootstrap');

  const stale = worker({ bridgeToken: 'old-token' }, { authFailures: 1 });
  const second = await stale.context.checkBridgeHealth();
  assert.equal(second.code, 'READY');
  assert.equal(stale.settings.bridgeToken, 'fresh-token');
  assert.equal(stale.calls.filter(c => c.url.endsWith('/api/bootstrap')).length, 1);
});

test('launch welcome has a persistent five-hour cooldown and startup stays quiet during it', async () => {
  const w = worker();
  await w.context.openDashboard();
  assert.equal(w.calls.at(-1).opened, 'chrome-extension://test/welcome.html');
  const first = w.settings.welcomeLastShownAt;
  assert(first > 0);
  await w.context.openDashboard();
  assert.equal(w.calls.at(-1).opened, 'chrome-extension://test/dashboard.html');
  const before = w.calls.length;
  await w.context.openDashboard('startup');
  assert.equal(w.calls.length, before);
  w.settings.welcomeLastShownAt = Date.now() - 5 * 60 * 60 * 1000 - 1;
  await w.context.openDashboard('startup');
  assert.equal(w.calls.at(-1).opened, 'chrome-extension://test/welcome.html');
  assert(w.settings.welcomeLastShownAt >= first);
});

test('concurrent launches coalesce and reuse an existing welcome tab', async () => {
  const w = worker({}, {tabs: [{id: 7, windowId: 3, url: 'chrome-extension://test/welcome.html'}]});
  await Promise.all([w.context.openDashboard(), w.context.openDashboard()]);
  assert.equal(w.calls.filter(call => call.tabId === 7).length, 1);
  assert.equal(w.calls.filter(call => call.opened).length, 0);
  assert.equal(w.calls.at(-1).windowId, 3);
});

test('launch never reuses an unrelated browser tab', async () => {
  const w = worker({}, {tabs: [{id: 99, url: 'https://example.com/'}]});
  await w.context.openDashboard();
  assert.equal(w.calls.at(-1).opened, 'chrome-extension://test/welcome.html');
  assert(!w.calls.some(call => call.tabId === 99));
});

test('native missing, disabled, and connecting states are not reported ready', async () => {
  for (const state of ['missing', 'mcp_disabled', 'studio_closed', 'connecting', 'error']) {
    const result = await worker({ bridgeToken: 'fresh-token' }, { nativeState: state }).context.checkBridgeHealth();
    assert.equal(result.code, state);
    assert.equal(result.authenticated, true);
    assert.equal(result.native_state, state);
    assert.match(result.message, /Roblox Studio/);
    assert.doesNotMatch(result.message, /Timed out waiting|MCP method tools\/list/);
  }
  const closed = await worker({ bridgeToken: 'fresh-token' }, { nativeState: 'studio_closed' }).context.checkBridgeHealth();
  assert.match(closed.message, /Open a place in Roblox Studio/);
  const ready = await worker({ bridgeToken: 'fresh-token' }, { nativeState: 'ready' }).context.checkBridgeHealth();
  assert.equal(ready.code, 'READY');
  assert.equal(ready.studio_linked, true);
});

test('tools are loaded dynamically and token is sent only in POST bodies', async () => {
  const w = worker({ bridgeToken: 'fresh-token' });
  const listed = await w.context.toolsList();
  assert.equal(listed.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(listed.tools)), [{ name: 'studio.inspect', description: 'Inspect Studio', inputSchema: { type: 'object' } }]);
  const request = w.calls.find(c => c.url.endsWith('/api/tools/list'));
  assert.equal(request.init.method, 'POST');
  assert.equal(JSON.parse(request.init.body).token, 'fresh-token');
  assert(!w.calls.some(c => c.url.includes('fresh-token')));
});

test('tool calls forward arguments and session-namespaced call IDs', async () => {
  const w = worker({ bridgeToken: 'fresh-token' });
  const result = await w.context.callTool({ name: 'studio.inspect', arguments: { target: 'Workspace' }, call_id: 'session-7:call-1', instance_id: 'instance-a' });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.result)), { content: [{ type: 'text', text: 'ok' }] });
  const toolRequest = w.calls.find(c => c.toolBody);
  assert.equal(toolRequest.toolBody.name, 'studio.inspect');
  assert.deepEqual(JSON.parse(JSON.stringify(toolRequest.toolBody.arguments)), { target: 'Workspace' });
  assert.equal(toolRequest.toolBody.call_id, 'session-7:call-1');
  assert.equal(toolRequest.toolBody.token, 'fresh-token');
});

test('MCP tool result errors are forwarded without being converted to transport failures', async () => {
  const mcpError = { isError: true, content: [{ type: 'text', text: 'Lua compile error' }] };
  const result = await worker({ bridgeToken: 'fresh-token' }, { toolResult: mcpError }).context.callTool({ name: 'studio.inspect', arguments: {}, call_id: 's:c', instance_id: 'instance-a' });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.result)), mcpError);
});

test('a 403 tool response remains a protected-operation error and does not bootstrap', async () => {
  const w = worker({ bridgeToken: 'fresh-token' }, { callStatus: 403 });
  const result = await w.context.callTool({ name: 'studio.inspect', arguments: {}, call_id: 's:c', instance_id: 'instance-a' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CALL_DENIED');
  assert.equal(w.calls.filter(c => c.url.endsWith('/api/bootstrap')).length, 0);
});

test('a changed bridge instance prevents a tool call', async () => {
  const w = worker({ bridgeToken: 'fresh-token' }, { instance: 'instance-b' });
  const result = await w.context.callTool({ name: 'studio.inspect', arguments: {}, call_id: 's:c', instance_id: 'instance-a' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BRIDGE_RESTARTED');
  assert.equal(w.calls.some(c => c.url.endsWith('/api/tools/call')), false);
});

test('invalid hosts never make network requests', async () => {
  for (const host of ['example.com', 'https://localhost', 'user:pass@localhost', 'localhost/path']) {
    const w = worker({ host, bridgeToken: 'secret' });
    const result = await w.context.checkBridgeHealth();
    assert.equal(result.code, 'INVALID_HOST');
    assert.equal(w.calls.length, 0);
  }
});

 test('usage derives the site from the sender and forwards counts without chat content',async()=>{
 const w=worker({bridgeToken:'fresh-token'});
 const result=await new Promise(resolve=>w.listeners.message({type:'MCP_USAGE',event_id:'session:start',kind:'activation',characters:120,site:'forged.example'},{tab:{url:'https://chatgpt.com/c/private?secret=discard'}},resolve));
 assert.equal(result.ok,true);const entry=w.calls.find(c=>c.url.endsWith('/api/usage/event'));const body=JSON.parse(entry.init.body);assert.equal(body.site,'chatgpt.com');assert.equal(body.characters,120);assert(!JSON.stringify(body).includes('private'));assert(!JSON.stringify(body).includes('forged'));
 const rejected=await new Promise(resolve=>w.listeners.message({type:'MCP_USAGE'},{},resolve));assert.equal(rejected.ok,false);
 });
