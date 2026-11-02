const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function desktopHarness({desktop=true,reduced=false,paused=false,dashboard=false}={}){
  const events={},observers=[],intersections=[],animations=[];
  const root={dataset:{motion:paused?'paused':'running'}};
  function node(options={}){
    const el={tagName:'BUTTON',children:[],attrs:{},dataset:{},visible:true,textContent:'',kind:'',optical:false,hasOptical:false,excluded:false,
      classList:{names:new Set(),add(name){this.names.add(name);},remove(name){this.names.delete(name);},contains(name){return this.names.has(name);}},
      getAttribute(name){return this.attrs[name]??null;},setAttribute(name,value){this.attrs[name]=value;},
      matches(selector){
        if(selector==='.glass,.welcome-connect')return this.optical;
        if(selector.includes('[data-no-motion]'))return this.excluded;
        if(selector.includes('#stUptime'))return this.kind==='value'||(selector.includes('#agentState')&&this.kind==='agent');
        if(selector==='.switch')return this.kind==='switch';
        if(selector.includes('.segmented-control'))return this.kind==='selection';
        return false;
      },
      querySelector(selector){
        if(selector==='.glass,.welcome-connect')return this.hasOptical?{}:null;
        if(selector==='.desktop-click-ring')return this.children.find(c=>c.className==='desktop-click-ring')||null;
        return this.inner||null;
      },
      closest(){return this.owner||this;},contains(){return Boolean(this.focused);},
      getClientRects(){return this.visible?[{}]:[];},getBoundingClientRect(){return {top:this.top??100,bottom:(this.top??100)+40};},
      append(child){child.parent=this;this.children.push(child);},remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);},
      getAnimations(){return animations.filter(a=>a.el===this&&!a.canceled);},
      animate(frames,options){const a={el:this,frames,options,playState:'running',canceled:false,cancel(){this.canceled=true;this.playState='idle';}};animations.push(a);return a;},...options};
    return el;
  }
  const content=node(),offscreen=node({top:1200}),glass=node({optical:true}),ancestor=node({hasOptical:true});
  const value=node({kind:'value',textContent:'12'}),agent=node({id:'agentState',kind:'agent',textContent:'No chat session detected'}),ambient=node(),photo=node();
  const body=node();
  const document={documentElement:root,body,hidden:false,activeElement:null,
    querySelector:()=>dashboard?{}:null,
    querySelectorAll:selector=>selector==='#bgPhoto,#heroWallpaper'?[photo]:selector.includes('#stUptime')?[value,...(selector.includes('#agentState')?[agent]:[])]:selector==='.live-dot,.demo-line,.scroll-cue'?[ambient]:[content,offscreen,glass,ancestor],
    createElement:()=>node(),addEventListener:(name,fn)=>{events[name]=fn;}};
  const desktopMedia={matches:desktop,addEventListener:(_name,fn)=>{events.desktop=fn;}};
  const reducedMedia={matches:reduced,addEventListener:(_name,fn)=>{events.reduced=fn;}};
  const window={innerHeight:800,MutationObserver:true,IntersectionObserver:true,addEventListener:(name,fn)=>{events[name]=fn;}};
  const context={document,window,matchMedia:q=>q.startsWith('(min-width')?desktopMedia:reducedMedia,
    MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}},
    IntersectionObserver:class{constructor(callback){this.callback=callback;this.observed=new Set();intersections.push(this);}observe(el){this.observed.add(el);}unobserve(el){this.observed.delete(el);}disconnect(){this.observed.clear();}}};
  vm.runInNewContext(fs.readFileSync('scripts/desktop-motion.js','utf8'),context);
  const pointer=(el,options={})=>events.pointerdown({target:el,button:0,pointerType:'mouse',...options});
  return {events,observers,intersections,animations,node,document,root,value,agent,photo,content,offscreen,glass,ancestor,ambient,pointer,desktopMedia,reducedMedia};
}

test('rare page reveals stay brief and leave optical surfaces stationary',()=>{
  const h=desktopHarness();assert.equal(h.animations.length,1);
  assert.equal(h.animations[0].options.duration,200);
  assert.equal(h.animations[0].options.easing,'cubic-bezier(.23,1,.32,1)');
  h.intersections[0].callback([{target:h.offscreen,isIntersecting:true}]);
  assert(h.animations.every(a=>a.el!==h.glass&&a.el!==h.ancestor&&a.options.fill==='backwards'));
  h.animations[0].onfinish();assert(h.animations[0].canceled);
});

test('keyboard activation cancels decorative arrivals and never bounces controls',()=>{
  const h=desktopHarness(),before=h.animations.length;
  h.events.keydown({target:h.node(),key:'Enter'});
  assert.equal(h.root.dataset.motionInput,'keyboard');assert.equal(h.animations.length,before);
  assert(h.animations.every(a=>a.canceled));assert.equal(h.intersections[0].observed.size,0);
  for(const key of [' ','Tab','ArrowRight'])h.events.keydown({target:h.node(),key});
  assert.equal(h.animations.length,before);
});

test('pointer press/release belongs to CSS and never schedules a timed rebound',()=>{
  for(const desktop of [true,false]){
    const h=desktopHarness({desktop,dashboard:true}),button=h.node();
    h.pointer(button,{pointerType:desktop?'mouse':'touch'});h.pointer(button);
    assert.equal(h.root.dataset.motionInput,'pointer');assert.equal(h.animations.length,0);
    h.events.keydown({target:button,key:'Enter'});assert.equal(h.root.dataset.motionInput,'keyboard');
  }
});

