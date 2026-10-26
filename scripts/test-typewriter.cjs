const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('shared headlines type on both pages and pause without leaving incomplete text',()=>{
  const timers=new Map(),events={},motionEvents=[];let id=0,mediaChange,intersection;
  const line=()=>({textContent:'',classList:{toggle(){}}});
  const heading=(kind,phrases)=>({dataset:{typewriter:kind,typePhrases:JSON.stringify(phrases)},lines:phrases[0].map(line),
    querySelectorAll(){return this.lines;},setAttribute(){}});
  const dashboard=heading('dashboard',[['Hello.'],['Build with AI.']]);
  const site=heading('site',[['A conversation.','A new world.'],['Your AI chat.','Your next idea.']]);
  const button={setAttribute(){},addEventListener:(_event,fn)=>{events.click=fn;}};
  const media={matches:false,addEventListener:(_event,fn)=>{mediaChange=fn;}};
  const context={CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},document:{documentElement:{setAttribute(){}},dispatchEvent:event=>motionEvents.push(event),hidden:false,querySelectorAll:q=>q==='[data-typewriter]'?[dashboard,site]:[button],addEventListener:(event,fn)=>{events[event]=fn;}},
    window:{MiracleAppearance:{clock:()=>({greeting:'Good evening.'})},IntersectionObserver:true,addEventListener:(event,fn)=>{events[event]=fn;}},
    IntersectionObserver:class{constructor(fn){intersection=fn;}observe(){}},matchMedia:()=>media,
    localStorage:{getItem:()=>null,setItem(){}},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  const step=()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn();};
  const text=h=>h.lines.map(l=>l.textContent).join(' ');
  vm.runInNewContext(fs.readFileSync('scripts/typewriter.js','utf8'),context);
  assert.equal(timers.size,2);step();assert.equal(text(dashboard),'G');
  const seen=new Set();for(let i=0;i<150;i++){step();seen.add(text(dashboard));seen.add(text(site));}
  assert(seen.has('Good evening.'));assert(seen.has('A conversation. A new world.'));
  assert(seen.has('Build with AI.'));
  events.click();assert.equal(timers.size,0);assert.equal(motionEvents.at(-1).detail.paused,true);
  assert(['Good evening.','Build with AI.'].includes(text(dashboard)));
  assert(['A conversation. A new world.','Your AI chat. Your next idea.'].includes(text(site)));
  events.click();assert.equal(timers.size,2);assert.equal(motionEvents.at(-1).detail.paused,false);
  intersection([{target:site,isIntersecting:false}]);assert.equal(timers.size,1);
  context.document.hidden=true;events.visibilitychange();assert.equal(timers.size,0);
  context.document.hidden=false;events.visibilitychange();assert.equal(timers.size,1);
  media.matches=true;mediaChange();assert.equal(timers.size,0);assert.equal(button.disabled,true);assert.equal(motionEvents.at(-1).detail.paused,true);
});

test('reveal headlines stay complete and cancel transitions when paused or hidden',()=>{
  const timers=new Map(),events={},effects=[];let id=0,mediaChange,intersect;
  const media={matches:false,addEventListener:(_event,fn)=>{mediaChange=fn;}};
  const line={textContent:'',classList:{toggle(){}},animate(){
    const effect={canceled:false,cancel(){this.canceled=true;}};effects.push(effect);return effect;
  }};
  const heading={dataset:{typewriter:'dashboard',typeEffect:'reveal',typeGreeting:'false',typePhrases:'[["Your next world."],["Dream it. Build it."]]'},
    querySelectorAll:()=>[line],setAttribute(){}};
  const button={setAttribute(){},addEventListener:(_event,fn)=>{events.click=fn;}};
  const document={hidden:false,documentElement:{setAttribute(){}},dispatchEvent(){},
    querySelectorAll:q=>q==='[data-typewriter]'?[heading]:[button],addEventListener:(event,fn)=>{events[event]=fn;}};
  const context={document,window:{IntersectionObserver:true,addEventListener:(event,fn)=>{events[event]=fn;}},matchMedia:()=>media,
    CustomEvent:class{},localStorage:{getItem:()=>null,setItem(){}},
    IntersectionObserver:class{constructor(fn){intersect=fn;}observe(){}},
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  const step=()=>{const [id,fn]=timers.entries().next().value;timers.delete(id);fn();};
  vm.runInNewContext(fs.readFileSync('scripts/typewriter.js','utf8'),context);
  assert.equal(line.textContent,'Your next world.');assert.equal(timers.size,1);
  step();assert.equal(line.textContent,'Dream it. Build it.');assert.equal(effects.length,1);
  events.click();assert.equal(timers.size,0);assert(effects.at(-1).canceled);
  assert.equal(line.textContent,'Dream it. Build it.');
  events.click();step();assert.equal(line.textContent,'Your next world.');
  document.hidden=true;events.visibilitychange();assert.equal(timers.size,0);assert(effects.at(-1).canceled);
  document.hidden=false;events.visibilitychange();assert.equal(timers.size,1);
  intersect([{target:heading,isIntersecting:false}]);assert.equal(timers.size,0);
  intersect([{target:heading,isIntersecting:true}]);assert.equal(timers.size,1);
  media.matches=true;mediaChange();assert.equal(timers.size,0);assert.equal(button.disabled,true);
  assert.equal(line.textContent,'Your next world.');
});
