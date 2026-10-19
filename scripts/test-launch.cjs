const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'miracle-launch-qa-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--disable-extensions-except=' + root, '--load-extension=' + root]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const result = await worker.evaluate(async () => {
      await chrome.storage.local.set({host: '127.0.0.1:19737', welcomeLastShownAt: 0});
      await openDashboard();
      const welcomeURL = chrome.runtime.getURL('welcome.html');
      const own = (await chrome.tabs.query({url: welcomeURL})).filter(tab => tab.url === welcomeURL || tab.pendingUrl === welcomeURL);
      const first = (await chrome.storage.local.get('welcomeLastShownAt')).welcomeLastShownAt;
      await openDashboard();
      await openDashboard();
      const dashboardURL = chrome.runtime.getURL('dashboard.html');
      const dashboards = (await chrome.tabs.query({url: dashboardURL})).filter(tab => tab.url === dashboardURL || tab.pendingUrl === dashboardURL);
      const count = (await chrome.tabs.query({})).length;
      await openDashboard('startup');
      const quiet = (await chrome.tabs.query({})).length === count;
      await chrome.storage.local.set({welcomeLastShownAt: Date.now() - 5 * 60 * 60 * 1000 - 1});
      await openDashboard('startup');
      const after = (await chrome.storage.local.get('welcomeLastShownAt')).welcomeLastShownAt;
      return {welcomeCount: own.length, workspaceCount: dashboards.length, first, after, quiet,
        permissions: await chrome.permissions.getAll()};
    });
    assert.equal(result.welcomeCount, 1);
    assert.equal(result.workspaceCount, 1);
    assert(result.quiet);
    assert(result.after >= result.first);
    assert(!result.permissions.permissions.includes('tabs'), 'Reusing own pages needs no new tabs permission');
    console.log('PASS installed extension launch cooldown, tab reuse and no additional permissions');
  } finally {
    await context?.close();
    const resolved = path.resolve(profile), temp = path.resolve(os.tmpdir());
    if (resolved.startsWith(temp + path.sep) && path.basename(resolved).startsWith('miracle-launch-qa-')) {
      fs.rmSync(resolved, {recursive: true, force: true, maxRetries: 3});
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