test('dashboard data and selections have no delegated mutation animation observer',()=>{
  const h=desktopHarness({dashboard:true});
  assert.equal(h.observers.length,0);
  h.value.textContent='123';h.agent.textContent='Chat reader active';
  assert.equal(h.animations.length,0);
});

test('pause, hidden tabs, reduced motion and desktop changes settle page reveals',()=>{
  for(const event of ['pause','hidden','reduced','desktop','pagehide']){
    const h=desktopHarness();assert(h.animations.length);
    if(event==='pause')h.events['miracle:motion']({detail:{paused:true}});
    if(event==='hidden'){h.document.hidden=true;h.events.visibilitychange();}
    if(event==='reduced'){h.reducedMedia.matches=true;h.events.reduced();}
    if(event==='desktop'){h.desktopMedia.matches=false;h.events.desktop();}
    if(event==='pagehide')h.events.pagehide();
    assert(h.animations.every(a=>a.canceled),event);
  }
  assert.equal(desktopHarness({reduced:true}).animations.length,0);
  assert.equal(desktopHarness({paused:true}).animations.length,0);
});

function detailsHarness(){
  const events={},animations=[],observers=[];
  const media={matches:false,addEventListener:(_event,fn)=>{events.reduced=fn;}};
  function node(kind='body'){
    return {kind,nodeType:1,childNodes:[],listeners:{},open:false,style:{removeProperty(name){delete this[name];}},
      addEventListener(name,fn){this.listeners[name]=fn;},closest:()=>null,
      matches(selector){return selector==='details'&&this.kind==='details';},querySelectorAll:()=>[],
      querySelector(){return this.summary;},append(child){if(child.parent)child.parent.childNodes=child.parent.childNodes.filter(n=>n!==child);child.parent=this;this.childNodes.push(child);},
      getBoundingClientRect(){return {height:this.style.height==='0px'?0:120};},
      animate(frames,options){const a={frames,options,canceled:false,cancel(){this.canceled=true;}};animations.push(a);return a;}};
  }
  function details(){const el=node('details');el.summary=node('summary');el.append(el.summary);el.append(node('p'));return el;}
  const first=details();
  const document={documentElement:{dataset:{motion:'running'}},body:{dataset:{}},hidden:false,
    querySelectorAll:selector=>selector==='details'?[first]:[],createElement:()=>node(),addEventListener:(name,fn)=>{events[name]=fn;}};
  const context={document,window:{MutationObserver:true,addEventListener:(name,fn)=>{events[name]=fn;}},matchMedia:()=>media,
    getComputedStyle:()=>({opacity:'1'}),MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}}};
  vm.runInNewContext(fs.readFileSync('scripts/surfaces.js','utf8'),context);
  const click=el=>el.summary.listeners.click({target:el.summary,preventDefault(){}});
  return {events,animations,observers,document,first,details,click,media};
}

test('existing and dynamic disclosures retain native activation and one styling wrapper',()=>{
  const h=detailsHarness();
  assert.equal(h.first.summary.listeners.click,undefined);
  assert.equal(h.first.listeners.toggle,undefined);
  const dynamic=h.details();h.observers[0].callback([{addedNodes:[dynamic]}]);h.observers[0].callback([{addedNodes:[dynamic]}]);
  assert.equal(dynamic.childNodes.filter(n=>n.className==='fold-content').length,1);
  assert.equal(dynamic.summary.listeners.click,undefined);
  assert.equal(h.animations.length,0);
});

test('programmatic disclosure state is never delayed or replaced with height animation',()=>{
  const h=detailsHarness();
  for(const value of [true,false,true,false]){
    h.first.open=value;
    h.observers[0].callback([{addedNodes:[h.first]}]);
    assert.equal(h.first.open,value);assert.equal(h.animations.length,0);
    const body=h.first.childNodes.find(n=>n.className==='fold-content');
    assert.equal(body.style.height,undefined);assert.equal(body.style.overflow,undefined);
  }
});

test('unchanged usage polling preserves table rows and does not rewrite metric text',()=>{
  const events={},ids={};let replacements=0,writes=0;
  const node=()=>({children:[],hidden:false,append(...children){this.children.push(...children);}});
  for(const id of ['usageTokens','usageInput','usageOutput','usageActivations','usageSiteCount','usageSites','usageEmpty','usageTable']){
    const el=node();let value='';Object.defineProperty(el,'textContent',{get:()=>value,set:next=>{writes++;value=next;}});ids[id]=el;
  }
  ids.usageSites.replaceChildren=fragment=>{replacements++;ids.usageSites.children=fragment.children;};
  vm.runInNewContext(fs.readFileSync('scripts/usage.js','utf8'),{Intl,document:{getElementById:id=>ids[id],createElement:node,createDocumentFragment:node,addEventListener:(name,fn)=>{events[name]=fn;}}});
  const usage={tokens_total:123,tokens_in:80,tokens_out:43,activations:2,sites:[{site:'example',activations:2,tokens_in:80,tokens_out:43}]};
  const show=()=>events['miracles:status']({detail:{data:{usage}}});show();const first=ids.usageSites.children[0],initialWrites=writes;
  for(let i=0;i<20;i++)show();assert.equal(replacements,1);assert.equal(ids.usageSites.children[0],first);assert.equal(writes,initialWrites);
  usage.sites[0].activations=3;show();assert.equal(replacements,2);assert.notEqual(ids.usageSites.children[0],first);
});
