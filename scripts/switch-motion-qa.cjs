/* Real desktop/touch control feedback, against the local Studio fixture only. */
const assert = require('node:assert/strict');
const path = require('node:path');
const {openSection} = require('./ui-navigation.cjs');

module.exports = async function switchMotionQA(browser, storageState, base, out) {
  for (const touch of [false, true]) {
    const context = await browser.newContext({storageState, hasTouch: touch, isMobile: touch,
      viewport: touch ? {width: 390, height: 844} : {width: 1280, height: 1000}, reducedMotion: 'no-preference'});
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('miracle.motionPaused', 'false');
      const animate = Element.prototype.animate;
      window.switchMotionAudit = {optical: []};
      Element.prototype.animate = function(...args) {
        if (this.matches('.glass') || this.querySelector('.glass')) switchMotionAudit.optical.push(this);
        return animate.apply(this, args);
      };
    });
    const activate = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
    const ready = paused => page.waitForFunction(({paused, touch}) =>
      document.documentElement.dataset.motion === (paused ? 'paused' : 'running') &&
      document.documentElement.dataset.desktopMotion === (!paused && !touch ? 'on' : 'off'), {paused, touch});
    const settle = () => page.waitForFunction(() =>
      document.querySelector('#appearance').getAnimations({subtree: true}).every(a => a.playState !== 'running'));
    const stationary = async () => {
      const data = await page.evaluate(() => ({calls: switchMotionAudit.optical.length,
        styles: ['#appearance', '[data-workspace-screen="appearance"]', '#main', '.workspace'].map(selector => {
          const style = getComputedStyle(document.querySelector(selector));
          return [style.transform, style.translate, style.opacity];
        })}));
      assert.equal(data.calls, 0);
      for (const style of data.styles) assert.deepEqual(style, ['none', 'none', '1']);
    };
    const material = async (mode, moving = true) => {
      const control = page.locator('.segmented-control');
      await control.evaluate(el => el.scrollIntoView({block: 'center', behavior: 'instant'}));
      await activate('[data-material="' + mode + '"]');
      if (moving) await page.waitForFunction(() => {
        const style = getComputedStyle(document.querySelector('.segmented-control'), '::before');
        const x = new DOMMatrix(style.transform).m41, distance = parseFloat(style.width) + 5;
        return x > 1 && x < distance - 1;
      }, null, {timeout: 3000});
      await settle();
      const alignment = await control.evaluate(el => {
        const style = getComputedStyle(el, '::before'), box = el.getBoundingClientRect();
        const button = el.querySelector('[aria-pressed="true"]').getBoundingClientRect();
        const width = parseFloat(style.width), x = new DOMMatrix(style.transform).m41;
        return {center: box.x + el.clientLeft + parseFloat(style.left) + x + width / 2,
          selectedCenter: button.x + button.width / 2, width, selectedWidth: button.width};
      });
      assert(Math.abs(alignment.center - alignment.selectedCenter) <= 1.5, JSON.stringify(alignment));
      assert(Math.abs(alignment.width - alignment.selectedWidth) <= 2, JSON.stringify(alignment));
      await stationary();
    };
    try {
      await page.goto(base + '/app'); await page.waitForSelector('body[data-connection="online"]');
      assert.match(await page.title(), /Argon/);
      await ready(false); await openSection(page, 'appearance'); await settle();
      if (await page.locator('[data-material="clear"]').getAttribute('aria-pressed') !== 'true') await material('clear');
      await material('liquid'); await material('clear');

      const safety = page.locator('#safeMode');
      await safety.evaluate(el => el.scrollIntoView({block: 'center', behavior: 'instant'}));
      await activate('#safeMode');
      await page.waitForFunction(() => {
        const thumb = document.querySelector('#safeMode > span'), x = new DOMMatrix(getComputedStyle(thumb).transform).m41;
        return x > .2 && x < 12.8;
      }, null, {timeout: 3000});
      await settle();
      assert.equal(await safety.getAttribute('aria-checked'), 'false');
      await activate('#safeMode'); await settle();

      if (await page.locator('.wallpaper-option[data-wallpaper="lime"]').getAttribute('aria-pressed') !== 'true') {
        await activate('.wallpaper-option[data-wallpaper="lime"]'); await page.waitForSelector('body[data-wallpaper="lime"]'); await settle();
      }
      const unselected = await page.locator('.wallpaper-option[data-wallpaper="gradient"] > .icon').evaluate(el => {
        const style = getComputedStyle(el); return {opacity: Number(style.opacity), scale: new DOMMatrix(style.transform).a};
      });
      assert.equal(unselected.opacity, 0); assert(Math.abs(unselected.scale - .6) < .01);
      await activate('.wallpaper-option[data-wallpaper="gradient"]');
      await page.waitForFunction(() => {
        const style = getComputedStyle(document.querySelector('.wallpaper-option[data-wallpaper="gradient"] > .icon'));
        return Number(style.opacity) > 0 && Number(style.opacity) < 1;
      }, null, {timeout: 3000});
      await settle();

      const depth = page.locator('#glassDepth'), before = Number(await depth.inputValue());
      await depth.press('ArrowRight');
      assert.equal(await depth.evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length),0,'Keyboard adjustments are instant');
      assert.equal(Number(await depth.inputValue()), Math.min(100, before + 1));
      await settle(); await stationary();
      await page.screenshot({path: path.join(out, 'argon-switches-' + (touch ? 'touch' : 'desktop') + '.png'), fullPage: true});

      await openSection(page, 'connection');
      await page.locator('#advancedSettings summary').click();
      await activate('#toggleToken');
      await page.waitForFunction(() => {
        const opacity = Number(getComputedStyle(document.querySelector('#toggleToken'), '::after').opacity);
        return opacity > 0 && opacity < 1;
      }, null, {timeout: 3000});
      assert.equal(await page.locator('#setToken').getAttribute('type'), 'text');
      await activate('#toggleToken');

      await openSection(page, 'overview'); await page.locator('[data-motion-toggle]').click(); await ready(true);
      await openSection(page, 'appearance'); await material('liquid', false);
      assert.equal(await page.locator('#appearance').evaluate(el => el.getAnimations({subtree: true}).filter(a => a.playState === 'running').length), 0);
      await openSection(page, 'overview'); await page.locator('[data-motion-toggle]').click(); await ready(false);
      await openSection(page, 'appearance'); await material('clear');
      await page.emulateMedia({reducedMotion: 'reduce'}); await ready(true);
      await material('liquid', false);
      await page.emulateMedia({reducedMotion: 'no-preference'}); await ready(false);
      await material('clear');

      await page.evaluate(() => { Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => document.documentElement.dataset.pageHidden === 'true');
      await material('liquid', false);
      assert.equal(await page.locator('#appearance').evaluate(el => el.getAnimations({subtree: true}).filter(a => a.playState === 'running').length), 0);
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => document.documentElement.dataset.pageHidden === 'false');
      await material('clear');
    } catch (error) {
      await page.screenshot({path: path.join(out, 'argon-switch-failure-' + (touch ? 'touch' : 'desktop') + '.png'), fullPage: true}).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
};
