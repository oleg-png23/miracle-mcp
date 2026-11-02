/* Functional data and repeated navigation stay stationary in the real browser. */
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function homeMotionQA(browser, storageState, base, out) {
  const context=await browser.newContext({storageState,viewport:{width:1280,height:1000},reducedMotion:'no-preference'});
  const page=await context.newPage();
  await page.addInitScript(()=>{
    localStorage.setItem('miracle.motionPaused','false');
    const animate=Element.prototype.animate;
    window.homeMotionAudit=[];
    Element.prototype.animate=function(...args){
      if(this.matches('.connection-actions > *,.agent-status > *,#agentState,.metric > strong,.log-entry')||this.matches('.glass')||this.querySelector('.glass'))homeMotionAudit.push(this);
      return animate.apply(this,args);
    };
  });
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  try{
    await page.goto(base+'/app');await page.waitForSelector('body[data-connection="online"]');
    await page.evaluate(()=>{
      for(const section of ['tools','overview','connection','overview'])MiracleSections.open(section,{focus:false});
      document.querySelector('#agentState').textContent='Fixture status changed';
      document.querySelector('.metric > strong').textContent='Fixture metric changed';
      const button=document.createElement('button');button.id='motionFixtureAction';button.className='button';button.textContent='Fixture action';
      document.querySelector('.connection-actions').append(button);
    });
    await frame();
    assert.equal(await page.evaluate(()=>homeMotionAudit.length),0,'Navigation, new actions and data refreshes never reveal or bounce');
    const control=page.locator('#motionFixtureAction');
    await control.focus();await control.press('Space');
    assert.equal(await control.evaluate(el=>el.getAnimations().length),0,'Keyboard press has no animation');
    assert.equal(await control.evaluate(el=>getComputedStyle(el).transform),'none');
    await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.waitForFunction(()=>Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('#motionFixtureAction')).transform).a-.985)<.001);
    await page.waitForTimeout(300);
    assert(Math.abs(await control.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a)-.985)<.001,'A held pointer stays pressed instead of rebounding on a timer');
    await page.mouse.up();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#motionFixtureAction')).transform==='none'||Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('#motionFixtureAction')).transform).a-1)<.001);
    await page.emulateMedia({reducedMotion:'reduce'});
    await control.focus();await control.press('Enter');assert.equal(await control.evaluate(el=>el.getAnimations().length),0);
    await page.emulateMedia({reducedMotion:'no-preference'});
    for(const width of [1280,390]){
      await page.setViewportSize({width,height:width===390?844:1000});
      await page.evaluate(()=>{MiracleSections.open('tools',{focus:false});MiracleSections.open('overview',{focus:false});});
      await frame();assert.equal(await page.evaluate(()=>homeMotionAudit.length),0);
      await page.screenshot({path:path.join(out,'home-motion-'+width+'.png')});
    }
  }finally{await context.close();}
};
