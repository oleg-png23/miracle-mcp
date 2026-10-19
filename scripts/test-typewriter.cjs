const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('shared headlines type on both pages and pause without leaving incomplete text',()=>{
  const timers=new Map(),events={};let id=0,mediaChange,intersection;
  const line=()=>({textContent:'',classList:{toggle(){}}});
  const heading=(kind,phrases)=>({dataset:{typewriter:kind,typePhrases:JSON.stringify(phrases)},lines:phrases[0].map(line),
    querySelectorAll(){return this.lines;},setAttribute(){}});
  const dashboard=heading('dashboard',[['Hello.'],['Build with AI.']]);
  const site=heading('site',[['A conversation.','A new world.'],['Your AI chat.','Your next idea.']]);
  const button={setAttribute(){},addEventListener:(_event,fn)=>{events.click=fn;}};
  const media={matches:false,addEventListener:(_event,fn)=>{mediaChange=fn;}};
  const context={document:{hidden:false,querySelectorAll:q=>q==='[data-typewriter]'?[dashboard,site]:[button],addEventListener:(event,fn)=>{events[event]=fn;}},
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
  events.click();assert.equal(timers.size,0);
  assert(['Good evening.','Build with AI.'].includes(text(dashboard)));
  assert(['A conversation. A new world.','Your AI chat. Your next idea.'].includes(text(site)));
  events.click();assert.equal(timers.size,2);
  intersection([{target:site,isIntersecting:false}]);assert.equal(timers.size,1);
  context.document.hidden=true;events.visibilitychange();assert.equal(timers.size,0);
  context.document.hidden=false;events.visibilitychange();assert.equal(timers.size,1);
  media.matches=true;mediaChange();assert.equal(timers.size,0);assert.equal(button.disabled,true);
});
