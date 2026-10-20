const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness({paused=false,reduced=false,denied=false}={}){
  const timers=new Map(),events={},windowEvents={},copied=[],observations=[];let next=0,now=0;
  const listen=(registry,name,fn)=>(registry[name]??=[]).push(fn);
  const emit=(registry,name,event={})=>(registry[name]||[]).map(fn=>fn(event));
  function node(){return {dataset:{},attrs:{},listeners:{},textContent:'',value:'',disabled:false,scrollTop:0,validity:'',reports:0,
    set innerHTML(_value){assert.fail('Ideas must never become HTML');},
    setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]??null;},removeAttribute(k){delete this.attrs[k];},
    addEventListener:(name,fn)=>{},setCustomValidity(value){this.validity=value;},reportValidity(){this.reports++;},
    focus(){this.focused=true;this.fire('focus');},select(){this.selected=this.value;},
    fire(name,event={}){return emit(this.listeners,name,event);}};}
  const ids=Object.fromEntries(['playground','ideaForm','ideaControls','ideaInput','ideaBrief','ideaCopy','ideaFeedback','ideaSceneName','ideaSceneMood','ideaWorldTitle','ideaSeed','ideaSurprise'].map(id=>[id,node()]));
  const presets=['sky','neon','moon'].map(key=>({...node(),dataset:{ideaPreset:key}}));
  const moods=['dawn','golden','night'].map(key=>({...node(),dataset:{ideaMood:key}}));
  const steps=[0,1,2].map(key=>({...node(),dataset:{ideaStep:String(key)}}));
  const all=[...Object.values(ids),...presets,...moods,...steps];
  for(const item of all)item.addEventListener=(name,fn)=>listen(item.listeners,name,fn);
  ids.ideaInput.value='A chain of floating islands with a glowing portal and tiny bridges.';ids.ideaControls.disabled=true;ids.ideaCopy.disabled=true;
  ids.playground.querySelectorAll=q=>q==='[data-idea-preset]'?presets:q==='[data-idea-mood]'?moods:steps;
  const submit=()=>ids.ideaForm.fire('submit',{preventDefault(){this.prevented=true;}});
  ids.ideaForm.requestSubmit=submit;
  const media={matches:reduced,addEventListener:(_name,fn)=>{media.change=fn;}};
  const document={hidden:false,documentElement:{dataset:{motion:paused?'paused':'running'}},getElementById:id=>ids[id],addEventListener:(name,fn)=>listen(events,name,fn)};
  const context={document,window:{IntersectionObserver:true,addEventListener:(name,fn)=>listen(windowEvents,name,fn)},matchMedia:()=>media,
    navigator:{clipboard:{writeText:async value=>{if(denied)throw Error('Denied');copied.push(value);}}},
    fetch(){assert.fail('The playground must remain offline');},localStorage:{setItem(){assert.fail('Ideas must not be persisted');},getItem(){assert.fail('No stored input should be loaded');}},
    setTimeout:(fn,delay)=>{timers.set(++next,{fn,due:now+delay});return next;},clearTimeout:id=>timers.delete(id),
    IntersectionObserver:class{constructor(fn){this.callback=fn;observations.push(this);}observe(){}}};
  vm.runInNewContext(fs.readFileSync('website/idea-playground.js','utf8'),context);
  const step=()=>{assert(timers.size,'Expected pending animation');const [id,item]=[...timers.entries()].sort((a,b)=>a[1].due-b[1].due)[0];now=item.due;timers.delete(id);item.fn();};
  const flush=()=>{let guard=0;while(timers.size){assert(guard++<300,'Animation must finish without an idle loop');step();}};
  return {ids,presets,moods,steps,document,media,timers,copied,observations,submit,step,flush,
    emit:(name,event)=>emit(events,name,event),windowEmit:(name,event)=>emit(windowEvents,name,event),
    input:value=>{ids.ideaInput.value=value;ids.ideaInput.fire('input');},copy:()=>Promise.all(ids.ideaCopy.fire('click'))};
}

test('the initial concept is complete, editable and offline without idle animation timers',()=>{
  const h=harness();assert.equal(h.timers.size,0);assert.equal(h.ids.ideaControls.disabled,false);assert.equal(h.ids.ideaCopy.disabled,false);
  assert.match(h.ids.ideaBrief.value,/floating islands/);assert.match(h.ids.ideaBrief.value,/soft dawn/);assert.match(h.ids.ideaBrief.value,/preserve unrelated work/);
  assert.equal(h.presets[0].getAttribute('aria-pressed'),'true');assert.equal(h.moods[0].getAttribute('aria-pressed'),'true');
  assert.equal(h.ids.playground.dataset.ideaRunning,'false');assert.match(h.ids.ideaSeed.textContent,/^SKY \/ [0-9A-F]{4}$/);
});

