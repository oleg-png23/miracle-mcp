/* Pixel checks run against the local UI simulator, never a live Studio. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const sharp = require('sharp');
const {openSection,selectMaterial}=require('./ui-navigation.cjs');
const base = process.env.MIRACLES_UI_URL || 'http://127.0.0.1:19737';
const out = path.resolve(__dirname, '../.mcp_cache/qa');
fs.mkdirSync(out, {recursive: true});

async function difference(a, b, edge = 36) {
  const left = await sharp(a).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const right = await sharp(b).ensureAlpha().raw().toBuffer();
  const {width, height} = left.info;
  let rim = 0, center = 0, centerPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const changed = Math.abs(left.data[i] - right[i]) + Math.abs(left.data[i + 1] - right[i + 1])
      + Math.abs(left.data[i + 2] - right[i + 2]) > 20;
    if (x < edge || y < edge || x >= width - edge || y >= height - edge) rim += changed;
    else { center += changed; centerPixels++; }
  }
  return {rim, center, centerPixels};
}

(async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {features: [
      {name: 'prefers-reduced-transparency', value: 'no-preference'},
      {name: 'prefers-reduced-motion', value: 'reduce'}
    ]});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/ui/dashboard.html');
    await page.waitForSelector('body[data-connection="online"]');
    await selectMaterial(page, 'clear');
    await page.locator('.hero-card').scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => document.querySelector('.hero-card').dataset.glassActive === 'true');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('html').getAttribute('data-glass-engine'), 'refraction');
    const active = await page.locator('[data-glass-active="true"]').count();
    assert.equal(active, 2, 'Only navigation and the focal lens retain live optical layers');
    const metrics = await page.evaluate(() => window.DashboardGlass.getMetrics());
    assert(metrics.pixelsBuilt <= 2 * 65536);
    assert(await page.locator('[data-glass-passive="true"]').count() >= 5);
    console.log('OPTICAL_BUDGET', metrics);
    await page.screenshot({path: path.join(out, 'liquid-glass-desktop.png')});

    // A high-frequency, deterministic backdrop exposes real displacement.
    // The card interior and its text should remain essentially unchanged.
    await page.addStyleTag({content: '.wallpaper{background:repeating-conic-gradient(#1e5366 0% 25%,#e9f5dc 0% 50%) 0 0/36px 36px!important}.wallpaper img,.wallpaper-veil{visibility:hidden!important}'});
    const hero = page.locator('.hero-card');
    const original = await hero.evaluate(el => {
      const id = el.style.getPropertyValue('--glass-filter').match(/#([^)]*)/)[1];
      return [...document.getElementById(id).querySelectorAll('feDisplacementMap')].map(node => node.getAttribute('scale'));
    });
    const refracted = await hero.screenshot();
    await hero.evaluate(el => {
      const id = el.style.getPropertyValue('--glass-filter').match(/#([^)]*)/)[1];
      document.getElementById(id).querySelectorAll('feDisplacementMap').forEach(node => node.setAttribute('scale', 0));
    });
    const flat = await hero.screenshot();
    fs.writeFileSync(path.join(out, 'liquid-glass-optics-on.png'), refracted);
    fs.writeFileSync(path.join(out, 'liquid-glass-optics-off.png'), flat);
    const pixels = await difference(refracted, flat);
    assert(pixels.rim > 1000, `Lens must visibly displace the real backdrop: ${JSON.stringify(pixels)}`);
    assert(pixels.center < pixels.centerPixels * 0.05, `Interior must stay clear: ${JSON.stringify(pixels)}`);
    await hero.evaluate((el, scales) => {
      const id = el.style.getPropertyValue('--glass-filter').match(/#([^)]*)/)[1];
      document.getElementById(id).querySelectorAll('feDisplacementMap').forEach((node, i) => node.setAttribute('scale', scales[i]));
    }, original);
    console.log('PASS live backdrop refraction, stable interior and multiple surfaces', pixels);

    const scales = await page.evaluate(() => {
      const id = document.querySelector('.hero-card').style.getPropertyValue('--glass-filter').match(/#([^)]*)/)[1];
      const filter = document.getElementById(id);
      window.DashboardGlass.setDepth(20);
      const low = Number(filter.querySelector('feDisplacementMap').getAttribute('scale'));
      window.DashboardGlass.setDepth(100);
      const high = Number(filter.querySelector('feDisplacementMap').getAttribute('scale'));
      return {low, high, channels: filter.querySelectorAll('feDisplacementMap').length};
    });
    assert.equal(scales.channels, 3);
    assert(scales.high > scales.low * 2);
    await selectMaterial(page, 'frosted');
    assert.match(await hero.evaluate(el => getComputedStyle(el, '::before').backdropFilter), /blur\(18px\)/);
    await selectMaterial(page, 'light');
    assert.equal(await hero.evaluate(el => getComputedStyle(el, '::before').backdropFilter), 'none');
    assert.equal(await page.locator('[data-glass-active="true"]').count(), 0);
    console.log('PASS depth, RGB dispersion, frosted and disabled modes');

    await selectMaterial(page, 'clear');
    await page.setViewportSize({width: 390, height: 844});
    await hero.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const el = document.querySelector('.hero-card');
      const id = el.style.getPropertyValue('--glass-filter').match(/#([^)]*)/)?.[1];
      return id && Number(document.getElementById(id).querySelector('feImage').getAttribute('width')) === el.clientWidth;
    });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto(base + '/ui/dashboard.html');
    await page.waitForFunction(() => document.querySelector('.hero-card').dataset.glassActive === 'true');
    await page.waitForTimeout(250);
    await page.screenshot({path: path.join(out, 'liquid-glass-mobile.png')});
    await openSection(page, 'events');
    await page.waitForFunction(() => document.querySelector('.hero-card').dataset.glassActive === 'false');
    assert.equal(await page.locator('#events').getAttribute('data-glass-passive'), 'true');
    console.log('PASS responsive geometry and offscreen filter suspension');

    await page.setViewportSize({width: 1440, height: 1000});
    await page.goto(base + '/ui/welcome.html');
    await page.waitForFunction(() => document.querySelector('.welcome-connect').dataset.glassActive === 'true');
    await page.waitForTimeout(250);
    await page.screenshot({path: path.join(out, 'liquid-glass-welcome.png')});
    await page.emulateMedia({forcedColors: 'active'});
    await page.waitForFunction(() => document.documentElement.dataset.glassEngine === 'light');
    assert.equal(await page.locator('.welcome-connect').evaluate(el => getComputedStyle(el, '::before').backdropFilter), 'none');
    assert.deepEqual(errors, []);
    console.log('PASS welcome lens, forced colors and no JavaScript errors');
    await page.emulateMedia({forcedColors: 'none'});
    await cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-transparency', value: 'reduce'}]});
    await page.evaluate(() => {
      document.body.dataset.glassChoice = 'clear';
      window.DashboardGlass.refresh();
    });
    await page.waitForFunction(() => document.querySelector('.welcome-connect').dataset.glassActive === 'true');
    assert.match(await page.locator('.welcome-connect').evaluate(el => getComputedStyle(el, '::before').backdropFilter), /url\(/);
    await page.evaluate(() => {
      document.body.dataset.glassChoice = 'system';
      window.DashboardGlass.refresh();
    });
    assert.equal(await page.locator('.welcome-connect').evaluate(el => getComputedStyle(el, '::before').backdropFilter), 'none');
    console.log('PASS system transparency default and explicit Clear override');
    await page.close();

    const fallback = await browser.newPage({userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'});
    const fallbackCdp = await fallback.context().newCDPSession(fallback);
    await fallbackCdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-transparency', value: 'no-preference'}]});
    await fallback.goto(base + '/ui/welcome.html');
    await fallback.waitForFunction(() => document.documentElement.dataset.glassEngine === 'fallback');
    assert.equal(await fallback.locator('filter').count(), 0);
    assert.match(await fallback.locator('.welcome-connect').evaluate(el => getComputedStyle(el, '::before').backdropFilter), /blur\(12px\)/);
    console.log('PASS unsupported-engine fallback');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
