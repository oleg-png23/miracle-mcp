(() => {
  'use strict';
  const root=document.getElementById('setupGuide');if(!root)return;
  root.innerHTML=`<div class="panel-heading"><div><h2 id="setupGuideTitle">Setup</h2><p>Connect once, then start a session from your chat.</p></div></div>
    <div class="guide-status" role="status" aria-live="polite"><strong data-guide-state-title>Checking Studio</strong><p data-guide-state-message>Waiting for connection status.</p></div>
    <ol class="setup-steps">
      <li><b>Enable Studio MCP.</b> Open your place, then choose <code>Assistant → … → Manage MCP Servers → Enable Studio as MCP Server</code>.</li>
      <li><b>Start the bridge.</b> Run <code>release/run.bat</code> from an extracted download, or <code>run.bat</code> from a source checkout. Keep the <code>plugin</code> and <code>release</code> folders together. The connection token is set automatically.</li>
      <li><b>Load the extension.</b> Open <code>edge://extensions</code> or <code>chrome://extensions</code>, enable Developer mode and select Load unpacked. Choose the <code>plugin</code> folder from the download, containing <code>manifest.json</code> (or the source repository root). After updating the files, reload the extension and your chat tab.</li>
      <li><b>Start a chat session.</b> Open your AI chat, select <b>Miracle → Start session</b>, then describe what you want to change in Studio.</li>
    </ol><div class="row"><button class="button button-primary button-small" type="button" data-guide-check>Check connection</button><a class="button button-small" href="welcome.html">Welcome</a></div>
    <details class="guide-details"><summary>Troubleshooting</summary><dl class="troubleshooting">
      <dt>Studio is not connected</dt><dd>Open a place and enable Studio MCP in Assistant. Keep Studio and the bridge running.</dd>
      <dt>The Miracle button is missing</dt><dd>Reload the extension and your chat tab. Edge blocks extensions on <code>copilot.microsoft.com</code>; use another supported AI chat.</dd>
      <dt>Notion or ClickUp</dt><dd>Open Notion AI chat or ClickUp Brain Chat first. Ordinary document editors and task fields are not chat composers.</dd>
      <dt>The AI service asks you to sign in</dt><dd>Sign in on that site. Miracle uses your existing AI account.</dd>
      <dt>A tool returns an error</dt><dd>Read the tool result and events. Check the scene before retrying a call that timed out.</dd>
    </dl></details>`;
  root.querySelector('[data-guide-check]').onclick=()=>document.getElementById('checkConnection').click();
  const labels={ready:['Studio connected','Start a session from Miracle in your AI chat.'],missing:['Studio MCP unavailable','Update Roblox Studio and open your place.'],studio_closed:['Studio closed','Open your place in Roblox Studio.'],mcp_disabled:['Enable Studio MCP','In Studio, open Assistant → … → Manage MCP Servers → Enable Studio as MCP Server.'],connecting:['Connecting to Studio','Waiting for Studio MCP.'],error:['Studio MCP error','Check the connection and events.']};
  function show(title,message){root.querySelector('[data-guide-state-title]').textContent=title;root.querySelector('[data-guide-state-message]').textContent=message;}
  document.addEventListener('miracles:status',event=>{const native=event.detail?.data?.native_mcp;const state=native?.state||'connecting';show(...(labels[state]||labels.connecting));});
  document.addEventListener('miracles:offline',event=>show('Bridge offline',event.detail?.message||'Start run.bat and check the connection.'));
})();