test('an interaction traces three stages, types a brief and finishes with no recurring work',()=>{
  const h=harness();h.submit();assert.equal(h.ids.ideaBrief.value,'');assert.equal(h.ids.ideaBrief.getAttribute('aria-busy'),'true');
  assert.equal(h.steps[0].getAttribute('aria-current'),'step');h.step();assert.equal(h.steps[1].getAttribute('aria-current'),'step');
  h.step();assert.equal(h.steps[2].getAttribute('aria-current'),'step');assert(h.ids.ideaBrief.value.length>0&&h.ids.ideaBrief.value.length<30);
  h.flush();assert.match(h.ids.ideaBrief.value,/Explain what changed/);assert.equal(h.ids.ideaBrief.getAttribute('aria-busy'),'false');
  assert(h.steps.every(step=>step.dataset.complete==='true'));assert.equal(h.ids.playground.dataset.ideaRunning,'false');assert.equal(h.timers.size,0);
});

test('world and mood changes preserve a custom idea, cancel old work and produce the latest brief',()=>{
  const h=harness();h.input('A tiny underwater library with a jellyfish elevator.');h.submit();h.step();
  h.presets[1].fire('click');h.moods[2].fire('click');h.flush();
  assert.equal(h.ids.ideaInput.value,'A tiny underwater library with a jellyfish elevator.');
  assert.match(h.ids.ideaBrief.value,/underwater library/);assert.match(h.ids.ideaBrief.value,/compact city block/);assert.match(h.ids.ideaBrief.value,/deep-blue night sky/);
  assert.equal(h.ids.playground.dataset.ideaWorld,'neon');assert.equal(h.ids.playground.dataset.ideaLight,'night');
  assert.equal(h.presets[0].getAttribute('aria-pressed'),'false');assert.equal(h.moods[2].getAttribute('aria-pressed'),'true');assert.match(h.ids.ideaWorldTitle.textContent,/Neon city/);
});

test('copying mid-animation copies the entire current brief and clipboard denial selects readable text',async()=>{
  const h=harness();h.submit();h.step();await h.copy();assert.equal(h.timers.size,0);assert.equal(h.copied.length,1);
  assert.equal(h.copied[0],h.ids.ideaBrief.value);assert.match(h.copied[0],/Explain what changed/);assert.match(h.ids.ideaFeedback.textContent,/Copied/);
  const blocked=harness({denied:true});blocked.submit();blocked.step();await blocked.copy();
  assert.equal(blocked.ids.ideaBrief.selected,blocked.ids.ideaBrief.value);assert.match(blocked.ids.ideaFeedback.textContent,/copy the text manually/);assert.equal(blocked.timers.size,0);
});

test('motion preferences, hidden tabs, offscreen state and navigation settle a complete usable brief',()=>{
  for(const options of [{paused:true},{reduced:true}]){const h=harness(options);h.submit();assert.equal(h.timers.size,0);assert.match(h.ids.ideaBrief.value,/Explain what changed/);}
  for(const stop of [
    h=>h.emit('miracle:motion',{detail:{paused:true}}),
    h=>{h.document.hidden=true;h.emit('visibilitychange');},
    h=>{h.media.matches=true;h.media.change();},
    h=>h.observations[0].callback([{target:h.ids.playground,isIntersecting:false}]),
    h=>h.windowEmit('pagehide')
  ]){const h=harness();h.submit();h.step();stop(h);assert.equal(h.timers.size,0);assert.match(h.ids.ideaBrief.value,/Explain what changed/);assert.equal(h.ids.ideaBrief.getAttribute('aria-busy'),'false');}
});

test('surprise explores every starter idea before repeating and never repeats the immediate previous idea',()=>{
  const h=harness({paused:true}),ideas=new Set();let previous=h.ids.ideaInput.value;
  for(let i=0;i<36;i++){
    h.ids.ideaSurprise.fire('click');const idea=h.ids.ideaInput.value;assert.notEqual(idea,previous);
    if(i<18){assert(!ideas.has(idea));ideas.add(idea);}previous=idea;
    assert(h.ids.ideaBrief.value.includes(idea));assert.equal(h.timers.size,0);
  }
  assert.equal(ideas.size,18);
});

test('blank input is validated, custom markup remains text and long ideas are bounded',()=>{
  const h=harness();h.input(' \n\t ');h.submit();assert.equal(h.ids.ideaCopy.disabled,true);assert.equal(h.ids.ideaBrief.value,'');assert(h.ids.ideaInput.reports>0);assert.equal(h.timers.size,0);
  const idea='<img src=x onerror=alert(1)> Лунный парк 🪐';h.input(idea);assert.equal(h.ids.ideaInput.validity,'');assert(h.ids.ideaBrief.value.includes(idea));assert.equal(h.ids.ideaCopy.disabled,false);
  h.input('🌙'.repeat(220));const goal=h.ids.ideaBrief.value.match(/build this idea: (.*?)\n\n/s)[1];assert.equal(Array.from(goal).length,180);
});

test('focusing a typing brief or editing a new idea immediately settles readable current content',()=>{
  const h=harness();h.submit();h.step();h.step();h.ids.ideaBrief.focus();assert.equal(h.timers.size,0);assert.match(h.ids.ideaBrief.value,/Explain what changed/);
  h.submit();h.step();h.input('A glass treehouse.');assert.equal(h.timers.size,0);assert.match(h.ids.ideaBrief.value,/A glass treehouse/);
  h.ids.ideaInput.fire('keydown',{key:'Enter',ctrlKey:true,preventDefault(){}});assert.equal(h.timers.size,1);h.flush();assert.match(h.ids.ideaBrief.value,/A glass treehouse/);
});
