/* A stable, isolated launcher on every supported page, independent of Send.
 * Editors are discovered only after a user action. No polling or DOM observer. */
(() => {
  'use strict';
  if (document.getElementById('miracles-mcp-widget')) return;
  const { marker: MARKER, intro: INTRO } = globalThis.MiraclesPrompt;

  const siteEditors = {
    'chatgpt.com': '#prompt-textarea,textarea[data-id="root"]',
    'claude.ai': '.ProseMirror[contenteditable="true"],[data-testid="chat-input"]',
    'gemini.google.com': 'input-area-v2 .ql-editor[contenteditable="true"],rich-textarea [contenteditable="true"],.ql-editor[contenteditable="true"]',
    'chat.deepseek.com': '#chat-input,textarea:not(.ds-textarea)',
    'chat.qwen.ai': 'textarea.message-input-textarea',
    'chat.z.ai': 'textarea#chat-input',
    'arena.ai': 'form textarea',
    'meta.ai': '[data-testid="composer-input"] textarea,[data-testid="composer-input"][contenteditable="true"]',
    'grok.com': 'textarea,[contenteditable="true"][role="textbox"]',
    'copilot.microsoft.com': '#userInput,textarea,[contenteditable="true"]',
    'perplexity.ai': 'textarea,[contenteditable="true"][role="textbox"]',
    'chat.mistral.ai': 'textarea,.ProseMirror[contenteditable="true"]',
    'poe.com': 'textarea',
    'kimi.com': '.chat-editor .chat-input-editor[contenteditable="true"]',
    'kimi.ai': '.chat-editor .chat-input-editor[contenteditable="true"]'
  };
  const readerConfigs = {
    'chatgpt.com': { selectors: '[data-message-author-role="assistant"]', send: '#composer-submit-button,[data-testid="send-button"]', stop: '[data-testid="stop-button"]' },
    'claude.ai': { selectors: '[data-testid="assistant-message"],.font-claude-response' },
    'gemini.google.com': { selectors: 'model-response message-content,model-response', exclude: 'model-thoughts', send: 'input-area-v2 button' },
    'chat.deepseek.com': { selectors: '.ds-message:not(.d29f3d7d) .ds-markdown', exclude: '.ds-think-content' },
    'chat.qwen.ai': { selectors: '.qwen-chat-message-assistant .response-message-content.phase-answer', send: 'button.send-button', stop: 'button.stop-button' },
    'chat.z.ai': { selectors: '.chat-assistant .markdown-prose', exclude: '.thinking-chain-container', send: '#send-message-button' },
    'arena.ai': { selectors: 'ol.flex-col-reverse > li', send: 'button[aria-label*="send" i],button[aria-label*="envoyer" i]' },
    'meta.ai': { selectors: '[data-testid="assistant-message"]', exclude: '[data-testid*="thinking-status"],[data-testid*="subagent"],.thinking-status,.subagent', send: '[data-testid="composer-send-button"]', stop: '[data-testid="composer-stop-button"]' },
    'kimi.com': { selectors: '.segment-assistant .segment-content-box', exclude: '.thinking-container', send: '.send-button-container' },
    'kimi.ai': { selectors: '.segment-assistant .segment-content-box', exclude: '.thinking-container', send: '.send-button-container' }
  };
  const host = document.createElement('div');
  host.id = 'miracles-mcp-widget';
  host.style.cssText = 'position:fixed!important;right:16px!important;bottom:24px!important;z-index:2147483647!important;display:block!important;width:auto!important;height:auto!important;pointer-events:none!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const css = `
    :host{all:initial;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;line-height:1.5}
    *{box-sizing:border-box}button,textarea{font:inherit}button{cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}button:disabled{cursor:wait;opacity:.58}[hidden]{display:none!important}
    .widget{pointer-events:none;width:min(350px,calc(100vw - 28px));color:#e6f4f1;font:13px/1.55 Inter,ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}.panel,.toggle{pointer-events:auto}
    .toggle{display:flex;align-items:center;gap:10px;margin-left:auto;max-width:100%;border:1px solid #7ce1c366;border-radius:15px;padding:8px 13px 8px 9px;background:linear-gradient(145deg,#123b3a,#102b32);color:#f3fffc;box-shadow:0 8px 30px #06191c99,inset 0 1px #ffffff12;text-align:left;font-size:12px;font-weight:650;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
    .toggle:hover{transform:translateY(-2px);border-color:#7ce1c3aa;box-shadow:0 11px 32px #06191cbb,inset 0 1px #ffffff18}.toggle:active{transform:translateY(0)}.toggle-copy{display:block;line-height:1.25}.toggle small{display:block;margin-top:3px;font-size:10px;font-weight:450;color:#a9c9c4}.glyph{width:30px;height:30px;display:grid;place-items:center;border-radius:10px;background:#54d8b322;color:#8ff0d4;flex:none}.glyph svg{width:19px;height:19px;display:block}
    .panel{margin-bottom:10px;border:1px solid #69c9b14a;border-radius:18px;background:linear-gradient(145deg,#102629f5,#111b23f5);box-shadow:0 20px 60px #020b0dcc,0 2px 10px #0006;backdrop-filter:blur(18px) saturate(135%);-webkit-backdrop-filter:blur(18px) saturate(135%);max-height:calc(100dvh - 110px);overflow:auto;padding:17px;color:#e6f4f1;overscroll-behavior:contain}
    .panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.brand{display:flex;align-items:center;gap:10px;min-width:0}.brand-mark{width:34px;height:34px;display:grid;place-items:center;flex:none;border:1px solid #5be0bc3d;border-radius:11px;background:#51d7b31a;color:#7be6c8}.brand-mark svg{width:21px;height:21px}h2{font-size:15px;font-weight:680;letter-spacing:-.35px;margin:0;color:#f1fbf8}.eyebrow{display:block;margin-top:1px;color:#8aa9a6;font-size:10px;letter-spacing:.06em;text-transform:uppercase}.intro{margin:13px 0 15px;color:#a8c0bd;font-size:12px;line-height:1.55}.close{border:1px solid transparent;border-radius:9px;background:transparent;padding:4px 9px;font-size:18px;line-height:1.2;color:#9fb8b4}.close:hover{background:#ffffff0d;border-color:#ffffff12;color:#fff}
    .actions{display:grid;gap:8px}.action{border:1px solid #526c6b80;border-radius:11px;padding:10px 12px;color:#d9eeea;background:#1a3034;text-align:left;font-size:12px;font-weight:570;transition:background .15s ease,border-color .15s ease,transform .15s ease}.action:hover{background:#213c3f;border-color:#668c85}.action:active{transform:translateY(1px)}.primary{background:linear-gradient(135deg,#41c9a2,#219d88);color:#06251f;border-color:#55dfb6;font-weight:700;box-shadow:0 5px 18px #2bb89424}.primary:hover{background:linear-gradient(135deg,#65dfba,#35b99c);border-color:#8ff3d3}.secondary{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    button:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid #76e5c5;outline-offset:3px}.status{margin:12px 0 0;border:1px solid #54797580;border-radius:11px;background:#152d30;padding:10px 12px;font-size:12px;white-space:pre-wrap;color:#c5ddda}.status[data-kind="error"]{background:#382622;border-color:#9c6556;color:#ffd0c2}.status[data-kind="success"]{background:#15372f;border-color:#4eaa86;color:#a8f0d2}.status[data-kind="waiting"]{background:#332f20;border-color:#9d8952;color:#f1dfa4}
    details{margin-top:13px}summary{font-size:11px;color:#9bb8b4;cursor:pointer;padding:4px 0}textarea{display:block;width:100%;min-height:130px;margin-top:8px;resize:vertical;border:1px solid #486360;border-radius:9px;padding:9px;font-size:11px;line-height:1.6;color:#dff1ed;background:#0d1c20}
    @media(max-width:450px){:host{font-size:14px}.widget{width:calc(100vw - 24px)}.panel{max-height:calc(100dvh - 96px);padding:15px}.toggle{padding:8px 12px 8px 8px}textarea{font-size:16px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
    @media(forced-colors:active){.panel,.toggle,.action,.status{background:Canvas;color:CanvasText;border:1px solid CanvasText}}
    .monogram{position:relative;display:inline-block;font:600 29px/1 system-ui,sans-serif;letter-spacing:-3px;padding-right:5px;color:currentColor}.monogram>span{position:absolute;right:-3px;top:-2px;font:14px/1 system-ui,sans-serif;letter-spacing:0}
    .toggle{gap:9px;border-radius:999px;padding:11px 18px 11px 13px;background:#fffffff5;border:1px solid #ffffffb0;color:#263b42;box-shadow:0 5px 24px #0a152b25,inset 0 1px #fff;font-size:13px;font-weight:550;letter-spacing:-.15px;transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s,background .25s}
    .toggle:hover{background:#fff;transform:translateY(-2px);border-color:#fff;box-shadow:0 9px 28px #0a152b30}.toggle:active{transform:scale(.96)}.toggle small{display:none}.toggle-copy{line-height:1.2}
    .toggle .glyph{position:relative;width:23px;height:23px;border-radius:50%;background:transparent;color:#263b42}.toggle .monogram{font-size:23px;transition:opacity .25s,transform .4s}.toggle .monogram>span{font-size:10px;top:-1px;right:-1px}
    .toggle-state-icon{position:absolute;inset:0;width:23px!important;height:23px!important;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;overflow:visible}
    .state-ring{stroke:#95a2a8;stroke-dasharray:35 65;opacity:0;transform-origin:center}.state-check,.state-cross{stroke-dasharray:32;stroke-dashoffset:32;opacity:0;transition:stroke-dashoffset .45s cubic-bezier(.2,.8,.2,1),opacity .2s,transform .4s;transform:scale(.7);transform-origin:center}.state-check{stroke:#299d65}.state-cross{stroke:#ee5253}
    .toggle:is([data-state="waiting"],[data-state="success"],[data-state="active"],[data-state="error"]) .monogram{opacity:0;transform:scale(.7)}
    .toggle[data-state="waiting"] .state-ring{opacity:1;animation:state-spin .9s linear infinite}
    .toggle:is([data-state="success"],[data-state="active"]) .state-check,.toggle[data-state="error"] .state-cross{stroke-dashoffset:0;opacity:1;transform:scale(1)}
    .panel:not([hidden]){animation:panel-in .32s cubic-bezier(.2,.8,.2,1) both}.brand-mark{color:#e9faf3}.brand-mark .monogram{font-size:29px}
    @keyframes state-spin{to{transform:rotate(360deg)}}@keyframes panel-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
    @media(max-width:450px){.toggle{padding:11px 17px 11px 13px}}
    @media(prefers-reduced-motion:reduce){.toggle,.toggle *,.panel:not([hidden]){animation:none!important;transition:none!important}}
    @media(forced-colors:active){.toggle{background:ButtonFace;color:ButtonText;border:1px solid ButtonText}.state-check,.state-cross,.state-ring{stroke:ButtonText}}
  `;
  // Constructed sheets and DOM methods work with strict CSP/Trusted Types.
  // No host-page HTML sink, external stylesheet request, or page CSS dependency.
  try {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style'); style.textContent = css; shadow.append(style);
  }
  function node(tag, attrs, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) element.setAttribute(key, value);
    element.append(...children); return element;
  }
  function mark() { return node('span', {class:'monogram','aria-hidden':'true'}, 'm', node('span',{},'✦')); }
  const button = (id, label, className = 'action') => node('button', { id, type: 'button', class: className }, label);
  const close = button('close', '×', 'close'); close.setAttribute('aria-label', 'Close Miracle');
  shadow.append(node('div', { class: 'widget' },
    node('section', { class: 'panel', id: 'panel', 'aria-label': 'Miracle for Roblox Studio', hidden: '' },
      node('header', { class: 'panel-head' }, node('div', { class: 'brand' }, node('span', { class: 'brand-mark' }, mark('')), node('div', {}, node('h2', {}, 'Miracle'), node('span', { class: 'eyebrow' }, 'Studio MCP'))), close),
      node('p', { class: 'intro' }, 'Connect this chat to Roblox Studio.'),
      node('div', { class: 'actions' },
        button('copy', 'Copy instructions'),
        node('div', { class: 'secondary' }, button('check', 'Check connection'), button('dashboard', 'Open workspace'))),
      node('div', { class: 'status', id: 'status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-kind': 'info' }, 'Start a session to connect this chat to Studio tools.'),
      node('details', { id: 'manual' }, node('summary', {}, 'AI instructions'), node('textarea', { id: 'prompt', readonly: '', 'aria-label': 'Miracle AI instructions', spellcheck: 'false' }))),
    node('button', { class: 'toggle', id: 'toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'panel', title: 'Open Miracle for Roblox Studio' }, node('span', { class: 'glyph' }, mark('')), node('span', { class: 'toggle-copy' }, 'Miracle', node('small', {}, 'Connect Studio')))));
  document.documentElement.append(host);
  const $ = id => shadow.getElementById(id);
  const stateIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');
  stateIcon.setAttribute('viewBox','0 0 24 24');stateIcon.setAttribute('class','toggle-state-icon');stateIcon.setAttribute('aria-hidden','true');
  for(const [className,tag,attrs] of [
    ['state-ring','circle',{cx:'12',cy:'12',r:'8',pathLength:'100'}],
    ['state-check','path',{d:'m5 12 4.5 4.5L19 7'}],
    ['state-cross','path',{d:'m7 7 10 10m0-10L7 17'}]
  ]){const shape=document.createElementNS('http://www.w3.org/2000/svg',tag);shape.setAttribute('class',className);for(const[k,v]of Object.entries(attrs))shape.setAttribute(k,v);stateIcon.append(shape);}
  $('toggle').querySelector('.glyph').append(stateIcon);
  $('prompt').value = INTRO;
  let lastEditor = null;
  function status(message, kind = 'info', code = '') {
    $('status').textContent = message + (code ? '\nCode: ' + code : '');
    $('status').dataset.kind = kind;
    const checking = kind !== 'error' && kind !== 'success' && /провер|ожид|подключ|checking|connect/i.test(message);
    const label = kind === 'error' ? 'Check needed' : agentActive ? 'Session active' : checking ? 'Checking' : 'Open workspace';
    $('toggle').querySelector('small').textContent = 'Studio MCP · ' + label;
    $('toggle').dataset.state = kind==='error'?'error':checking?'waiting':agentActive?'active':kind;
    $('toggle').setAttribute('aria-label','Miracle · '+label);
    $('toggle').title='Miracle · '+label;
    if (checking) $('status').dataset.kind = 'waiting';
  }
  function open(value) {
    $('panel').hidden = !value; $('toggle').setAttribute('aria-expanded', String(value));
    if (value) $('agent-start').focus(); else $('toggle').focus();
  }
  $('toggle').onclick = () => open($('panel').hidden);
  $('close').onclick = () => open(false);
  shadow.addEventListener('keydown', event => { if (event.key === 'Escape') open(false); });
  function editable(el) {
    if(!(el instanceof Element)) return false;
    if(location.hostname.endsWith('deepseek.com')&&el.closest('.ds-textarea')) return false;
    if(location.hostname==='arena.ai'&&(!el.closest('form')||el.closest('#zs-root'))) return false;
    return el.matches('textarea:not([readonly]):not([disabled])') || el.matches('[contenteditable="true"],[contenteditable="plaintext-only"]');
  }
  document.addEventListener('focusin', event => {
    const el = event.composedPath().find(editable);
    if (el && el.getRootNode() !== shadow) lastEditor = el;
  }, { passive: true });
  function visible(el) {
    if (!editable(el) || !el.isConnected || el.closest('[aria-hidden="true"],[inert]')) return false;
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return rect.width > 70 && rect.height > 14 && style.visibility !== 'hidden' && style.display !== 'none';
  }
  function findComposer() {
    const adapter=siteAdapter();
    // Work apps contain editable documents and tasks: never fall back to them.
    if(adapter) return adapter.findComposer(document);
    if (lastEditor && visible(lastEditor)) return lastEditor;
    const hostname = location.hostname.replace(/^www\./, '');
    const specific = siteEditors[hostname] || '';
    const selector = [specific, 'textarea:not([readonly]):not([disabled]),[contenteditable="true"],[contenteditable="plaintext-only"]'].filter(Boolean).join(',');
    const candidates = [];
    function scan(root, depth = 0) {
      candidates.push(...[...root.querySelectorAll(selector)].filter(visible));
      // Copilot and other web components may keep the composer in open roots.
      if (depth < 5) for (const el of root.querySelectorAll('*')) if (el !== host && el.shadowRoot) scan(el.shadowRoot, depth + 1);
    }
    scan(document);
    const score = el => {
      const rect = el.getBoundingClientRect();
      return (specific && el.matches(specific) ? 100000 : 0) + (el.matches('[role="textbox"]') ? 1000 : 0) + Math.min(rect.width, 1500) + Math.min(Math.max(rect.top, 0), innerHeight) / 4;
    };
    return candidates.sort((a, b) => score(b) - score(a))[0] || null;
  }
  function text(el) { return el.matches('textarea,input') ? el.value : el.innerText || el.textContent || ''; }
  async function run(button, task) {
    if (button.disabled) return;
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    try { await task(); }
    catch (error) { status(error.message || 'The action failed. Please try again.', 'error'); }
    finally { button.disabled = false; button.setAttribute('aria-busy', 'false'); }
  }
  function message(type) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The extension timed out. Reload this page and try again.')), 9500);
      try {
        chrome.runtime.sendMessage({ type }, response => {
          clearTimeout(timeout);
          const error = chrome.runtime.lastError;
          if (error || !response) { reject(new Error('Extension connection lost. Reload this page after updating the extension.')); return; }
          resolve(response);
        });
      } catch { clearTimeout(timeout); reject(new Error('The extension was updated or disabled. Enable it and reload this page.')); }
    });
  }
  $('check').onclick = () => run($('check'), async () => {
    status('Checking the bridge and Studio…');
    const response = await message('MCP_PING');
    status(response.message || 'The extension returned no response. Reload the extension and this page.', response.code === 'READY' ? 'success' : 'error', response.code);
  });
  $('dashboard').onclick = () => run($('dashboard'), async () => {
    const response = await message('MCP_OPEN_PANEL');
    if (!response.ok) throw new Error(response.message || 'Could not open the workspace.');
    status('Workspace opened in a new tab.', 'success');
  });
  // Agent loop: observes only after explicit Start and disconnects on stop/error.
  const startAgent = button('agent-start', 'Start session', 'action primary');
  const stopAgent = button('agent-stop', 'Stop session'); stopAgent.hidden = true;
  $('panel').querySelector('.actions').prepend(startAgent, stopAgent);
  let agentActive = false, observer = null, debounce = 0, seen = new Set(), historicalNodes = new WeakSet(), historicalUserNodes = new WeakSet(), busy = false, sessionInstance = null, sessionId = '', toolCount = 0, watchdog = 0;
  const MAX_TOOL_CALLS = 30;
  async function recordUsage(kind, eventId, value) {
    try {
      const response=await sendRuntime('MCP_USAGE',{kind,event_id:eventId,characters:[...value].length});
      if(!response?.ok) console.warn('[Miracles] Usage could not be saved:',response?.message||'no response');
    } catch(error) { console.warn('[Miracles] Usage could not be saved:',error.message); }
  }
  const sent = new Set();
  function armAssistantWatchdog() { clearTimeout(watchdog); if(!agentActive) return; watchdog=setTimeout(()=>{ if(agentActive&&!busy) stop('No completed AI response after 120 seconds. Session paused. Check the site adapter.','ASSISTANT_TIMEOUT'); },120000); }
  function userTurnNodes() { return [...document.querySelectorAll('[data-message-author-role="user"],[data-message-author="user"],[data-role="user"],[data-role="human"],[data-testid*="user-message"],[data-testid*="human-message"],.user-message,.human-message,.qwen-chat-message-user,.chat-user,.segment-user,.user-query,.ds-message.d29f3d7d,ol.flex-col-reverse > li')].filter(el=>!host.contains(el)&&!el.closest('#miracles-mcp-widget')); }
  const sendRuntime = (type, payload = {}) => new Promise((resolve, reject) => {
    const timeout = type === 'MCP_CALL' ? 85000 : type === 'MCP_TOOLS' ? 25000 : 15000;
    const timer = setTimeout(() => reject(new Error('Bridge response timed out.')), timeout);
    chrome.runtime.sendMessage({ type, ...payload }, response => { clearTimeout(timer);
      if (chrome.runtime.lastError || !response) reject(new Error('No response from the extension. Reload this page and try again.'));
      else resolve(response);
    });
  });
  function stop(reason, code = 'SESSION_PAUSED') {
    const interrupted=busy&&code==='STOPPED';
    agentActive = false; busy = false; clearTimeout(debounce); clearTimeout(watchdog); observer?.disconnect(); observer = null;
    startAgent.hidden = false; stopAgent.hidden = true;
    status(reason+(interrupted?' A pending tool may still finish. Its result will not be sent to the chat.':''), code === 'STOPPED' ? 'info' : 'error', code);
  }
  function hostKey() { const key=location.hostname.replace(/^www\./,'').toLowerCase(); return key==='kimi.ai'?'kimi.com':key; }
  function siteAdapter() { return globalThis.MiraclesSiteAdapters?.forHost(location.hostname) || null; }
  function providerConfig() { return siteAdapter()?.reader || readerConfigs[hostKey()] || null; }
  function assistantNodes() {
    const adapter=siteAdapter();
    if(adapter) return adapter.assistantNodes(document).filter(el=>!el.closest(adapter.reader.exclude));
    const config=providerConfig();
    const selector=config?.selectors||'[data-message-author-role="assistant"],[data-message-author="assistant"]';
    const userSelector='[data-message-author-role="user"],[data-message-author="user"],[data-role="user"],[data-role="human"],[data-testid*="user-message"],[data-testid*="human-message"],.user-message,.human-message';
    let nodes=[...document.querySelectorAll(selector)];
    if(hostKey()==='arena.ai') nodes=nodes.flatMap(turn=>{
      const direct=turn.matches(':scope > .prose')?turn:turn.querySelector(':scope > .prose');
      if(!direct) return [];
      const marker=[turn,direct].map(el=>[el.getAttribute('data-message-author-role'),el.getAttribute('data-role'),el.getAttribute('data-author'),el.className].join(' ')).join(' ');
      return /assistant|model/i.test(marker)&&!/user|human/i.test(marker)?[direct]:[];
    });
    return nodes.filter(el=>{
      if(host.contains(el)||el.closest('#miracles-mcp-widget')||el.closest(userSelector)||config?.exclude&&el.closest(config.exclude)) return false;
      if(hostKey()==='chat.deepseek.com'&&el.closest('.d29f3d7d')) return false;
      const role=(el.getAttribute('data-message-author-role')||el.getAttribute('data-message-author')||el.getAttribute('data-role')||'').toLowerCase();
      if(role==='user'||role==='human') return false;
      if(config?.selectors&&hostKey()==='arena.ai') return true;
      if(config?.selectors) return true;
      return role==='assistant'||role==='model'||(el.classList.contains('ds-markdown')&&!!el.closest('.ds-message'));
    });
  }
  function arenaDirectMode() {
    if(hostKey()!=='arena.ai') return true;
    const turns=document.querySelectorAll('ol.flex-col-reverse > li');
    if(turns.length&&!assistantNodes().length) return false;
    const modes=[...document.querySelectorAll('button,[role="tab"],[role="button"]')].filter(el=>/direct|side.by.side|battle|compare/i.test(el.textContent||''));
    if(!modes.length) return true;
    return modes.some(el=>/direct/i.test(el.textContent||'')&&(el.getAttribute('aria-pressed')==='true'||el.getAttribute('aria-selected')==='true'||el.getAttribute('data-state')==='active'||/active|selected/i.test(el.className)));
  }
  function parseCalls(nodeOrText) {
    const calls=[]; const blocks=[];
    if (nodeOrText instanceof Element) {
      for (const code of nodeOrText.querySelectorAll('pre code, code')) blocks.push(code.textContent||'');
      blocks.push(nodeOrText.innerText||nodeOrText.textContent||'');
    } else blocks.push(String(nodeOrText||''));
    const candidates=[];
    for (const raw of blocks) {
      candidates.push(raw.trim());
      const re=/```(?:json)?\s*([\s\S]*?)```/gi; let m;
      while ((m=re.exec(raw))) candidates.push(m[1].trim());
    }
    const ids=new Set();
    for (const candidate of candidates) { try {
      const data=JSON.parse(candidate); const c=data?.miracles_tool;
      if(c&&typeof c.id==='string'&&c.id&&typeof c.name==='string'&&c.name&&c.arguments&&typeof c.arguments==='object'&&!Array.isArray(c.arguments)&&!ids.has(c.id)) { calls.push(c); ids.add(c.id); }
    } catch {} }
    return calls;
  }
  function composerAndSend() {
    const composer=findComposer(); if(!composer) return null;
    const adapter=siteAdapter();
    const config=providerConfig(); const key=hostKey();
    if(key==='arena.ai'&&composer.closest('#zs-root')) return null;
    if(key==='chat.deepseek.com'&&composer.closest('.ds-textarea')) return null;
    const form=composer.closest('form');
    const scope=adapter?adapter.scope(composer):key==='meta.ai'?document:key==='kimi.com'?(composer.closest('.chat-editor')?.parentElement||document):(form||composer.closest('input-area-v2')||composer.closest('[data-testid="composer-input"]')||composer.parentElement?.parentElement||composer.parentElement||document);
    if(!scope) return null;
    let candidates=[];
    if(config?.send) {
      try { candidates=[...scope.querySelectorAll(config.send)]; } catch {}
      if(key==='gemini.google.com') candidates=[...document.querySelectorAll('input-area-v2 button')].filter(b=>b.querySelector('mat-icon[fonticon="arrow_upward"],mat-icon[data-mat-icon-name="arrow_upward"]'));
      if(key==='chat.deepseek.com') candidates=[...scope.querySelectorAll('.ds-button--primary')];
      if(key==='kimi.com') candidates=[...scope.querySelectorAll('.send-button-container')];
    } else candidates=[...scope.querySelectorAll('button,[role="button"]')];
    // Provider selectors are preferred, with a semantic fallback scoped to the active form.
    // Some fixtures/providers expose only an aria-labeled Send button, and the provider
    // button can be replaced after the composer receives input.
    const fallbackScope=adapter?scope:form||scope;
    for(const candidate of fallbackScope.querySelectorAll('button[aria-label],button[title],[role="button"][aria-label]')) {
      const label=[candidate.getAttribute('aria-label'),candidate.getAttribute('title'),candidate.textContent].join(' ').toLowerCase();
      if(/send|submit|отправ|послать|envoyer/.test(label)&&!candidates.includes(candidate)) candidates.push(candidate);
    }
    const send=candidates.find(b=>{
      const label=[b.getAttribute('aria-label'),b.getAttribute('data-testid'),b.getAttribute('title'),b.textContent,b.className].join(' ').toLowerCase();
      if(key==='kimi.com'&&/stop|disabled/.test(label)) return false;
      if(key==='gemini.google.com'&&!b.querySelector('mat-icon[fonticon="arrow_upward"],mat-icon[data-mat-icon-name="arrow_upward"]')) return false;
      if(key==='chat.deepseek.com'&&(document.querySelector('.ds-loading')||b.closest('.ds-loading')||b.querySelector('.ds-loading'))) return false;
      const identified=config?.send||/send|submit|отправ|послать|envoyer/.test(label);
      return identified&&!b.hidden&&b.getAttribute('aria-hidden')!=='true'&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'&&(key!=='kimi.com'||!b.classList.contains('disabled'));
    });
    return {composer,send:send||null};
  }
  function setComposerValue(composer,value) {
    composer.focus({preventScroll:true});
    if(composer.matches('textarea,input')) {
      const proto=composer.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(composer,value);
    } else {
      const selection=composer.getRootNode().getSelection?.()||window.getSelection(); const range=document.createRange();
      range.selectNodeContents(composer); selection.removeAllRanges(); selection.addRange(range);
      if(!document.execCommand('insertText',false,value)) throw new Error('The site rejected text input.');
    }
    composer.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:value}));
  }
  async function clickSend(pair,value) {
    await new Promise(r=>setTimeout(r,300));
    const latest=composerAndSend();
    if(!latest||!latest.send||!text(latest.composer).includes(value)) throw new Error('The send button is unavailable. Your draft is preserved.');
    latest.send.click(); await new Promise(r=>setTimeout(r,600));
    const current=pair.composer.isConnected?pair.composer:findComposer();
    if(current&&text(current).includes(value)) throw new Error('The site did not confirm sending. Your draft is preserved.');
  }
  async function fillAndSend(value) {
    const pair=composerAndSend(); if(!pair) throw new Error(siteAdapter()?.errorMessage||'Message editor not found. Session paused.');
    if(text(pair.composer).trim()) throw new Error('A draft is in the editor. The result was not sent. Clear or send the draft, then resume the session.');
    setComposerValue(pair.composer,value);
    await new Promise(r=>setTimeout(r,250));
    const current=pair.composer.isConnected?pair.composer:findComposer();
    if(!current||!text(current).includes(value)) throw new Error('The site did not accept the message.');
    await clickSend({composer:current},value);
  }
  function generationInProgress(node) {
    const key=hostKey(), config=providerConfig();
    const stopSelector=config?.stop||'';
    let providerStop=false;
    if(stopSelector) providerStop=[...document.querySelectorAll(stopSelector)].some(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.hidden;});
    if(key==='gemini.google.com') providerStop=[...document.querySelectorAll('button')].some(b=>b.querySelector('mat-icon[fonticon="stop"],mat-icon[data-mat-icon-name="stop"]'));
    if(key==='kimi.com') providerStop=providerStop||!!document.querySelector('.send-button-container.stop');
    if(key==='chat.deepseek.com') providerStop=providerStop||!!document.querySelector('.ds-loading');
    if(key==='chat.z.ai'&&!document.querySelector('#send-message-button')) { const form=document.querySelector('#chat-input')?.closest('form'); providerStop=providerStop||!!form?.querySelector('button:not([id]):not(:has(svg)) span'); }
    const stopButton=providerStop||[...document.querySelectorAll('button,[role="button"]')].some(b=>{const label=[b.getAttribute('aria-label'),b.getAttribute('data-testid'),b.getAttribute('title'),b.textContent].join(' '); const r=b.getBoundingClientRect();return /stop generating|stop response|остановить генерац|остановить ответ/i.test(label)&&r.width>0&&r.height>0&&!b.hidden&&!b.disabled&&b.getAttribute('aria-disabled')!=='true';});
    const streaming=[...document.querySelectorAll('[data-testid*="stop-generating"],[data-is-streaming="true"]')].some(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.hidden;});
    return stopButton||streaming||node?.getAttribute('data-is-streaming')==='true'||node?.closest('[data-is-streaming="true"]');
  }
  async function handleAssistant() {
    if(!agentActive||busy) return;
    const nodes=assistantNodes(); const last=hostKey()==='arena.ai'?[...nodes].find(el=>!historicalNodes.has(el)&&!seen.has((el.innerText||el.textContent||'').slice(0,12000))):[...nodes].reverse().find(el=>!historicalNodes.has(el)&&!seen.has((el.innerText||el.textContent||'').slice(0,12000))); if(!last) return;
    const content=last.innerText||last.textContent||''; if(!content.trim()) return;
    if(generationInProgress(last)) return;
    clearTimeout(watchdog);
    const key=content.slice(0,12000); if(seen.has(key)) return;
    const calls=parseCalls(last); if(!calls.length) { seen.add(key); return; }
    busy=true; seen.add(key);
    try { for(const call of calls) {
      if(!agentActive) return;
      if(sent.has(call.id)) continue;
      if(toolCount>=MAX_TOOL_CALLS) { stop('This session reached 30 tool calls. Start a new session to continue.','TOOL_LIMIT'); return; }
      sent.add(call.id); toolCount++;
      status('Running tool: '+call.name);
      const response=await sendRuntime('MCP_CALL',{name:call.name,arguments:call.arguments,call_id:sessionId+':'+call.id,instance_id:sessionInstance});
      await recordUsage('input',sessionId+':'+call.id+':in',JSON.stringify({name:call.name,arguments:call.arguments}));
      if(!agentActive) return;
      if(response?.code==='BRIDGE_RESTARTED'||(response?.instance_id&&sessionInstance&&response.instance_id!==sessionInstance)) { stop('The bridge restarted. Start a new session; the old result was discarded.','BRIDGE_RESTARTED'); return; }
      const toolResultError=response?.ok===true&&response.result?.isError===true;
      const payload=response?.ok===true?(toolResultError?{ok:false,call_id:call.id,result:response.result}:{ok:true,call_id:call.id,result:response.result}):{ok:false,call_id:call.id,code:response?.code||'TOOL_FAILED',message:response?.message||'The tool returned an error.'};
      const resultMessage='Miracle tool result:\n```json\n'+JSON.stringify(payload)+'\n```';
      await fillAndSend(resultMessage);
      await recordUsage('output',sessionId+':'+call.id+':out',resultMessage);
      status(payload.ok?'Result sent. Waiting for the next response.':toolResultError?'Tool error sent to the model for correction.':'Request error sent to the chat.',payload.ok||toolResultError?'success':'error');
      if(!payload.ok&&!toolResultError) { stop('The tool call could not be confirmed. Session paused.',payload.code); return; }
      await new Promise(r=>setTimeout(r,350));
    }} catch(error) { stop(error.message||'Tool loop error.','AGENT_PAUSED'); }
    finally { busy=false; if(agentActive) { armAssistantWatchdog(); setTimeout(handleAssistant,450); } }
  }
  async function beginAgent() {
    status('Checking the bridge and Studio tools…');
    const health=await sendRuntime('MCP_HEALTH');
    if(health?.online!==true||health?.authenticated!==true||health?.code!=='READY') throw new Error(health?.message||'The bridge or Roblox Studio is not ready.');
    const listed=await sendRuntime('MCP_TOOLS');
    if(listed?.ok!==true||!Array.isArray(listed.tools)) throw new Error(listed?.message||'Could not load Studio tools.');
    if(health.instance_id&&listed.instance_id&&health.instance_id!==listed.instance_id) throw new Error('The bridge restarted during setup. Start a new session.');
    sessionInstance=listed.instance_id||health.instance_id||null;
    const tools=listed.tools;
    if(!tools.length) throw new Error('No tools available. Session was not started.');
    const priorNodes=assistantNodes(); historicalNodes=new WeakSet(priorNodes);
    seen=new Set(priorNodes.map(el=>(el.innerText||el.textContent||'').slice(0,12000)));
    historicalUserNodes=new WeakSet(userTurnNodes());
    const supportedHost=!!providerConfig();
    const genericAdapter=!!document.querySelector('[data-message-author-role="assistant"],[data-message-author="assistant"]');
    if(!supportedHost&&!genericAdapter) throw new Error('This site has no supported response adapter. Session was not started.');
    if(hostKey()==='arena.ai'&&!arenaDirectMode()) throw new Error('Switch Arena to Direct mode before starting a session.');
    sent.clear(); toolCount=0; sessionId=crypto.randomUUID();
    const pair=composerAndSend(); if(!pair) throw new Error(siteAdapter()?.errorMessage||'Message editor not found.');
    const draft=text(pair.composer).trim();
    const instructions=globalThis.MiraclesPrompt.build(tools,draft||'Ask the user what to do in Roblox Studio.');
    setComposerValue(pair.composer,instructions);
    await new Promise(r=>setTimeout(r,250));
    const current=pair.composer.isConnected?pair.composer:findComposer();
    if(!current||!text(current).includes(MARKER)||(draft&&!text(current).includes(draft))) throw new Error('The site did not accept the instructions. Your draft is preserved.');
    const readyPair=composerAndSend(); if(!readyPair||readyPair.composer!==current) throw new Error('Send button not found. Your draft is preserved.');
    await clickSend({composer:current},instructions);
    agentActive=true; startAgent.hidden=true; stopAgent.hidden=false;
    observer=new MutationObserver(records=>{
      if(!records.some(record=>!host.contains(record.target))) return;
      if(!busy) for(const turn of userTurnNodes()) if(!historicalUserNodes.has(turn)) { historicalUserNodes.add(turn); armAssistantWatchdog(); }
      clearTimeout(debounce); debounce=setTimeout(handleAssistant,450);
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-busy','disabled','data-is-streaming']});
    await recordUsage('activation',sessionId+':start',instructions);
    setTimeout(handleAssistant,450);
    status('Session active. Tools: '+tools.length+'.','success'); armAssistantWatchdog();
  }
  startAgent.onclick=()=>run(startAgent,beginAgent);
  stopAgent.onclick=()=>stop('Session stopped.','STOPPED');
  $('copy').onclick=()=>run($('copy'),async()=>{
    const health=await sendRuntime('MCP_HEALTH'); if(health?.code!=='READY') throw new Error(health?.message||'The bridge or Roblox Studio is not ready.');
    const listed=await sendRuntime('MCP_TOOLS'); if(listed?.ok!==true||!Array.isArray(listed.tools)) throw new Error(listed?.message||'Could not load Studio tools.');
    const prompt=globalThis.MiraclesPrompt.build(listed.tools,'Ask the user what to do in Roblox Studio.');
    $('prompt').value=prompt; $('manual').open=true;
    try { await navigator.clipboard.writeText(prompt); status('Tool instructions copied. Paste them into the chat.','success'); }
    catch { $('prompt').focus(); $('prompt').select(); status('Instructions are in the text field. Copy them manually.','error','CLIPBOARD_DENIED'); }
  });
})();
