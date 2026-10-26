(() => {
  'use strict';
  const client = window.MiraclesBridge;
  const status = document.getElementById('welcomeStatus');
  const detail = document.getElementById('welcomeStatusDetail');
  const refresh = document.getElementById('welcomeRefresh');
  let clockTimer = 0, connectionTimer = 0, feedbackTimer = 0, checking = false, settings;
  function updateTime() {
    clearTimeout(clockTimer);
    const date = new Date(), node = document.getElementById('welcomeTime');
    node.textContent = new Intl.DateTimeFormat('en-US', {hour:'2-digit', minute:'2-digit', hour12:false}).format(date);
    node.dateTime = date.toISOString();
    if (!document.hidden) clockTimer = setTimeout(updateTime, (60 - date.getSeconds()) * 1000 - date.getMilliseconds() + 50);
  }
  async function checkConnection() {
    clearTimeout(connectionTimer);
    if (checking || document.hidden) return;
    checking = true;
    refresh.setAttribute('aria-busy', 'true');
    refresh.disabled = true;
    try {
      settings = settings || await client.storage.read();
      const data = await client.request(settings.host, '/api/status', undefined, 5000);
      const diagnosis = client.diagnose(data);
      const ready = data.online === true && diagnosis.state === 'linked';
      document.body.dataset.studioReady = String(ready);
      status.textContent = ready ? 'Studio MCP connected' : data.online === true ? diagnosis.title : 'Start the local bridge';
      detail.textContent = data.online === true ? diagnosis.message : 'Run release/run.bat from the extracted download (or run.bat in a source checkout), then check the connection.';
    } catch {
      document.body.dataset.studioReady = 'false';
      status.textContent = 'Start the local bridge';
      detail.textContent = 'Run release/run.bat from the extracted download (or run.bat in a source checkout), then check the connection.';
    } finally {
      checking = false;
      refresh.disabled = false;
      refresh.setAttribute('aria-busy', 'false');
      if (!document.hidden) connectionTimer = setTimeout(checkConnection, 20000);
    }
  }
  async function initialize() {
    updateTime();
    try {
      settings = await client.storage.read();
      const material = window.MiracleAppearance.normalizeMaterial(settings.dashboardMaterial);
      document.body.dataset.glassMode = material;
      const system = settings.dashboardMaterial === 'light' && matchMedia('(prefers-reduced-transparency: reduce)').matches;
      document.body.dataset.glassChoice = system ? 'system' : material;
      if(!system&&settings.dashboardMaterial!==material)await client.storage.set({dashboardMaterial:material});
      const theme=window.MiracleAppearance.normalize(settings.dashboardWallpaper);
      const applied=await window.MiracleAppearance.setMode('manual',theme);
      if(applied&&(settings.dashboardWallpaper!==theme||settings.dashboardWallpaperMode!=='manual'))await client.storage.set({dashboardWallpaper:theme,dashboardWallpaperMode:'manual'});
      window.DashboardGlass?.setDepth(settings.dashboardGlassDepth ?? 68);
      window.DashboardGlass?.refresh();
    } catch {
      window.MiracleAppearance.setMode('manual','lime');
    }
    checkConnection();
  }
  refresh.addEventListener('click', checkConnection);
  document.querySelectorAll('[data-copy-prompt]').forEach(button => {
    button.addEventListener('click', async () => {
      const feedback = document.getElementById('promptFeedback');
      clearTimeout(feedbackTimer);
      const prompt=window.MiraclePrompts?.prepareCopy(button)||button.dataset.copyPrompt;
      try { await client.copy(prompt); feedback.textContent = 'Copied. Bring it to your AI chat.'; }
      catch { feedback.textContent = 'Select the prompt text and copy it.'; }
      feedbackTimer = setTimeout(() => { feedback.textContent = 'Copy a prompt for your chat'; }, 5000);
    });
  });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(connectionTimer);
    updateTime();
    if (!document.hidden) checkConnection();
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(clockTimer); clearTimeout(connectionTimer); clearTimeout(feedbackTimer);
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { updateTime(); checkConnection(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once:true});
  else initialize();
})();
