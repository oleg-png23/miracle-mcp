const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness({paused=false,reduced=false}={}){
  const timers=new Map(),events={},copied=[],observations=[];let now=0,next=0;
  const listen=(target,name,fn)=>{(target[name]??=[]).push(fn);};
  const emit=(name,event={})=>(events[name]||[]).map(fn=>fn(event));
  function node(){return {dataset:{},attrs:{},listeners:{},children:[],textContent:'',
    classList:{names:new Set(),toggle(name,value){if(value)this.names.add(name);else this.names.delete(name);},contains(name){return this.names.has(name);}},
    setAttribute(name,value){this.attrs[name]=value;},getAttribute(name){return this.attrs[name]??null;},
    addEventListener(name,fn){listen(this.listeners,name,fn);},fire(name,event={}){return (this.listeners[name]||[]).map(fn=>fn(event));},
    append(child){if(child.fragment)this.children.push(...child.children);else this.children.push(child);}};}
  const ids=Object.fromEntries(['welcomePrompt','welcomePromptText','welcomePromptCopy','welcomePromptCount','promptFeedback','welcomeStatus','welcomeStatusDetail','welcomeRefresh','welcomeTime'].map(id=>[id,node()]));
  ids.welcomePromptCopy.append(ids.welcomePromptText);
  const media={matches:reduced,addEventListener:(_name,fn)=>{media.change=fn;}};
  const document={readyState:'loading',hidden:false,documentElement:{dataset:{motion:paused?'paused':'running'}},body:node(),
    getElementById:id=>ids[id],querySelectorAll:()=>[ids.welcomePrompt],createElement:node,createDocumentFragment:()=>({...node(),fragment:true}),
    addEventListener:(name,fn)=>listen(events,name,fn)};
  const window={IntersectionObserver:true,MiraclesBridge:{copy:async text=>{copied.push(text);}},addEventListener:(name,fn)=>listen(events,name,fn)};
  const context={document,window,matchMedia:()=>media,localStorage:{getItem:()=>String(paused)},
    setTimeout:(fn,delay)=>{timers.set(++next,{fn,due:now+delay,delay});return next;},clearTimeout:id=>timers.delete(id),
    IntersectionObserver:class{constructor(fn){this.callback=fn;observations.push(this);}observe(){}}};
  vm.runInNewContext(fs.readFileSync('scripts/welcome-prompts.js','utf8'),context);
  const step=()=>{assert(timers.size,'Expected pending work');const [id,item]=[...timers.entries()].sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];now=item.due;timers.delete(id);item.fn();};
  const loadWelcome=()=>vm.runInNewContext(fs.readFileSync('scripts/welcome.js','utf8'),context);
  return {ids,document,window,timers,emit,media,observations,copied,step,loadWelcome,time:()=>now,text:()=>ids.welcomePromptText.textContent,position:()=>ids.welcomePromptCount.textContent};
}

test('all 30 complete ideas appear before repeating and the cycle lasts several minutes',()=>{
  const h=harness(),labels=new Map(),prompts=new Set();assert.equal(h.position(),'01 / 30');
  h.step();assert.equal(h.text(),'“G');
  for(let i=0;i<15000;i++){
    if(h.text().endsWith('”')){labels.set(h.position(),h.text());prompts.add(h.ids.welcomePrompt.dataset.copyPrompt);}
    if(labels.size===30&&h.position()==='01 / 30')break;
    h.step();
  }
  assert.equal(labels.size,30);assert.equal(new Set(labels.values()).size,30);assert.equal(prompts.size,30);
  assert.equal(h.position(),'01 / 30');assert(h.time()>300000,'A full cycle should last at least five minutes');
  assert(h.time()<600000,'The carousel should keep progressing');
});

