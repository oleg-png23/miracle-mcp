/* A queue acknowledgement is not a result. Only the matching Studio result
 * from this server instance can complete the pending execution. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const client = window.MiraclesBridge;
  const editor = $('luauCode');
  let busy = false, pending = null, timeout = 0, draftTimer = 0;
  function result(title, text, kind = 'info') {
    $('executionTitle').textContent = title;
    $('executionOutput').textContent = text;
    $('executionResult').dataset.kind = kind;
  }
  function lock(value) {
    busy = value;
    $('runCode').disabled = value; $('insertAsset').disabled = value;
    $('runCode').setAttribute('aria-busy', String(value));
    $('runCode').firstChild.textContent = value ? 'Waiting for Studio… ' : 'Run in Studio ';
  }
  function clearPending() {
    clearTimeout(timeout); pending = null; lock(false);
    try { sessionStorage.removeItem('miracle.preview.pending'); } catch { /* optional storage */ }
  }
  function waitForJob(job) {
    pending = job; lock(true);
    timeout = setTimeout(() => {
      if (!pending) return;
      result(`Task #${pending.id}: no result yet`, 'No result after 75 seconds. Check Studio, the scene and events before retrying. The code may already have run.', 'error');
      lock(false);
    }, Math.max(0, 75000 - (Date.now() - job.created)));
  }
  async function execute(code) {
    if (busy) return;
    if (!code.trim()) { result('No code', 'Enter Luau or select Insert sample.', 'error'); editor.focus(); return; }
    if (code.length > 20000) { result('Script too long', 'The limit is 20,000 characters. Split the script into smaller tasks.', 'error'); return; }
    lock(true);
    let accepted = false;
    try {
      let settings = await client.storage.read();
      if (!settings.bridgeToken?.trim()) { await client.bootstrap(); settings = await client.storage.read(); }
      if (!settings.bridgeToken?.trim()) throw new Error('Setup is incomplete. Start run.bat and check the connection.');
      result('Checking connection', 'Checking the bridge and Studio MCP…');
      const status = await client.request(settings.host, '/api/status');
      if (status.online !== true) throw new Error('Invalid bridge response. Check the server address.');
      const diagnosis = client.diagnose(status);
      if (diagnosis.state !== 'linked') throw new Error(diagnosis.title + '. ' + diagnosis.message + ' Code was not sent.');
      if (settings.safeMode !== false) {
        const blocked = /:\s*Kick\s*\(|BanAsync|game\s*:\s*Shutdown|\brequire\s*\(|\bloadstring\b|\b(?:get|set)fenv\b|\b(?:os|io)\s*\.|MarketplaceService\s*:\s*PromptPurchase/.exec(code);
        if (blocked) throw new Error('Code check: blocked operation ' + blocked[0] + '. Code was not sent. Server rules also apply.');
      }
      if (pending) clearPending();
      lock(true);
      const response = await client.request(settings.host, '/api/execute', { token: settings.bridgeToken, luau: code });
      if (!Number.isInteger(response.id)) throw new Error('The server did not return a task ID. Check events before retrying.');
      accepted = true;
      const job = { id: response.id, host: settings.host, instance: response.instance_id || status.instance_id, created: Date.now() };
      try { sessionStorage.setItem('miracle.preview.pending', JSON.stringify(job)); } catch { /* optional storage */ }
      result(`Task #${job.id} accepted`, 'Studio is running the code. Waiting for its result…', 'pending');
      waitForJob(job);
      window.MiraclesDashboard?.refresh();
    } catch (error) {
      result('Could not run code', error.message + (/timed out|offline|invalid.*response/i.test(error.message) ? ' Check events before retrying; the server may already have accepted the task.' : ''), 'error');
    } finally { if (!accepted) lock(false); }
  }
  document.addEventListener('miracles:status', event => {
    if (!pending) return;
    const { data, host } = event.detail;
    if (host !== pending.host) { result('Connection changed', `Task #${pending.id} was sent to another bridge. Check its events before retrying.`, 'error'); clearPending(); return; }
    if (pending.instance && data.instance_id && pending.instance !== data.instance_id) { result('Bridge restarted', `Result for task #${pending.id} is no longer available after the restart. Check the scene and Output in Studio.`, 'error'); clearPending(); return; }
    const found = data.results?.find(item => item.id === pending.id);
    if (!found) return;
    const title = found.ok ? `Completed in Studio · #${found.id}` : `Luau error · #${found.id}`;
    result(title + (Number.isFinite(found.elapsed_ms) ? ` · ${found.elapsed_ms} ms` : ''), found.output || (found.ok ? 'The script finished without output.' : 'No details received. Open Output in Studio.'), found.ok ? 'success' : 'error');
    clearPending();
  });
  $('aiPromptText').value = (window.MiraclesPrompt.intro || window.MiraclesPrompt.text) + '\nSelect Start session in Miracle to load the available tools.';
  $('copyAiPrompt').addEventListener('click', async () => {
    const details = $('aiPromptDetails'); details.open = true;
    try {
      let settings = await client.storage.read();
      if (!settings.bridgeToken) { await client.bootstrap(); settings = await client.storage.read(); }
      const listed = await client.request(settings.host, '/api/tools/list', { token: settings.bridgeToken }, 20000);
      if (!listed.ok || !Array.isArray(listed.tools) || !listed.tools.length) throw new Error(listed.message || 'Studio tools are not available yet.');
      $('aiPromptText').value = window.MiraclesPrompt.build(listed.tools, 'Wait for the user task and complete it using the available Studio tools.');
      await client.copy($('aiPromptText').value);
      client.report('Instructions copied. Paste them into your chat, then choose Miracle → Watch this chat to execute tool replies.', false);
    } catch (error) {
      $('aiPromptText').focus(); $('aiPromptText').select();
      client.report(error.message + ' Select the text to copy it manually, or use Start session in the extension.', true);
    }
  });
  $('runCode').addEventListener('click', () => execute(editor.value));
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); execute(editor.value); }
  });
  function changed() {
    $('codeLength').textContent = `${editor.value.length.toLocaleString('en-US')} / 20 000`;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { try { localStorage.setItem('miracle.preview.code', editor.value); } catch { result('Draft not saved', 'Browser storage is unavailable. Copy the code before closing this page.', 'error'); } }, 400);
  }
  editor.addEventListener('input', changed);
  $('sampleCode').onclick = () => { editor.value += (editor.value.trim() ? '\n\n' : '') + '--!strict\nreturn "Miracle is connected"'; changed(); editor.focus(); client.report('Sample appended. Select Run in Studio.', false); };
  $('clearCode').onclick = () => { editor.value = ''; changed(); editor.focus(); client.report('Editor cleared.', false); };
  async function copy(text, message) {
    try { if (!text.trim()) throw new Error('Nothing to copy.'); await client.copy(text); client.report(message, false); }
    catch (error) { client.report(error.message); }
  }
  $('copyCode').onclick = () => copy(editor.value, 'Code copied.');
  $('copyResult').onclick = () => copy($('executionTitle').textContent + '\n' + $('executionOutput').textContent, 'Result copied.');
  $('assetForm').onsubmit = event => {
    event.preventDefault();
    const id = $('assetId').value.trim();
    const numericId = Number(id);
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(numericId) || numericId <= 0) { result('Invalid Asset ID', 'Enter a positive Roblox model ID, up to 16 digits.', 'error'); return; }
    execute(`--!strict\nlocal assetUri = "rbxassetid://${id}"\nlocal assetId = assert(tonumber(assetUri:match("%d+")), "Invalid Asset ID")\nlocal ok, model = pcall(function() return game:GetService("InsertService"):LoadAsset(assetId) end)\nif not ok then error(tostring(model)) end\nif not model then error("Asset " .. tostring(assetId) .. ": model not found or unavailable") end\nmodel.Parent = workspace\nreturn "Inserted model: " .. model:GetFullName()`);
  };
  try { editor.value = localStorage.getItem('miracle.preview.code') || ''; } catch { /* optional draft */ }
  $('codeLength').textContent = `${editor.value.length.toLocaleString('en-US')} / 20 000`;
  try {
    const job = JSON.parse(sessionStorage.getItem('miracle.preview.pending') || 'null');
    if (job && Number.isInteger(job.id) && typeof job.host === 'string' && Number.isFinite(job.created)) {
      result(`Waiting for result #${job.id}`, 'Waiting resumed after reload. The code was not sent again.', 'pending');
      waitForJob(job);
    }
  } catch { /* invalid browser-local state */ }
})();
