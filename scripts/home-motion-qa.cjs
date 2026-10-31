/* Live animation regression checks against the isolated Studio fixture. */
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function homeMotionQA(browser, storageState, base, out) {
  const options = {storageState, viewport: {width: 1280, height: 1000}, reducedMotion: 'no-preference'};
  let context, page, video;
  try {
    context = await browser.newContext({...options,
      recordVideo: {dir: path.join(out, 'motion'), size: {width: 1280, height: 1000}}});
    page = await context.newPage(); video = page.video();
  } catch (error) {
    await context?.close();
    if (!/Executable doesn't exist[^\n]*ffmpeg/i.test(error.message)) throw error;
    console.log('INFO Home motion video unavailable: Playwright FFmpeg is not installed. Live assertions still run.');
    context = await browser.newContext(options); page = await context.newPage();
  }
  let agent = null, status = null;
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    status = await response.json();
    await route.fulfill({response, json: {...status, agent_sessions: agent ? [agent] : []}});
  });
  await page.addInitScript(() => {
    localStorage.setItem('miracle.motionPaused', 'false');
    const animate = Element.prototype.animate;
    window.homeMotionAudit = {calls: [], optical: []};
    Element.prototype.animate = function(frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.matches('.connection-actions > *, .agent-status > *, #agentState'))
        window.homeMotionAudit.calls.push({element: this, animation});
      if (this.matches('.glass') || this.querySelector('.glass')) window.homeMotionAudit.optical.push(this);
      return animation;
    };
  });
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const count = () => page.evaluate(() => homeMotionAudit.calls.length);
  const settled = () => page.waitForFunction(() =>
    homeMotionAudit.calls.every(call => call.animation.playState !== 'running'));
  const stationary = async () => {
    const result = await page.evaluate(() => ({
      opticalCalls: homeMotionAudit.optical.length,
      surfaces: ['#chatAgent', '[data-workspace-screen="overview"]', '#main', '.workspace'].map(selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return {transform: style.transform, translate: style.translate, opacity: style.opacity};
      })
    }));
    assert.equal(result.opticalCalls, 0, 'Never animate a glass surface or its optical ancestors');
    for (const surface of result.surfaces) assert.deepEqual(surface, {transform: 'none', translate: 'none', opacity: '1'});
  };
  const reveal = async earlyStatus => {
    await page.locator('#chatAgent').evaluate(el => el.scrollIntoView({block: 'center', behavior: 'instant'}));
    await page.evaluate(data => {
      document.activeElement?.blur(); homeMotionAudit.calls.length = 0;
      MiracleSections.open('tools', {focus: false}); MiracleSections.open('overview', {focus: false});
      if (data) document.dispatchEvent(new CustomEvent('miracles:status', {detail: {host: location.host, data}}));
    }, earlyStatus);
    await page.waitForFunction(() => [...document.querySelectorAll('.connection-actions > *, .agent-status > *')].every(el =>
      homeMotionAudit.calls.some(call => call.element === el && call.animation.playState === 'running')), null, {timeout: 3000});
    await page.waitForFunction(() => {
      const opacity = Number(getComputedStyle(document.querySelector('#chatAgent > div')).opacity);
      return opacity > 0 && opacity < 1;
    }, null, {timeout: 3000});
    await stationary();
  };
  const state = async value => {
    agent = {site: 'chatgpt.com', state: value, calls: 1, age_s: 0};
    await page.evaluate(data => document.dispatchEvent(new CustomEvent('miracles:status', {
      detail: {host: location.host, data}
    })), {...status, agent_sessions: [agent]});
    await frame();
  };
  const stateMoving = () => page.waitForFunction(() => document.querySelector('#agentState').getAnimations().some(animation =>
    animation.playState === 'running' && animation.effect.getKeyframes().some(frame => frame.translate)), null, {timeout: 3000});
  try {
    await page.goto(base + '/app');
    await page.waitForSelector('body[data-connection="online"]');
    await settled();
    agent = {site: 'chatgpt.com', state: 'starting', calls: 1, age_s: 0};
    await reveal({...status, agent_sessions: [agent]});
    assert.equal(await count(), 5, 'All three connection actions and both agent children reveal');
    await page.screenshot({path: path.join(out, 'home-motion-desktop.png')});
    await settled();

    await page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'motionFixtureAction'; button.className = 'button'; button.textContent = 'Fixture action';
      document.querySelector('.connection-actions').append(button);
    });
    await page.waitForFunction(() => document.querySelector('#motionFixtureAction').getAnimations().some(a => a.playState === 'running'));
    assert.equal(await count(), 6, 'A dynamically inserted action reveals without replaying existing contents');
    await settled(); await page.locator('#motionFixtureAction').evaluate(el => el.remove());

    await state('watching'); await stateMoving();
    const changed = await count();
    await settled();
    for (let i = 0; i < 3; i++) await state('watching');
    assert.equal(await count(), changed, 'Identical polling states do not replay feedback');
    await stationary();

    await state('running'); await stateMoving();
    await page.locator('[data-motion-toggle]').click(); await settled();
    const paused = await count(); await state('sending_result');
    assert.equal(await count(), paused, 'Pause motion cancels and suppresses agent feedback');
    await page.locator('[data-motion-toggle]').click();
    await page.locator('#chatAgent').evaluate(el => el.scrollIntoView({block: 'center', behavior: 'instant'}));
    await state('starting'); await stateMoving();
    await page.emulateMedia({reducedMotion: 'reduce'}); await settled();
    const reduced = await count(); await state('waiting_json');
    assert.equal(await count(), reduced, 'Reduced motion cancels and suppresses feedback');
    await page.emulateMedia({reducedMotion: 'no-preference'});

    await state('watching'); await stateMoving();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settled();
    const hidden = await count(); await state('stopped');
    assert.equal(await count(), hidden, 'A hidden-tab lifecycle event cancels all tracked animations');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await frame();
    assert.equal(await count(), hidden, 'Returning to a visible tab does not replay a hidden state update');

    await page.setViewportSize({width: 1280, height: 480});
    await page.evaluate(() => scrollTo({top: 0, behavior: 'instant'}));
    const offscreen = await count(); await state('running');
    assert.equal(await count(), offscreen, 'Offscreen desktop agent updates stay still');
    await page.setViewportSize({width: 1280, height: 1000});
    await page.locator('#chatAgent').evaluate(el => el.scrollIntoView({block: 'center', behavior: 'instant'}));
    await state('watching'); await stateMoving(); await settled();

    await page.setViewportSize({width: 390, height: 844});
    await reveal(); await page.screenshot({path: path.join(out, 'home-motion-mobile.png')}); await settled();
    await stationary();
  } catch (error) {
    await page.screenshot({path: path.join(out, 'home-motion-failure.png'), fullPage: true}).catch(() => {});
    throw error;
  } finally {
    await context.close();
    if (video) { await video.saveAs(path.join(out, 'home-motion.webm')); await video.delete(); }
  }
};
