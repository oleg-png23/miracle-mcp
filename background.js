/* MV3 worker: bounded loopback requests, structured errors, one dashboard. */
importScripts('config.js');
const CFG = self.MIRACLES_CONFIG || {};
const DEFAULT_HOST = `${CFG.MCP_HOST || '127.0.0.1'}:${CFG.MCP_PORT || 19731}`;
const WELCOME_COOLDOWN_MS = 5 * 60 * 60 * 1000;
let openingPage = null;

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') openDashboard('welcome').catch(console.error);
  else if (details.reason === 'update') openDashboard('startup').catch(console.error);
});
chrome.runtime.onStartup.addListener(() => openDashboard('startup').catch(console.error));
chrome.action.onClicked.addListener(() => openDashboard().catch(console.error));
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'MCP_AGENT_STATE') {
    let source;
    try { source = new URL(sender.tab?.url || sender.url); } catch { reply({ok:false,message:'Chat source is unavailable.'}); return; }
    if (!Number.isInteger(sender.tab?.id) || source.protocol !== 'https:') { reply({ok:false,message:'Agent state requires a chat tab.'}); return; }
    // Only these fields leave the extension. Ignore caller-supplied URLs,
    // tokens, arguments and text; identify the real sender tab ourselves.
    apiPost('/api/agent/state', {client_id:'tab:'+sender.tab.id,site:source.hostname,
      session_id:message.session_id,state:message.state,code:typeof message.code==='string'?message.code.toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,80):'',tool_name:message.tool_name||'',
      calls:message.calls,client_version:message.client_version||'',extension_version:chrome.runtime.getManifest?.().version||''})
      .then(reply,error=>reply({ok:false,message:error.message}));
    return true;
  }
  if (message.type === 'MCP_USAGE') {
    let site;
    try { site = new URL(sender.tab?.url || sender.url).hostname.toLowerCase(); }
    catch { reply({ok:false,message:'Usage source is unavailable.'}); return; }
    if (!site || !sender.tab) { reply({ok:false,message:'Usage events require a chat tab.'}); return; }
    apiPost('/api/usage/event', {event_id:message.event_id,kind:message.kind,characters:message.characters,site})
      .then(reply,error=>reply({ok:false,message:error.message}));
    return true;
  }
  if (message.type === 'MCP_TOOLS') { toolsList().then(reply, error => reply({ok:false,code:'TOOLS_FAILED',message:error.message})); return true; }
  if (message.type === 'MCP_CALL') {
    callTool(message).then(reply, error => reply({ok:false,code:'TOOL_FAILED',message:error.message})); return true;
  }
  if (message.type === 'MCP_OPEN_PANEL') {
    openDashboard().then(() => reply({ ok: true }), () => reply({ ok: false, code: 'OPEN_FAILED', message: 'Could not open the workspace. Use the Miracle icon in the browser toolbar.' }));
    return true;
  }
  if (['MCP_PING', 'MCP_HEALTH'].includes(message.type)) {
    checkBridgeHealth().then(reply, () => reply({ online: false, code: 'SETTINGS_ERROR', message: 'Could not read extension settings. Open the workspace and save the connection again.' }));
    return true;
  }
});

function openDashboard(reason = 'launch') {
  // Worker wakeups and simultaneous clicks share one launch decision.
  if (openingPage) return openingPage;
  openingPage = openPage(reason).finally(() => { openingPage = null; });
  return openingPage;
}
async function openPage(reason) {
  const saved = await chrome.storage.local.get('welcomeLastShownAt');
  const now = Date.now(), last = Number(saved.welcomeLastShownAt);
  const due = !Number.isFinite(last) || last <= 0 || now < last || now - last >= WELCOME_COOLDOWN_MS;
  const welcome = reason === 'welcome' || due;
  // Browser startup stays quiet during cooldown; a toolbar click still opens
  // the workspace immediately. Timestamps persist across worker restarts.
  if (reason === 'startup' && !due) return;
  const file = welcome ? 'welcome.html' : 'dashboard.html';
  const url = chrome.runtime.getURL(file);
  const tabs = await chrome.tabs.query({url});
  const existing = tabs.find(tab => Number.isInteger(tab.id) && (tab.url === url || tab.pendingUrl === url));
  if (existing) {
    await chrome.tabs.update(existing.id, {active: true});
    if (Number.isInteger(existing.windowId)) await chrome.windows.update(existing.windowId, {focused: true});
  } else await chrome.tabs.create({url});
  if (welcome) await chrome.storage.local.set({welcomeLastShownAt: now});
}

