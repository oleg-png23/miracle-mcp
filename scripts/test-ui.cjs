/* Native MCP workflow, tested only with scripts/test-fixture.py and synthetic
 * chat pages. No real Studio actions or messages to online services. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const sharp = require('sharp');
const {openSection,selectMaterial}=require('./ui-navigation.cjs');
const base = process.env.MIRACLES_UI_URL || 'http://127.0.0.1:19737';
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.mcp_cache/qa');
fs.mkdirSync(out, { recursive: true });
async function post(api, body = {}) {
  const response = await fetch(base + api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}
async function calls() { return (await fetch(base + '/__fixture/calls').then(r => r.json())).calls; }
async function check(name, fn) { await fn(); process.stdout.write('PASS ' + name + '\n'); }
const tool = (id, name, args = {}) => ({ miracles_tool: { id, name, arguments: args } });

(async () => {
  await post('/__fixture/reset');
  if (!process.env.MIRACLES_AGENT_ONLY) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await check('only two scalable palette graphics are shipped', async () => {
      const graphics=fs.readdirSync(path.join(root,'assets/bg')).filter(name=>/\.(svg|webp)$/.test(name)).sort();
      assert.deepEqual(graphics,['lime-soda.svg','solar-flare.svg']);
      for(const name of graphics){const metadata=await sharp(path.join(root,'assets/bg',name)).metadata();assert.equal(metadata.format,'svg');assert.equal(metadata.width,2560);}
    });
    await check('dashboard bootstraps automatically without Studio script or token entry', async () => {
      const missing = []; page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/')) missing.push(r.url()); });
      await page.goto(base + '/app');
      await page.waitForSelector('body[data-connection="online"]');
      await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('miracles.settings') || '{}').bridgeToken);
      assert(page.url().endsWith('/ui/dashboard.html'));
      assert.equal(await page.locator('#guideCopyStudio').count(), 0);
      assert(!/LoadStringEnabled|ServerScriptService|Play Solo/.test(await page.locator('#setupGuide').innerText()));
      assert.deepEqual(missing, []);
    });
    await check('two themes switch, persist and expose no removed wallpaper controls',async()=>{
      await openSection(page,'appearance');
      assert.equal(await page.locator('.wallpaper-option').count(),2);
      assert.equal(await page.locator('#autoWallpaper').count(),0);
      await page.locator('[data-wallpaper="solar"]').click();
      await page.waitForSelector('body[data-wallpaper="solar"]');
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('miracles.settings')||'{}').dashboardWallpaper==='solar');
      await page.reload();await page.waitForSelector('body[data-wallpaper="solar"]');
      await openSection(page,'overview');
      await page.screenshot({path:path.join(out,'solar-flare-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(out,'solar-flare-mobile.png'),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
      await page.setViewportSize({width:1440,height:1000});
      await openSection(page,'appearance');await page.locator('[data-wallpaper="lime"]').click();
      await page.waitForSelector('body[data-wallpaper="lime"]');
      await openSection(page,'overview');
      await page.screenshot({path:path.join(out,'lime-soda-desktop.png'),fullPage:true});
    });
    await check('real refraction is bounded and light mode disables effects', async () => {
      await selectMaterial(page, 'clear');
      await page.locator('.hero-card').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => !!document.querySelector('feImage')?.getAttribute('href'));
      const hero = page.locator('.hero-card'), on = await hero.screenshot();
      await hero.evaluate(el => el.style.setProperty('--glass-filter', 'none'));
      const off = await hero.screenshot();
      const a = await sharp(on).ensureAlpha().raw().toBuffer(), b = await sharp(off).ensureAlpha().raw().toBuffer();
      let changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) > 6) changed++;
      assert(changed > 100);
      assert.equal(await page.locator('[data-glass-active="true"]').count(), 2);
      assert.equal(await page.locator('feDisplacementMap').count(), 6);
      await selectMaterial(page, 'light');
      assert.equal(await hero.evaluate(el => getComputedStyle(el, '::before').backdropFilter), 'none');
    });
    await check('rail hover magnifies icons and the tooltip sits above the hero card', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      const heroBox=await page.locator('.hero-card').boundingBox();
      const links=page.locator('.sidebar .nav-link');let control;
      for(let i=0;i<await links.count();i++) { const candidate=links.nth(i),box=await candidate.boundingBox();if(box&&box.y+box.height/2>heroBox.y+10&&box.y+box.height/2<heroBox.y+heroBox.height-10){control=candidate;break;} }
      assert(control,'A rail item alongside the hero is available to test tooltip stacking');
      const icon=control.locator('.nav-icon'), label=await control.getAttribute('aria-label');
      await page.mouse.move(0, 0); await page.waitForTimeout(450);
      const before = await icon.boundingBox();
      await control.hover();
      await page.waitForFunction(() => document.querySelector('#railTooltip')?.matches(':popover-open'));
      await page.waitForFunction(element => element.getBoundingClientRect().width > 45, await icon.elementHandle());
      assert((await icon.boundingBox()).width > before.width * 1.15);
      assert.equal(await page.locator('#railTooltip').innerText(), label);
      const tooltip = await page.locator('#railTooltip').boundingBox();
      const hero = await page.locator('.hero-card').boundingBox();
      assert(tooltip.x + tooltip.width > hero.x);
      assert(tooltip.y < hero.y + hero.height && tooltip.y + tooltip.height > hero.y);
      await page.mouse.move(0, 0);
    });
    await check('cards tilt with the pointer and settle without moving the rail logo', async () => {
      await selectMaterial(page, 'clear');
      await page.evaluate(() => { document.activeElement.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
      await page.mouse.move(0, 0); await page.waitForTimeout(450);
      const logo = page.locator('.rail-brand'), logoBefore = await logo.boundingBox();
      await logo.hover(); await page.waitForTimeout(400);
      const logoAfter = await logo.boundingBox();
      assert(Math.abs(logoAfter.x - logoBefore.x) < .2 && Math.abs(logoAfter.y - logoBefore.y) < .2);
      const hero = page.locator('.hero-card'), before = await hero.boundingBox();
      await page.mouse.move(before.x + before.width * .8, before.y + before.height * .2);
      await page.waitForTimeout(400);
      assert.match(await hero.evaluate(el => getComputedStyle(el).transform), /^matrix3d/);
      const tilted = await hero.boundingBox();
      assert(Math.abs(tilted.y - before.y) > .5);
      await page.mouse.move(0, 0);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-card')).transform === 'none');
      await selectMaterial(page, 'light');
      await hero.hover({ position: { x: 30, y: 30 } });
      await page.waitForTimeout(400);
      assert.match(await hero.evaluate(el => getComputedStyle(el).transform), /^matrix3d/);
      assert.equal(await hero.evaluate(el => getComputedStyle(el, '::before').backdropFilter), 'none');
      await page.mouse.move(0, 0);
    });
    await check('sections preserve editor drafts and browser navigation', async () => {
      await openSection(page, 'executor');
      await page.locator('#luauCode').fill('-- section draft');
      await openSection(page, 'appearance');
      assert(await page.locator('[data-workspace-screen="executor"]').isHidden());
      await page.goBack();
      await page.locator('[data-workspace-screen="executor"]').waitFor({state:'visible'});
      assert.equal(await page.locator('#luauCode').inputValue(), '-- section draft');
      await openSection(page, 'overview');
    });
    await check('instructions expand smoothly, reverse mid-animation and respect reduced motion', async () => {
      await openSection(page, 'executor');
      const details = page.locator('#aiPromptDetails'), summary = details.locator('summary');
      const content = details.locator('.fold-content');
      await summary.click();
      await page.waitForFunction(() => { const el = document.querySelector('#aiPromptDetails .fold-content'); const h = el.getBoundingClientRect().height; return h > 0 && h < el.scrollHeight - 5; });
      const partial = await content.evaluate(el => ({ height: el.getBoundingClientRect().height, full: el.scrollHeight }));
      assert(partial.height > 0 && partial.height < partial.full - 5);
      await page.waitForFunction(() => document.querySelector('#aiPromptDetails .fold-content').getAnimations().length === 0);
      const full = (await content.boundingBox()).height;
      await summary.click();
      await page.waitForFunction(() => { const d = document.querySelector('#aiPromptDetails'), el = d.querySelector('.fold-content'); return d.open && el.getBoundingClientRect().height < el.scrollHeight - 5; });
      assert(await details.getAttribute('open') !== null);
      const closing = await content.evaluate(el => ({ height: el.getBoundingClientRect().height, animations: el.getAnimations().map(a => ({ time: a.currentTime, frames: a.effect.getKeyframes() })) }));
      assert(closing.height < full, JSON.stringify({ full, closing }));
      await summary.click(); await page.waitForTimeout(60); await summary.click();
      await page.waitForFunction(() => !document.querySelector('#aiPromptDetails').open);
      await details.evaluate(el => { el.open = true; });
      await page.waitForFunction(() => document.querySelector('#aiPromptDetails .fold-content').getAnimations().length > 0);
      await page.waitForFunction(() => document.querySelector('#aiPromptDetails .fold-content').getAnimations().length === 0);
      assert((await content.boundingBox()).height >= full - 1);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await summary.click(); assert.equal(await details.getAttribute('open'), null);
      await summary.click(); assert((await content.boundingBox()).height >= full - 1);
      await summary.click(); await page.emulateMedia({ reducedMotion: 'no-preference' });
    });
    await check('optional editor executes through the native tool and shows true errors', async () => {
      await page.locator('#luauCode').fill('return "native test"'); await page.locator('#runCode').click();
      await page.waitForFunction(() => document.querySelector('#executionResult').dataset.kind === 'success');
      assert.equal(await page.locator('#executionOutput').innerText(), 'Native fixture result');
      assert.equal((await calls()).at(-1).name, 'run_code');
      await page.locator('#luauCode').fill('error("test")'); await page.locator('#runCode').click();
      await page.waitForFunction(() => document.querySelector('#executionResult').dataset.kind === 'error');
      assert.match(await page.locator('#executionOutput').innerText(), /line 1/);
    });
    await check('native MCP disabled status gives the real setup action', async () => {
      await openSection(page, 'connection');
      await post('/__fixture/reset', { state: 'mcp_disabled' });
      await page.evaluate(() => MiraclesDashboard.refresh());
      assert.match(await page.locator('#connectionFeedback').innerText(), /MCP|Assistant/);
      await post('/__fixture/reset'); await page.evaluate(() => MiraclesDashboard.refresh());
    });
    await check('responsive dashboard and mobile dock', async () => {
      await openSection(page, 'overview');
      await page.setViewportSize({ width: 1920, height: 1080 });
      assert((await page.locator('.workspace').boundingBox()).width > 1450);
      await page.screenshot({ path: path.join(out, 'dashboard-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + '/app');
      await page.waitForSelector('body[data-connection="online"]');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const nav = await page.locator('.sidebar').boundingBox(); assert(nav.y > 600 && nav.y + nav.height <= 844);
      await page.screenshot({ path: path.join(out, 'dashboard-mobile.png') });
      await page.setViewportSize({ width: 320, height: 740 });
      const narrowNav = await page.locator('.sidebar').boundingBox();
      assert(narrowNav.x >= 0 && narrowNav.x + narrowNav.width <= 320);
      const lastLink = await page.locator('#openSections').boundingBox();
      assert(lastLink.x + lastLink.width <= 320);
      await openSection(page, 'usage');
      assert(await page.locator('[data-workspace-screen="overview"]').isHidden());
      await openSection(page, 'setupGuide');
      assert(await page.locator('#setupGuide').isVisible());
      await openSection(page, 'overview');
      assert.deepEqual(errors, []);
    });
    await check('welcome has a separate responsive layout and real bridge status', async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(base + '/ui/welcome.html');
      await page.waitForSelector('body[data-wallpaper][data-studio-ready="true"]');
      assert.equal(await page.locator('#welcomeTitle').getAttribute('aria-label'), 'Welcome to Miracle.');
      const copy = await page.locator('.welcome-copy').boundingBox();
      const connection = await page.locator('.welcome-connect').boundingBox();
      assert(copy.x + copy.width < connection.x);
      await page.setViewportSize({ width: 390, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
    });
  } catch(error) { await browser.contexts()[0]?.pages()[0]?.screenshot({path:path.join(out,'dashboard-failure.png'),fullPage:true}).catch(()=>{}); throw error; } finally { await browser.close(); }
  }
  if (process.env.MIRACLES_DASHBOARD_ONLY) return;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'miracles-native-qa-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true, viewport: { width: 1200, height: 850 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async host => { await chrome.storage.local.clear(); await chrome.storage.local.set({ host }); }, new URL(base).host);
    await context.route('https://**/*', route => route.fulfill({ status: 200, contentType: 'text/html', headers: {
      'Content-Security-Policy': "default-src 'none'; style-src 'none'; script-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'"
    }, body: '<!doctype html><title>Native agent chat fixture</title><h1>Chat fixture</h1><main id="messages"></main><form><textarea aria-label="Message" rows="4" cols="60"></textarea><button aria-label="Send message" type="submit" disabled>Send</button></form>' }));
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await check('actual extension injects at declared hosts under strict CSP', async () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      for (const match of manifest.content_scripts[0].matches) {
        if (match.includes('copilot.microsoft.com')) continue; // Edge's protected domain.
        if(process.env.MIRACLES_QUICK_QA && !/chatgpt|notion|clickup/.test(match)) continue;
        await page.goto(match.replace('/*', '/'));
        try { await page.locator('#miracles-mcp-widget #toggle').waitFor({ timeout: 10000 }); }
        catch (error) { throw new Error('Extension failed on ' + match + ': ' + errors.join('; ') + '\n' + error.message); }
      }
    });
    async function seed(plans = [], draft = '', hostname = 'chatgpt.com') {
      await post('/__fixture/reset');
      await page.goto('https://' + hostname + '/');
      await page.locator('#miracles-mcp-widget #toggle').waitFor();
      await page.evaluate(({ plans, hostname }) => {
        window.sentMessages = []; window.plans = plans;
        if(/notion|clickup/.test(hostname)) {
          const chat=document.createElement('section'); chat.setAttribute('data-testid',hostname.includes('notion')?'notion-ai-chat':'brain-chat');
          document.body.append(chat); chat.append(document.querySelector('#messages'),document.querySelector('form'));
          const doc=document.createElement('div'); doc.id='work-document'; doc.contentEditable='true'; doc.textContent='Keep my document'; document.body.prepend(doc);
          const task=document.createElement('textarea'); task.id='task-description'; task.value='Keep my task'; document.body.append(task);
        }
        const editor = document.querySelector('textarea'), send = document.querySelector('form button');
        editor.addEventListener('input', () => { send.disabled = !editor.value.trim(); });
        document.querySelector('form').addEventListener('submit', event => {
          event.preventDefault(); const value = editor.value;
          if (!value.trim()) return;
          window.sentMessages.push(value); editor.value = ''; send.disabled = true;
          const user = document.createElement('div'); user.setAttribute('data-message-author-role', 'user'); user.textContent = value; document.querySelector('#messages').append(user);
          const plan = window.plans.shift();
          if (plan) setTimeout(() => {
            const assistant = document.createElement('div'); assistant.setAttribute('data-message-author-role', 'assistant'); assistant.setAttribute('data-is-streaming', 'true');
            if (plan.miracles_tool) { const pre = document.createElement('pre'), code = document.createElement('code'); code.textContent = JSON.stringify(plan); pre.append(code); assistant.append(pre); }
            else assistant.textContent = plan.text || 'Done';
            const stop = document.createElement('button'); stop.setAttribute('aria-label', 'Stop generating'); stop.textContent = 'Stop generating'; document.body.append(stop);
            document.querySelector('#messages').append(assistant);
            setTimeout(() => { stop.remove(); assistant.setAttribute('data-is-streaming', 'false'); }, 200);
          }, 20);
        });
        const old = document.createElement('div'); old.id = 'old-assistant'; old.setAttribute('data-message-author-role', 'assistant');
        const pre = document.createElement('pre'), code = document.createElement('code'); code.textContent = JSON.stringify({ miracles_tool: { id: 'old-history', name: 'run_code', arguments: { code: 'old history must never execute' } } }); pre.append(code); old.append(pre); document.querySelector('#messages').append(old);
      }, { plans, hostname });
      if (draft) await page.locator('textarea').first().fill(draft);
      await page.locator('#miracles-mcp-widget #toggle').click();
    }
    async function start() { await page.locator('#miracles-mcp-widget #agent-start').click(); }
    async function waitCalls(n) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) { if ((await calls()).length >= n) return; await new Promise(resolve => setTimeout(resolve, 150)); }
      throw new Error('Expected ' + n + ' native calls; status=' + await page.locator('#miracles-mcp-widget #status').innerText());
    }
    await check('Start bootstraps token and completes a multi-tool chat loop', async () => {
      await seed([tool('inspect', 'get_scene_info'), tool('change', 'run_code', { code: 'return "agent test"' }), { text: 'Done' }], 'Inspect and edit my place');
      await start(); await waitCalls(2);
      await page.waitForFunction(() => window.sentMessages.length >= 3);
      const sent = await page.evaluate(() => window.sentMessages);
      assert(sent[0].includes('Inspect and edit my place')); assert(sent[0].includes('get_scene_info'));
      assert(sent[0].includes('full-catalog-metadata')); assert(sent[0].includes('readOnlyHint'));
      assert(sent[1].includes('Native fixture result')); assert(sent[2].includes('Native fixture result'));
      assert.equal((await calls()).length, 2);
      assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('bridgeToken')).bridgeToken), 'ui-test-token');
      await page.locator('#miracles-mcp-widget #agent-stop').click();
    });
    await check('old history, user JSON and repeated DOM updates cannot execute tools', async () => {
      await seed([{ text: 'Waiting for a task' }]); await start();
      await page.waitForSelector('#miracles-mcp-widget #agent-stop');
      await page.evaluate(() => {
        document.querySelector('#old-assistant code').textContent = JSON.stringify({ miracles_tool: { id: 'changed-old', name: 'run_code', arguments: { code: 'must not execute' } } });
        const user = document.createElement('div'); user.setAttribute('data-message-author-role', 'user');
        const markdown = document.createElement('div'); markdown.className = 'ds-markdown';
        const code = document.createElement('code'); code.textContent = JSON.stringify({ miracles_tool: { id: 'user-injection', name: 'run_code', arguments: { code: 'must not execute' } } }); markdown.append(code); user.append(markdown); document.querySelector('#messages').append(user);
      });
      await page.waitForTimeout(1200); assert.equal((await calls()).length, 0);
      await page.locator('#miracles-mcp-widget #agent-stop').click();
    });
    await check('long partial JSON completes and runs once without relying on a stop button',async()=>{
      await seed([]);await start();
      await page.waitForFunction(()=>document.querySelector('#miracles-mcp-widget').shadowRoot.getElementById('agent-start').hidden);
      await page.evaluate(()=>{
        const text=JSON.stringify({miracles_tool:{id:'long-stream',name:'run_code',arguments:{code:'-- '+ 'x'.repeat(14000)+'\\nreturn 1'}}});
        const reply=document.createElement('div');reply.id='long-stream';reply.setAttribute('data-message-author-role','assistant');
        const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=text.slice(0,-3);pre.append(code);reply.append(pre);document.querySelector('#messages').append(reply);
        window.completeLongReply=()=>{code.textContent=text;};
      });
      await page.waitForTimeout(1700);assert.equal((await calls()).length,0);
      await page.evaluate(()=>window.completeLongReply());await waitCalls(1);
      await page.waitForFunction(()=>window.sentMessages.length===2);
      await page.waitForTimeout(1200);assert.equal((await calls()).length,1);
      await page.locator('#miracles-mcp-widget #agent-stop').click();
    });
    await check('Watch attaches to existing JSON and retry delivers a saved result once',async()=>{
      await seed([],'Keep this draft');
      await page.evaluate(()=>{const reply=document.createElement('div');reply.setAttribute('data-message-author-role','assistant');reply.textContent=JSON.stringify({miracles_tool:{id:'watch-latest',name:'get_scene_info',arguments:{}}});document.querySelector('#messages').append(reply);});
      await page.locator('#miracles-mcp-widget #agent-watch').click();await waitCalls(1);
      await page.waitForFunction(()=>document.querySelector('#miracles-mcp-widget').shadowRoot.getElementById('status').textContent.includes('result is saved'));
      assert.equal(await page.locator('textarea').first().inputValue(),'Keep this draft');
      await page.locator('textarea').first().fill('');
      await page.locator('#miracles-mcp-widget #retry-result').click();
      await page.waitForFunction(()=>window.sentMessages.length===1);
      assert.equal((await calls()).length,1);
      assert.match((await page.evaluate(()=>window.sentMessages))[0],/Native fixture result/);
      await page.locator('#miracles-mcp-widget #agent-stop').click();
    });
    for(const hostname of ['www.notion.so','app.clickup.com']) {
      await check(hostname+' scopes the agent to AI chat and preserves work documents',async()=>{
        await seed([tool('work-app','get_scene_info'),{text:'Done'}],'Inspect my Roblox place',hostname);
        await page.locator('#work-document').focus();
        await start(); await waitCalls(1); await page.waitForFunction(()=>window.sentMessages.length>=2);
        assert.equal(await page.locator('#work-document').innerText(),'Keep my document');
        assert.equal(await page.locator('#task-description').inputValue(),'Keep my task');
        assert((await page.evaluate(()=>window.sentMessages[0])).includes('Inspect my Roblox place'));
        await page.screenshot({path:path.join(out,hostname.includes('notion')?'notion-agent.png':'clickup-agent.png')});
        await page.locator('#miracles-mcp-widget #agent-stop').click();
        await seed([], '',hostname);
        await page.evaluate(()=>{document.querySelector('[data-testid="notion-ai-chat"],[data-testid="brain-chat"]').remove();});
        await start(); await page.waitForFunction(()=>document.querySelector('#miracles-mcp-widget').shadowRoot.getElementById('status').dataset.kind==='error');
        assert.match(await page.locator('#miracles-mcp-widget #status').innerText(),/Open.*(?:Notion|ClickUp)/);
        assert.equal(await page.locator('#work-document').innerText(),'Keep my document'); assert.equal((await calls()).length,0);
      });
    }
    await check('native tool errors return to the model so it can repair them', async () => {
      await seed([tool('bad', 'run_code', { code: 'error("test")' }), tool('fixed', 'run_code', { code: 'return "fixed"' }), { text: 'Repaired' }]);
      await start(); await waitCalls(2); await page.waitForFunction(() => window.sentMessages.length >= 3);
      const sent = await page.evaluate(() => window.sentMessages);
      assert(sent[1].includes('"ok":false')); assert(sent[1].includes('line 1'));
      await page.locator('#miracles-mcp-widget #agent-stop').click();
    });
    await check('Stop during a native call prevents sending the late result', async () => {
      await seed([tool('slow', 'get_scene_info')]); await post('/__fixture/reset', { delay: 1.5 });
      await start(); await waitCalls(1); await page.locator('#miracles-mcp-widget #agent-stop').click();
      await page.waitForTimeout(2200);
      assert.equal(await page.evaluate(() => window.sentMessages.length), 1);
      assert.match(await page.locator('#miracles-mcp-widget #status').innerText(), /may still finish/);
    });
    await check('a new draft pauses result delivery without overwriting it', async () => {
      await seed([tool('draft', 'get_scene_info')]); await post('/__fixture/reset', { delay: 1 });
      await start(); await waitCalls(1); await page.locator('textarea').first().fill('Keep this draft');
      await page.waitForFunction(() => document.querySelector('#miracles-mcp-widget').shadowRoot.getElementById('status').textContent.includes('draft'));
      assert.equal(await page.locator('textarea').first().inputValue(), 'Keep this draft');
      assert.equal(await page.evaluate(() => window.sentMessages.length), 1);
    });
    await check('usage tracks successful sessions by site without provider quota claims', async () => {
      const usage = await fetch(base + '/api/status').then(r => r.json()).then(data => data.usage);
      assert(usage.estimated);
      assert.equal(usage.tokens_total, usage.tokens_in + usage.tokens_out);
      assert(usage.tokens_in > 0 && usage.tokens_out > 0);
      for (const site of ['chatgpt.com','www.notion.so','app.clickup.com']) assert(usage.sites.some(row => row.site === site && row.activations > 0));
      assert.equal(usage.activations, usage.sites.reduce((sum,row) => sum + row.activations, 0));
    });
    await check('no page script errors and mobile agent controls remain usable', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(out, 'chat-agent-mobile.png') });
      assert.deepEqual(errors, []);
    });
  } finally {
    await context.close();
    const resolved = path.resolve(profile), temp = path.resolve(os.tmpdir());
    if (resolved.startsWith(temp + path.sep) && path.basename(resolved).startsWith('miracles-native-qa-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
  process.stdout.write('All native MCP browser checks passed.\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
