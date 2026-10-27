/* Dashboard behavior. Storage keys match the full extension console. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const client = window.MiraclesBridge;
  let panelError = "";
  const cfg = window.MIRACLES_CONFIG || {};
  const defaultHost = client.defaults.host || `${cfg.MCP_HOST || '127.0.0.1'}:${cfg.MCP_PORT || 19731}`;
  const sharedKeys = ['host','bridgeToken','safeMode','dashboardWallpaper','dashboardMaterial','dashboardGlassDepth','dashboardWallpaperMode'];
  const wallpapers = window.MiracleAppearance.wallpapers;
  let settings = {};
  let currentHost = defaultHost;
  let pollController = null;
  let requestId = 0;
  let nextStatusTimer = 0;
  let recent = [];
  let logSignature = '';
  let lastSuccess = null;
  let checking = false;

  const storage = {
    get: () => client.storage.read(),
    async set(values) { await client.storage.set(values); Object.assign(settings, values); }
  };
  function feedback(message, error = false) {
    const box = document.getElementById("connectionFeedback");
    box.hidden = false; box.textContent = message; box.dataset.kind = error ? "error" : "info";
  }

  function toast(message, error = false) {
    const item = document.createElement('div');
    item.className = 'toast';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('icon');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', error ? 'assets/icons/interface.svg#info' : 'assets/icons/interface.svg#check');
    icon.append(use);
    item.append(icon, document.createTextNode(message));
    $('#toasts').append(item);
    setTimeout(() => { item.classList.add('out'); setTimeout(() => item.remove(), 220); }, 3200);
  }
  async function persist(values) {
    try { await storage.set(values); return true; }
    catch { toast('The browser could not save your settings.', true); return false; }
  }
  function normalizeHost(value) { return client.base(value).replace("http://", ""); }
  function setText(id, value) { const el = document.getElementById(id); if (el.textContent !== value) el.textContent = value; }
  function formatUptime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60);
    if (hours >= 24) return `${Math.floor(hours / 24)} d ${hours % 24} h`;
    if (hours) return `${hours} h ${minutes} m`;
    if (minutes) return `${minutes} m ${total % 60} s`;
    return `${total} s`;
  }
  function renderLogs(entries) {
    recent = Array.isArray(entries) ? entries.filter(entry => entry && typeof entry === 'object').slice(0,15) : [];
    const signature = JSON.stringify(recent);
    if (signature === logSignature) return;
    logSignature = signature;
    setText('eventCount', String(recent.length));
    $('#eventCount').dataset.empty=String(recent.length===0);
    setText('logCount', String(recent.length));
    $('#copyLog').disabled = !recent.length;
    $('#logEmpty').hidden = recent.length > 0;
    $('#dashLog').hidden = !recent.length;
    const fragment = document.createDocumentFragment();
    recent.forEach(entry => {
      const row = document.createElement('div'); row.className = 'log-entry';
      const time = document.createElement('time'); time.textContent = String(entry.at || '—').slice(0,30);
      const source = document.createElement('span'); source.className = 'log-source'; source.textContent = String(entry.src || 'bridge').slice(0,30);
      const text = document.createElement('p'); text.textContent = String(entry.text || '').slice(0,500);
      row.append(time, source, text); fragment.append(row);
    });
    $('#dashLog').replaceChildren(fragment);
  }
  function renderOnline(data, latency) {
    document.body.dataset.connection = 'online';
    setText('sidebarConnection', 'Bridge connected');
    const nativeMcp = data.studio_mode === 'native_mcp' || Boolean(data.native_mcp);
    const linked = nativeMcp ? data.native_mcp?.state === 'ready' : Boolean(data.studio_linked);
    const diagnosis = client.diagnose(data);
    document.body.dataset.studio=linked?'linked':'waiting';
    setText('pillText',linked?'Studio connected':diagnosis.title);
    setText('stStatus','Bridge online');
    setText('stQueue',String(Number(data.queue)||0));
    setText('queueNote',data.queue?'Waiting for Studio':'All clear. Ready for your next idea.');
    setText('stUptime',formatUptime(data.uptime_s));
    setText('stSafety',data.safe?'On':'Off');
    setText('safetyNote',data.safe?'Server code checks enabled':'Server code checks disabled');
    setText('stStudio', linked ? 'Connected' : 'Waiting');
    setText('studioNote', linked ? (nativeMcp ? `Available tools: ${Number(data.native_mcp?.tools_count) || 0}` : `Response ${Number(data.studio_seen_s) || 0} seconds ago`) : diagnosis.title);
    setText('studioVisualStatus', linked ? 'MCP connected' : 'Waiting for connection');
    setText('bridgeDescription', linked ? 'Your tools are ready. Open your AI chat and select Helium → Start session.' : diagnosis.message);
    feedback(panelError || diagnosis.message, !!panelError || diagnosis.state !== 'linked');
    setText('studioStatus', diagnosis.title);
    setText('latencyValue', `${latency} ms`);
    const version = String(data.version || '').slice(0,24);
    setText('stVersion', version ? ` · v${version}` : '');
    setText('sidebarVersion', version ? `v${version}` : 'MCP');
    lastSuccess = new Date();
    setText('lastUpdated', `Updated ${lastSuccess.toLocaleTimeString('en-US')}`);
    renderLogs(data.recent);
    document.dispatchEvent(new CustomEvent('miracles:status', { detail: { data, host: currentHost } }));
  }
  function renderOffline(error) {
    const message = error?.name === 'AbortError'
      ? 'The server timed out. Check run.bat and the connection address.'
      : error instanceof TypeError || !error
        ? 'The bridge is offline. Start run.bat to reconnect.'
        : error.message;
    feedback(message, true);
    setText("studioStatus", "Studio: unavailable");
    document.body.dataset.connection = 'offline';
    setText('sidebarConnection', 'Bridge offline');
    document.body.dataset.studio = 'waiting';
    setText('pillText', 'Waiting for bridge');
    setText('stStatus', 'Server not responding');
    setText('bridgeDescription', 'Start run.bat in your project folder. Keep it open, then check the connection.');
    ['stQueue','stUptime','stSafety','stStudio'].forEach(id => setText(id, '—'));
    setText('queueNote', 'Waiting for connection');
    setText('safetyNote', 'No server data');
    setText('studioNote', 'Connect the bridge first');
    setText('studioVisualStatus', 'Disconnected');
    setText('latencyValue', '— ms');
    setText('lastUpdated', lastSuccess ? `Offline · last update ${lastSuccess.toLocaleTimeString('en-US')}` : 'Waiting to reconnect');
    document.dispatchEvent(new CustomEvent('miracles:offline', { detail: { message } }));
  }
  function scheduleStatusCheck(delay) {
    clearTimeout(nextStatusTimer);
    if (document.hidden) return;
    nextStatusTimer = window.setTimeout(() => tick(), delay);
  }
  async function tick(force = false) {
    if (pollController && !force) return;
    pollController?.abort();
    const controller = new AbortController();
    pollController = controller;
    const id = ++requestId;
    const timeout = setTimeout(() => controller.abort(), 4500);
    $('#refreshStatus').classList.add('busy');
    $('#refreshStatus').setAttribute('aria-busy', 'true');
    try {
      const started = performance.now();
      const response = ({ok:true, json:() => client.request(currentHost, '/api/status')});
      if (!response.ok) throw new Error('Bridge request failed');
      const data = await response.json();
      if (data.online !== true || !Number.isFinite(data.queue) || data.queue < 0 || !Number.isFinite(data.uptime_s)) throw new Error('Unexpected bridge response');
      if (id === requestId) { renderOnline(data, Math.max(1, Math.round(performance.now() - started))); return data; }
    } catch (error) {
      const message = error.name === 'AbortError' ? 'The bridge timed out after 5 seconds. Check run.bat and the server address.'
        : error instanceof TypeError ? 'The bridge is offline. Start run.bat, keep it open and check the connection.'
        : 'Invalid bridge response. Check the address and restart the server.';
      if (id === requestId) renderOffline(new Error(message));
    } finally {
      clearTimeout(timeout);
      if (id === requestId) {
        pollController = null;
        $('#refreshStatus').classList.remove('busy');
        $('#refreshStatus').setAttribute('aria-busy', 'false');
        // A dashboard does not need a fixed 3-second network wake-up while
        // Studio is idle. Keep updates quick when connected, slower when the
        // bridge is unavailable, and resume immediately after returning.
        scheduleStatusCheck($('#runCode')?.getAttribute('aria-busy') === 'true' ? 1000 : document.body.dataset.connection === 'online' ? 10000 : 20000);
      }
    }
  }

  async function checkConnection() {
    if (checking) return;
    checking = true;
    const buttons = ['#checkConnection', '#dashPill', '#refreshStatus'].map($);
    buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
    $('#checkConnection').textContent = 'Checking…';
    try {
      panelError = "";
      let data = await tick(true);
      if (!data) { client.report($('#connectionFeedback').textContent); return; }
      if (canBootstrap()) {
        await client.bootstrap();
        settings = await storage.get();
        currentHost = normalizeHost(settings.host);
        data = await tick(true) || data;
      }
      if (!settings.bridgeToken) throw new Error('Start run.bat to set up the local connection.');
      await client.request(currentHost, '/api/auth', { token: settings.bridgeToken });
      client.report(client.diagnose(data).title + '. ' + client.diagnose(data).message, false);
    } catch (error) { panelError = error.message; client.report(error.message); }
    finally { checking = false; buttons.forEach(button => { button.disabled = false; button.setAttribute('aria-busy', 'false'); }); $('#checkConnection').textContent = 'Check connection'; }
  }
  $('#checkConnection').onclick = checkConnection;
  $('#dashPill').onclick = checkConnection;
  $('#studioStatus').onclick = () => {
    window.MiracleSections.open('setupGuide');
    toast($('#connectionFeedback').textContent);
  };

  const applyWallpaper = key => window.MiracleAppearance.apply(key);
  function applyMaterial(value) {
    const mode = window.MiracleAppearance.normalizeMaterial(value);
    document.body.dataset.glassMode = mode;
    const system = value === 'light' && matchMedia('(prefers-reduced-transparency: reduce)').matches;
    document.body.dataset.glassChoice = system ? 'system' : mode;
    $('#glassDepth').disabled = system;
    $$('[data-material]').forEach(button => {
      const selected = button.dataset.material === mode;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    });
    window.DashboardGlass?.refresh();
  }
  function applyDepth(value) {
    const parsed = Number(value);
    const depth = Number.isFinite(parsed) ? Math.max(20, Math.min(100, parsed)) : 68;
    $('#glassDepth').value = depth;
    $('#glassDepth').style.setProperty('--range-progress', `${(depth - 20) / 80 * 100}%`);
    setText('glassDepthValue', `${depth}%`);
    window.DashboardGlass?.setDepth(depth);
  }

  $('#settingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    let host;
    try { host = normalizeHost($('#setHost').value); }
    catch { $('#hostError').textContent = 'Enter a local address, such as 127.0.0.1:19731.'; $('#hostError').hidden = false; $('#setHost').setAttribute('aria-invalid', 'true'); $('#setHost').focus(); return; }
    const button = $('#saveSettings'); button.disabled = true;
    try {
      if (await persist({host, bridgeToken:$('#setToken').value.trim()})) {
        currentHost = host; $('#setHost').value = host;
        $('#hostError').hidden = true; $('#setHost').removeAttribute('aria-invalid');
        panelError = ''; setText('endpointLabel', host); toast('Settings saved'); await checkConnection();
      }
    } finally { button.disabled = false; }
  });
  $('#setHost').addEventListener('input', () => { $('#hostError').hidden = true; $('#setHost').removeAttribute('aria-invalid'); });
  $('#resetSettings').addEventListener('click', async () => {
    if (await persist({host:defaultHost, bridgeToken:''})) {
      currentHost = defaultHost; $('#setHost').value = defaultHost; $('#setToken').value = '';
      $('#setToken').type = 'password'; $('#toggleToken').setAttribute('aria-pressed','false'); $('#toggleToken').setAttribute('aria-label','Show token');
      $('#hostError').hidden = true; $('#setHost').removeAttribute('aria-invalid');
      panelError = ''; setText('endpointLabel', defaultHost); toast('Connection reset'); tick(true);
    }
  });
  $('#toggleToken').addEventListener('click', () => {
    const show = $('#setToken').type === 'password';
    $('#setToken').type = show ? 'text' : 'password';
    $('#toggleToken').setAttribute('aria-pressed', String(show));
    $('#toggleToken').setAttribute('aria-label', show ? 'Hide token' : 'Show token');
  });
  $('#refreshStatus').addEventListener('click', checkConnection);
  $$('.wallpaper-option[data-wallpaper]').forEach(button => button.addEventListener('click', async () => { if(await applyWallpaper(button.dataset.wallpaper)) { window.MiracleAppearance.setMode('manual');persist({dashboardWallpaper:button.dataset.wallpaper,dashboardWallpaperMode:'manual'}); } }));
  $$('[data-material]').forEach(button => button.addEventListener('click', () => { applyMaterial(button.dataset.material); persist({dashboardMaterial:button.dataset.material}); }));
  $('#glassDepth').addEventListener('input', event => applyDepth(event.target.value));
  $('#glassDepth').addEventListener('change', event => persist({dashboardGlassDepth:Number(event.target.value)}));
  $('#safeMode').addEventListener('click', async () => {
    const button = $('#safeMode');
    const enabled = button.getAttribute('aria-checked') !== 'true';
    button.disabled = true;
    try { if (await persist({safeMode:enabled})) { button.setAttribute('aria-checked', String(enabled)); toast(enabled ? 'Code checks enabled.' : 'Client checks disabled. Server rules still apply.'); } }
    finally { button.disabled = false; }
  });
  $('#copyLog').addEventListener('click', async () => {
    try { await client.copy(recent.map(entry => `[${entry.at || '—'}] ${entry.src || 'bridge'}: ${String(entry.text || '')}`).join('\n')); toast('Events copied'); }
    catch { toast('Could not copy. Select the event text manually.', true); }
  });

  const today = new Date();
  $('#localDate').dateTime = today.toISOString();
  $('#localDate').textContent = today.toLocaleDateString('en-US', {day:'numeric',month:'long',weekday:'short'});
  function isSameOriginLocal() {
    return location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && normalizeHost(currentHost) === location.host;
  }
  function canBootstrap() { return false; }
  async function initialize() {
    try { const saved = await storage.get(); settings = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}; }
    catch { settings = {}; toast('Saved settings are unavailable.', true); }
    try { currentHost = normalizeHost(settings.host || defaultHost); } catch { currentHost = defaultHost; }
    if (canBootstrap()) {
      try { await client.bootstrap(); settings = await storage.get(); }
      catch (error) { panelError = error.message; }
    }
    try { currentHost = normalizeHost(settings.host || defaultHost); } catch { currentHost = defaultHost; }
    $('#setHost').value = currentHost; setText('endpointLabel', currentHost);
    if (typeof settings.bridgeToken === 'string') $('#setToken').value = settings.bridgeToken;
    $('#safeMode').setAttribute('aria-checked', String(settings.safeMode !== false));
    const theme=window.MiracleAppearance.normalize(settings.dashboardWallpaper);
    const applied=await window.MiracleAppearance.setMode('manual',theme);
    if(applied&&(settings.dashboardWallpaper!==theme||settings.dashboardWallpaperMode!=='manual'))await persist({dashboardWallpaper:theme,dashboardWallpaperMode:'manual'});
    applyMaterial(settings.dashboardMaterial);
    if(document.body.dataset.glassChoice!=='system'&&settings.dashboardMaterial!==document.body.dataset.glassMode)await persist({dashboardMaterial:document.body.dataset.glassMode});
    applyDepth(settings.dashboardGlassDepth ?? 68);
    await tick();
  }
  window.MiraclesDashboard = { refresh: () => tick(true) };
  initialize();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(nextStatusTimer);
    else tick(true);
  });
  // Other extension panels can update the same connection settings.
  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of sharedKeys) if (changes[key]) settings[key] = changes[key].newValue;
    if (changes.host) { try { currentHost = normalizeHost(settings.host || defaultHost); $('#setHost').value = currentHost; setText('endpointLabel',currentHost); tick(true); } catch {} }
    if (changes.bridgeToken && document.activeElement !== $('#setToken')) $('#setToken').value = settings.bridgeToken || '';
    if (changes.safeMode) $('#safeMode').setAttribute('aria-checked', String(settings.safeMode !== false));
  });
})();