async function checkBridgeHealth() {
  try {
    let config=await bridgeConfig(true);
    let auth=await verifyBridgeToken(config);
    if(auth.status===401) { await bootstrap(config.base); config=await bridgeConfig(true); auth=await verifyBridgeToken(config); }
    if(!auth.response?.ok||auth.data?.ok!==true) return {online:true,authenticated:false,code:'TOKEN_REJECTED',message:auth.data?.message||'The bridge rejected the refreshed token.'};
    const response=await fetch(config.base+'/api/status',{cache:'no-store',signal:AbortSignal.timeout(6000)});
    if(!response.ok) return {online:false,authenticated:true,code:'HTTP_'+response.status,message:`The bridge returned HTTP ${response.status} while checking status.`};
    const info=await response.json();
    if(info.online!==true) return {online:false,authenticated:true,info,code:'OFFLINE',message:'The local bridge is not running.'};
    const installedVersion=chrome.runtime.getManifest?.().version;
    if(installedVersion&&info.version&&installedVersion!==info.version)return {online:true,authenticated:true,info,instance_id:info.instance_id,code:'VERSION_MISMATCH',message:`Bridge ${info.version} and extension ${installedVersion} are different versions. Run the new release/run.bat, reload the extension and refresh this chat.`};
    const native=info.native_mcp||{};
    if(info.studio_linked!==true||native.state!=='ready') {
      const state=String(native.state||'studio_closed');
      const messages={
        missing:'Studio MCP is unavailable. Update Roblox Studio, open a place and check again.',
        studio_closed:'The bridge is online. Open a place in Roblox Studio to connect MCP.',
        mcp_disabled:'In Roblox Studio, open Assistant → … → Manage MCP Servers → Enable Studio as MCP Server.',
        connecting:'Roblox Studio is connecting to MCP. Please wait and check again.',
        error:'Roblox Studio MCP returned an error. Check the connection and try again.'
      };
      const message=messages[state]||'Studio MCP is not ready (state: '+state+'). Check Studio MCP.';
      return {online:true,authenticated:true,info,instance_id:info.instance_id,native_state:state,studio_linked:info.studio_linked===true,code:state,message};
    }
    return {online:true,authenticated:true,info,instance_id:info.instance_id,native_state:'ready',studio_linked:true,code:'READY',message:'Roblox Studio MCP is connected. Tools are ready.'};
  } catch(e) { return {online:false,authenticated:false,code:e.code||'OFFLINE',message:e.message||'Could not connect to the local bridge.'}; }
}
async function verifyBridgeToken(config) {
  let response; try { response=await fetch(config.base+'/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:config.token}),cache:'no-store',signal:AbortSignal.timeout(6000)}); }
  catch { throw Object.assign(new Error('Could not verify bridge authentication.'),{code:'AUTH_OFFLINE'}); }
  let data; try { data=await response.json(); } catch { data={}; }
  return {response,data,status:response.status};
}
async function bridgeConfig(allowBootstrap=false) {
  const settings=await chrome.storage.local.get(['host','bridgeToken','bridgeInstanceId']);
  const raw=String(settings.host||DEFAULT_HOST).trim();
  let url;
  try { url=new URL(/^https?:\/\//i.test(raw)?raw:'http://'+raw);
    if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol!=='http:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash) throw new Error();
  } catch { throw Object.assign(new Error('The local bridge address is invalid.'),{code:'INVALID_HOST'}); }
  let token=String(settings.bridgeToken||'').trim(); let instance_id=settings.bridgeInstanceId||null; let base=url.origin;
  if (!token && allowBootstrap) { const result=await bootstrap(base); token=result.bridgeToken; base=result.base; instance_id=result.instance_id||instance_id; }
  if (!token) throw Object.assign(new Error('Could not obtain the bridge token automatically.'),{code:'TOKEN_MISSING'});
  return {base,token,instance_id};
}
async function bootstrap(base) {
  let response; try { response=await fetch(base+'/api/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store',signal:AbortSignal.timeout(10000)}); }
  catch(e) { throw Object.assign(new Error('Could not obtain a token from the bridge.'),{code:'BRIDGE_OFFLINE'}); }
  let data; try { data=await response.json(); } catch { throw Object.assign(new Error('The bridge returned an invalid token response.'),{code:'INVALID_RESPONSE'}); }
  if (!response.ok||!data?.bridgeToken) throw Object.assign(new Error(data?.message||`Could not obtain token: HTTP ${response.status}`),{code:data?.code||'BOOTSTRAP_FAILED'});
  const saved={bridgeToken:String(data.bridgeToken)};
  if (data.host) saved.host=String(data.host);
  if (data.instance_id) saved.bridgeInstanceId=String(data.instance_id);
  await chrome.storage.local.set(saved);
  const raw=String(saved.host||base).trim(); const url=new URL(/^https?:\/\//i.test(raw)?raw:'http://'+raw);
  return {base:url.origin,bridgeToken:saved.bridgeToken,instance_id:data.instance_id||null};
}
async function apiPost(path, body, retryAfterBootstrap=true) {
  const config=await bridgeConfig(true);
  let response; try { response=await fetch(config.base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:config.token,...body}),cache:'no-store',signal:AbortSignal.timeout(path.endsWith('/call')?75000:20000)}); }
  catch(e) { throw Object.assign(new Error('Could not reach the local bridge.'),{code:'BRIDGE_OFFLINE'}); }
  let data; try { data=await response.json(); } catch { throw Object.assign(new Error('The bridge returned an invalid response.'),{code:'INVALID_RESPONSE'}); }
  if (response.status===401&&retryAfterBootstrap) {
    const boot=await bootstrap(config.base);
    if (path.endsWith('/call')) throw Object.assign(new Error('The bridge token or instance changed. Start a new session.'),{code:'BRIDGE_RESTARTED',instance_id:boot.instance_id});
    return apiPost(path,body,false);
  }
  if (!response.ok) throw Object.assign(new Error(data?.message||`The bridge returned HTTP ${response.status}`),{code:data?.code||'HTTP_'+response.status,instance_id:data?.instance_id||config.instance_id});
  return {...data,instance_id:data?.instance_id||config.instance_id};
}
async function toolsList() {
  try { const data=await apiPost('/api/tools/list',{});
    if(data?.ok!==true||!Array.isArray(data.tools)) return {ok:false,code:data?.code||'INVALID_TOOLS',message:data?.message||'The bridge returned an invalid tool catalog.',instance_id:data?.instance_id};
    return {ok:true,tools:data.tools,instance_id:data.instance_id};
  } catch(e) { return {ok:false,code:e.code||'TOOLS_FAILED',message:e.message,instance_id:e.instance_id}; }
}
async function callTool(message) {
  if(typeof message.name!=='string'||!message.name||!message.arguments||typeof message.arguments!=='object'||Array.isArray(message.arguments)||typeof message.call_id!=='string'||!message.call_id)
    return {ok:false,code:'INVALID_CALL',message:'A tool name, arguments object and call ID are required.'};
  try {
    if(message.instance_id) { const latest=await fetch((await bridgeConfig(true)).base+'/api/status',{cache:'no-store',signal:AbortSignal.timeout(5000)}); const state=await latest.json();
      if(state.instance_id&&state.instance_id!==message.instance_id) return {ok:false,code:'BRIDGE_RESTARTED',message:'The bridge instance changed. Start a new session before using tools.',instance_id:state.instance_id}; }
    const data=await apiPost('/api/tools/call',{name:message.name,arguments:message.arguments,call_id:message.call_id});
    if(data?.ok!==true) return {ok:false,code:data?.code||'TOOL_FAILED',message:data?.message||'Tool call failed.',instance_id:data?.instance_id};
    if(message.instance_id&&data.instance_id&&message.instance_id!==data.instance_id) return {ok:false,code:'BRIDGE_RESTARTED',message:'The bridge restarted during the call. The result is unconfirmed.',instance_id:data.instance_id};
    return {ok:true,result:data.result,instance_id:data.instance_id};
  } catch(e) { return {ok:false,code:e.code||'TOOL_FAILED',message:e.message,instance_id:e.instance_id}; }
}
