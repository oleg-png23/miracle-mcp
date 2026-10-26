/* Explain the difference between Studio connectivity and a running chat agent.
   Support reports contain operational fields only, never credentials or chat. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const label = $('agentState'), hint = $('agentHint'), copy = $('copyDiagnostics');
  if (!label || !hint || !copy) return;
  let latest = null;
  const labels = {starting:'Starting the chat session',watching:'Chat reader active',waiting_json:'Waiting for complete tool JSON',
    running:'Running a Studio tool',sending_result:'Sending the result to chat',paused:'Chat session paused',stopped:'Chat session stopped'};
  function set(el, value) { if (el.textContent !== value) el.textContent = value; }
  function render(data, host) {
    latest = {data, host};
    const agent = data.agent_sessions?.find(item => !['paused','stopped'].includes(item.state) && item.age_s <= 45) || data.agent_sessions?.[0];
    const active = agent && !['paused','stopped'].includes(agent.state) && agent.age_s <= 45;
    $('chatAgent').dataset.state = active ? 'active' : 'idle';
    if (data.version && document.body.dataset.appVersion && data.version !== document.body.dataset.appVersion) {
      set(label,'Update the running bridge');
      set(hint,`Dashboard ${document.body.dataset.appVersion}; bridge ${data.version}. Run the new release/run.bat, reload the extension and refresh the chat tab.`);
    } else if (!agent) {
      set(label,'No chat session detected');
      set(hint,'Studio can be connected while the chat reader is stopped. In your AI tab, choose Helium → Start session, or Watch this chat after pasting instructions.');
    } else if ((agent.client_version && agent.client_version !== data.version) || (agent.extension_version && agent.extension_version !== data.version)) {
      set(label,'Reload the extension and your chat tab');
      set(hint,`Bridge ${data.version}; extension ${agent.extension_version || 'unknown'}; chat script ${agent.client_version || 'unknown'}. Finish updating all three before starting a new session.`);
    } else if (agent.age_s > 45 && !['paused','stopped'].includes(agent.state)) {
      set(label,'Chat heartbeat is out of date');
      set(hint,`${agent.site} last checked in ${agent.age_s}s ago. Return to that tab and check the Helium session status.`);
    } else {
      set(label,(labels[agent.state] || 'Chat session') + (agent.tool_name && agent.state === 'running' ? ` · ${agent.tool_name}` : ''));
      const advice = agent.code === 'RESULT_NOT_SENT' ? 'The result is saved in the chat widget. Use Retry sending result; it does not run the tool again.'
        : agent.state === 'waiting_json' ? 'The AI reply needs a complete Helium tool envelope. The reader is still watching for changes.'
        : agent.state === 'paused' || agent.state === 'stopped' ? 'Open Helium in that chat to resume, retry a saved result or start a new session.'
        : 'Tool results return to the same conversation automatically.';
      set(hint,`${agent.site} · ${agent.calls} tool call${agent.calls === 1 ? '' : 's'}. ${advice}`);
    }
  }
  document.addEventListener('miracles:status', event => render(event.detail.data,event.detail.host));
  document.addEventListener('miracles:offline', () => {
    latest = null;set(label,'Bridge unavailable');set(hint,'Run release/run.bat, then check the connection. Chat sessions appear here once the bridge is online.');
  });
  copy.addEventListener('click', async () => {
    if (!latest) { window.MiraclesBridge.report('Connect the bridge before copying a report.'); return; }
    const {data,host} = latest;
    const report = {product:'Helium MCP',dashboard_version:document.body.dataset.appVersion,bridge_version:data.version,
      address:host,studio_state:data.native_mcp?.state,tools_count:data.native_mcp?.tools_count,
      studio_linked:data.studio_linked === true,uptime_s:data.uptime_s,
      agents:(data.agent_sessions || []).map(agent => ({site:agent.site,state:agent.state,code:agent.code,calls:agent.calls,
        age_s:agent.age_s,client_version:agent.client_version,extension_version:agent.extension_version}))};
    try { await window.MiraclesBridge.copy(JSON.stringify(report,null,2));window.MiraclesBridge.report('Connection report copied. It contains no token, chat text, code or tool results.',false); }
    catch (error) { window.MiraclesBridge.report(error.message); }
  });
})();