test('copying mid-typing completes and copies the current full brief through the existing handler',async()=>{
  const h=harness();h.loadWelcome();h.step();assert(!h.text().endsWith('”'));
  const first=h.ids.welcomePrompt.dataset.copyPrompt;
  await Promise.all(h.ids.welcomePrompt.fire('click'));
  assert.deepEqual(h.copied,[first]);assert(h.text().endsWith('”'));assert.match(h.copied[0],/Inspect the current lighting/);
  assert(h.ids.welcomePrompt.getAttribute('aria-label').endsWith(h.text().slice(1,-1)));
  assert.equal(h.ids.promptFeedback.textContent,'Copied. Bring it to your AI chat.');
  for(let i=0;i<400&&h.position()!=='02 / 30';i++)h.step();
  assert.equal(h.position(),'02 / 30');h.step();
  const second=h.ids.welcomePrompt.dataset.copyPrompt;await Promise.all(h.ids.welcomePrompt.fire('click'));
  assert.deepEqual(h.copied,[first,second]);assert.notEqual(first,second);assert.match(second,/forest clearing/);assert(h.text().endsWith('”'));
});

test('pause, reduced motion, visibility, hover and focus retain a readable current idea',()=>{
  const h=harness();h.step();const first=h.ids.welcomePrompt.dataset.copyPrompt;
  h.emit('miracle:motion',{detail:{paused:true}});assert.equal(h.timers.size,0);assert(h.text().endsWith('”'));
  h.emit('miracle:motion',{detail:{paused:false}});assert.equal(h.timers.size,1);assert.equal(h.ids.welcomePrompt.dataset.copyPrompt,first);
  h.document.hidden=true;h.emit('visibilitychange');assert.equal(h.timers.size,0);
  h.document.hidden=false;h.emit('visibilitychange');assert.equal(h.timers.size,1);
  h.observations[0].callback([{target:h.ids.welcomePrompt,isIntersecting:false}]);assert.equal(h.timers.size,0);
  h.observations[0].callback([{target:h.ids.welcomePrompt,isIntersecting:true}]);assert.equal(h.timers.size,1);
  h.ids.welcomePrompt.fire('pointerenter',{pointerType:'touch'});assert.equal(h.timers.size,1);
  h.ids.welcomePrompt.fire('pointerenter',{pointerType:'mouse'});assert.equal(h.timers.size,0);assert(h.text().endsWith('”'));
  h.ids.welcomePrompt.fire('pointerleave');assert.equal(h.timers.size,1);
  h.ids.welcomePrompt.fire('focusin');assert.equal(h.timers.size,0);
  h.ids.welcomePrompt.fire('focusout');assert.equal(h.timers.size,1);
  h.media.matches=true;h.media.change();assert.equal(h.timers.size,0);assert(h.text().endsWith('”'));
  h.media.matches=false;h.media.change();assert.equal(h.timers.size,1);
  h.emit('pagehide');assert.equal(h.timers.size,0);h.emit('pageshow');assert.equal(h.timers.size,1);
  for(const options of [{paused:true},{reduced:true}]){const quiet=harness(options);assert.equal(quiet.timers.size,0);assert(quiet.text().endsWith('”'));}
});

test('touch copy locks the current idea and a failed clipboard operation keeps it readable',async()=>{
  const h=harness();h.loadWelcome();h.step();
  const prompt=h.ids.welcomePrompt.dataset.copyPrompt;h.ids.welcomePrompt.fire('pointerdown');
  assert(h.text().endsWith('”'));assert.equal(h.timers.size,1,'Only the copy-hold timeout remains');
  h.window.MiraclesBridge.copy=async()=>{throw new Error('Clipboard unavailable');};
  await Promise.all(h.ids.welcomePrompt.fire('click'));assert.equal(h.ids.welcomePrompt.dataset.copyPrompt,prompt);
  assert(h.text().endsWith('”'));assert.equal(h.ids.promptFeedback.textContent,'Select the prompt text and copy it.');
  h.document.hidden=true;h.emit('visibilitychange');
  // The existing feedback message may expire; prompt typing and copy-hold stop.
  assert([...h.timers.values()].every(item=>item.delay===5000));
});
