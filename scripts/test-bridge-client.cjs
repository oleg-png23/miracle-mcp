const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const path = require('node:path');
const source = readFileSync(path.join(__dirname, 'bridge-client.js'), 'utf8');

function browser(saved = {}, options = {}) {
  const data = new Map(Object.entries(saved));
  const href = options.href || 'http://127.0.0.1:19732/ui/dashboard.html';
  const localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
  const context = {
    URL, AbortController, AbortSignal, setTimeout, clearTimeout,
    location: new URL(href), localStorage,
    document: {
      getElementById: () => null, body: { appendChild() {} },
      createElement: () => ({ select() {}, remove() {} }), execCommand: () => false,
    },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: options.fetch || (async () => ({ ok: true, json: async () => ({ online: true, queue: 0 }) })),
  };
  context.window = context;
  if (options.chrome) context.chrome = options.chrome;
  vm.runInNewContext(source, context);
  return { client: context.MiraclesBridge, context, data };
}

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test('host normalization accepts loopback and rejects paths, credentials and remote hosts', () => {
  const { client } = browser();
  assert.equal(client.base('http://localhost:19732/'), 'http://localhost:19732');
  assert.equal(client.base('127.0.0.1:19731'), 'http://127.0.0.1:19731');
  for (const address of ['https://localhost:19731', 'example.com', 'localhost:19731/api', 'u:p@localhost', 'localhost?token=private']) assert.throws(() => client.base(address));
});

test('settings survive page reload and migrate both older interfaces', async () => {
  const first = browser({ mcp_token: 'old', 'miracles.dashboard.settings': '{"dashboardWallpaper":"coast"}' });
  assert.equal((await first.client.storage.read()).bridgeToken, 'old');
  await first.client.storage.set({ host: 'localhost:19732', bridgeToken: 'new' });
  const second = browser(Object.fromEntries(first.data));
  const settings = await second.client.storage.read();
  assert.equal(settings.bridgeToken, 'new');
  assert.equal(settings.host, 'localhost:19732');
  assert.equal(settings.dashboardWallpaper, 'coast');
});

test('reset removes only Argon settings and updates defaults immediately', async () => {
  const { client, data } = browser({ unrelated: 'keep', mcp_token: 'old' });
  await client.storage.set({ bridgeToken: 'new' });
  await client.storage.clear();
  assert.equal((await client.storage.read()).bridgeToken, '');
  assert.equal(data.get('unrelated'), 'keep');
});

test('extension reset preserves unrelated extension keys', async () => {
  let removed;
  const local = { get: async () => ({ bridgeToken: 'token', unrelated: 'keep' }), remove: async keys => { removed = keys; } };
  const { client } = browser({}, { chrome: { storage: { local } } });
  await client.storage.clear();
  assert(removed.includes('bridgeToken'));
  assert(!removed.includes('unrelated'));
});

test('local setup verifies a user-provided token without requesting credentials over HTTP', async () => {
  let call;
  const { client } = browser({mcp_token:'local-token'}, { fetch: async (url, init) => {
    call = { url: String(url), init };
    return response(200, {ok:true});
  } });
  const settings = await client.bootstrap();
  assert.equal(call.url, 'http://127.0.0.1:19732/api/auth');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(call.init.body).token, 'local-token');
  assert.equal(settings.host, '127.0.0.1:19732');
  assert.equal(settings.bridgeToken, 'local-token');
  assert.equal((await client.storage.read()).bridgeToken, 'local-token');
  let requested = false;
  const unpaired = browser({}, {fetch:async()=>{requested=true;}});
  await assert.rejects(unpaired.client.bootstrap(),/python\/token\.txt/);
  assert.equal(requested, false);
});

test('bootstrap refuses file and remote origins without making a request', async () => {
  let calls = 0;
  for (const href of ['file:///tmp/dashboard.html', 'https://example.com/dashboard']) {
    const { client } = browser({}, { href, fetch: async () => { calls++; return response(200, {}); } });
    await assert.rejects(client.bootstrap());
  }
  assert.equal(calls, 0);
});

test('extension setup asks the worker to verify its saved credentials', async () => {
  const state = { host: 'localhost:19731', bridgeToken: 'worker-token' };
  let message;
  const local = {
    get: async () => ({ ...state }),
    set: async values => Object.assign(state, values),
    remove: async () => {},
  };
  const runtime = {
    id: 'extension-id', lastError: null,
    sendMessage(request, callback) {
      message = request;
      callback({ authenticated: true });
    },
  };
  const { client } = browser({}, { chrome: { runtime, storage: { local } }, fetch: async () => { throw new Error('extension bootstrap must use the worker'); } });
  const settings = await client.bootstrap();
  assert.equal(message.type, 'MCP_HEALTH');
  assert.equal(Object.keys(message).length, 1);
  assert.equal(settings.host, 'localhost:19731');
  assert.equal(settings.bridgeToken, 'worker-token');
});

test('extension setup reports the manual pairing instruction', async () => {
  const local = {get:async()=>({}),set:async()=>{},remove:async()=>{}};
  const runtime = {id:'extension-id',lastError:null,sendMessage(_request,callback){callback({authenticated:false,message:'Copy the token from the local workspace.'});}};
  const {client}=browser({}, {chrome:{runtime,storage:{local}}});
  await assert.rejects(client.bootstrap(),/Copy the token from the local workspace/);
});

test('HTTP errors preserve structured root and policy details; tokens stay in POST bodies', async () => {
  let call;
  const { client } = browser({}, { fetch: async (url, init) => {
    call = { url: String(url), init };
    return response(403, { error: 'request denied', pattern: 'unsafe_operation' });
  } });
  await assert.rejects(client.request('localhost:19732', '/api/tools/call', { token: 'dummy' }, 75000), /403.*unsafe_operation/);
  assert.equal(call.init.method, 'POST');
  assert.equal(JSON.parse(call.init.body).token, 'dummy');
  assert(!call.url.includes('dummy'));
  const rootError = browser({}, { fetch: async () => response(500, { error: 'native MCP unavailable', detail: 'Studio closed' }) });
  await assert.rejects(rootError.client.request('localhost:19732', '/api/tools/list', undefined, 20000), /HTTP 500: native MCP unavailable/);
});

test('request timeout argument controls abort timing and its diagnostic', async () => {
  const { client } = browser({}, { fetch: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }) });
  const started = Date.now();
  await assert.rejects(client.request('localhost:19732', '/api/tools/list', undefined, 30), /1 s/);
  assert(Date.now() - started < 1000);
});

test('native MCP diagnosis covers ready, missing, closed and disabled states', () => {
  const { client } = browser();
  const diagnose = state => client.diagnose({ studio_mode: 'native_mcp', studio_linked: state === 'ready', native_mcp: { state, message: 'native detail', tools_count: 8 } });
  assert.equal(diagnose('ready').state, 'linked');
  assert.match(diagnose('ready').message, /AI chat/);
  assert.equal(diagnose('missing').state, 'missing');
  assert.match(diagnose('missing').message, /place/);
  assert.equal(diagnose('studio_closed').state, 'studio_closed');
  assert.match(diagnose('studio_closed').message, /Studio/);
  assert.equal(diagnose('mcp_disabled').state, 'mcp_disabled');
  assert.match(diagnose('mcp_disabled').message, /Manage MCP Servers.*Enable Studio as MCP Server/);
  assert.equal(diagnose('error').message, 'native detail');
});

test('copy fallback reports browser denial instead of succeeding', async () => {
  const { client, context } = browser();
  context.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await assert.rejects(client.copy('test'), /Ctrl\+C/);
});

test('corrupted browser settings do not prevent dashboard startup', async () => {
  const { client } = browser({ 'miracles.dashboard.settings': 'not json', 'miracles.settings': '[]' });
  const settings = await client.storage.read();
  assert.equal(settings.bridgeToken, '');
  assert.equal(settings.dashboardWallpaper, 'lime');
});
