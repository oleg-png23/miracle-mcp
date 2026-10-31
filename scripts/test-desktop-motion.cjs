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

test('desktop page reveals leave optical surfaces and their ancestors stationary',()=>{
  const h=desktopHarness();assert.equal(h.root.dataset.desktopMotion,'on');
  assert.equal(h.animations.length,1);assert.equal(h.animations[0].el,h.content);
  assert(h.intersections[0].observed.has(h.offscreen));
  h.intersections[0].callback([{target:h.offscreen,isIntersecting:true}]);assert.equal(h.animations.length,2);
  h.intersections[0].callback([{target:h.offscreen,isIntersecting:true}]);assert.equal(h.animations.length,2);
  assert(h.animations.every(a=>a.el!==h.glass&&a.el!==h.ancestor&&a.options.fill==='backwards'));
  h.animations[0].onfinish();assert(h.animations[0].canceled);
});

test('mouse and keyboard feedback never activates controls and excludes touch and glass',()=>{
  const h=desktopHarness({dashboard:true}),button=h.node();
  h.pointer(button);assert.equal(h.animations.length,1);assert.equal(button.children.length,0);
  assert(h.animations[0].frames.every(frame=>Number(frame.scale)<=1));
  h.animations.at(-1).onfinish();assert.equal(button.children.length,0);
  const before=h.animations.length;
  h.pointer(h.glass);h.pointer(h.ancestor);h.pointer(h.node({disabled:true}));h.pointer(h.node({excluded:true}));
  h.pointer(button,{pointerType:'touch'});h.pointer(button,{button:2});assert.equal(h.animations.length,before);
  h.events.keydown({target:button,key:'Enter',preventDefault(){assert.fail('Motion must not change activation behavior');}});
  assert.equal(h.animations.length,before+1);
  h.events.keydown({target:h.node({tagName:'A'}),key:' '});assert.equal(h.animations.length,before+1);
  h.events.keydown({target:button,key:'Enter',repeat:true});assert.equal(h.animations.length,before+1);
});

test('selection and value feedback ignores unchanged polling updates and hidden controls',()=>{
  const h=desktopHarness({dashboard:true});
  const selected=h.node({kind:'selection',attrs:{'aria-pressed':'true'}});
  const record={type:'attributes',target:selected,attributeName:'aria-pressed',oldValue:'true'};
  h.observers[0].callback([record]);assert.equal(h.animations.length,0);
  h.observers[0].callback([{...record,oldValue:'false'}]);assert.equal(h.animations.length,1);
  selected.visible=false;h.observers[0].callback([{...record,oldValue:'false'}]);assert.equal(h.animations.length,1);
  const thumb=h.node(),toggle=h.node({kind:'switch',inner:thumb,attrs:{'aria-checked':'false'}});
  h.observers[0].callback([{type:'attributes',target:toggle,attributeName:'aria-checked',oldValue:'true'}]);assert.equal(h.animations.at(-1).el,thumb);
  const count=h.animations.length;
  h.observers[0].callback([{type:'childList',target:h.value}]);assert.equal(h.animations.length,count);
  h.value.textContent='123';h.observers[0].callback([{type:'childList',target:h.value}]);assert.equal(h.animations.length,count+1);assert.equal(h.value.textContent,'123');
  h.animations.at(-1).onfinish();h.observers[0].callback([{type:'childList',target:h.value}]);assert.equal(h.animations.length,count+1);
});

test('agent state changes get feedback once while visible and settle for motion preferences',()=>{
  const h=desktopHarness({dashboard:true});
  const update=text=>{h.agent.textContent=text;h.observers[0].callback([{type:'childList',target:h.agent}]);};
  update('Chat reader active');assert.equal(h.animations.length,1);assert.equal(h.animations[0].el,h.agent);
  update('Chat reader active');assert.equal(h.animations.length,1);h.animations[0].onfinish();
  h.agent.top=1200;update('Running a Studio tool');assert.equal(h.animations.length,1,'Offscreen polling stays still');
  h.agent.top=100;h.agent.visible=false;update('Sending the result to chat');assert.equal(h.animations.length,1);
  h.agent.visible=true;update('Chat session paused');assert.equal(h.animations.length,2);
  h.events['miracle:motion']({detail:{paused:true}});assert(h.animations.every(animation=>animation.canceled));
  update('Chat session stopped');assert.equal(h.animations.length,2);
  h.events['miracle:motion']({detail:{paused:false}});update('Starting the chat session');assert.equal(h.animations.length,3);
  h.document.hidden=true;h.events.visibilitychange();assert(h.animations.every(animation=>animation.canceled));
  update('Waiting for complete tool JSON');assert.equal(h.animations.length,3);
  h.document.hidden=false;h.events.visibilitychange();h.reducedMedia.matches=true;h.events.reduced();
  update('Chat reader active');assert.equal(h.animations.length,3);
  assert(h.animations.every(animation=>animation.el!==h.glass&&animation.el!==h.ancestor));
});

test('an early agent update does not double its parent reveal or replay after it settles',()=>{
  const h=desktopHarness({dashboard:true});h.agent.parentElement=h.content;
  const entrance=h.content.animate([{opacity:0},{opacity:1}],{duration:360});
  const update=text=>{h.agent.textContent=text;h.observers[0].callback([{type:'childList',target:h.agent}]);};
  update('Starting the chat session');assert.equal(h.animations.length,1);
  entrance.cancel();update('Starting the chat session');assert.equal(h.animations.length,1);
  update('Chat reader active');assert.equal(h.animations.length,2);assert.equal(h.animations.at(-1).el,h.agent);
});

test('pause, hidden tabs, reduced motion and desktop changes cancel feedback without leaving extra layers',()=>{
  const h=desktopHarness({dashboard:true}),button=h.node();h.pointer(button);h.photo.animate([{opacity:.5},{opacity:1}],{duration:550});
  h.events['miracle:motion']({detail:{paused:true}});assert(h.animations.every(a=>a.canceled));assert.equal(button.children.length,0);
  const before=h.animations.length;h.pointer(button);assert.equal(h.animations.length,before);assert.equal(h.root.dataset.desktopMotion,'off');
  h.events['miracle:motion']({detail:{paused:false}});h.pointer(button);assert.equal(h.animations.length,before+1);
  h.document.hidden=true;h.events.visibilitychange();assert(h.animations.every(a=>a.canceled));assert.equal(h.root.dataset.pageHidden,'true');
  h.document.hidden=false;h.events.visibilitychange();h.pointer(button);h.reducedMedia.matches=true;h.events.reduced();assert(h.animations.every(a=>a.canceled));
  const touch=desktopHarness({desktop:false});assert.equal(touch.animations.length,0);touch.pointer(touch.node());assert.equal(touch.animations.length,0);
  assert.equal(desktopHarness({reduced:true}).animations.length,0);assert.equal(desktopHarness({paused:true}).animations.length,0);
  h.intersections[1].callback([{target:h.ambient,isIntersecting:false}]);assert.equal(h.ambient.dataset.desktopVisible,'false');
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

test('existing and dynamically loaded details animate open and close without duplicate wrappers',()=>{
  const h=detailsHarness();h.click(h.first);assert(h.first.open);assert.equal(h.animations.length,1);
  h.first.listeners.toggle();assert.equal(h.animations.length,1);
  h.animations[0].onfinish();h.click(h.first);assert(h.first.open,'Closing content stays rendered until the animation ends');
  h.animations[1].onfinish();assert(!h.first.open);
  const dynamic=h.details();h.observers[0].callback([{addedNodes:[dynamic]}]);h.observers[0].callback([{addedNodes:[dynamic]}]);
  assert.equal(dynamic.childNodes.filter(n=>n.className==='fold-content').length,1);
  h.click(dynamic);assert(dynamic.open);assert.equal(h.animations.length,3);
});

test('paused and reduced motion settle disclosures at the requested state',()=>{
  const h=detailsHarness();h.click(h.first);h.document.documentElement.dataset.motion='paused';h.events['miracle:motion']();
  assert(h.first.open);assert(h.animations[0].canceled);
  const before=h.animations.length;h.click(h.first);assert(!h.first.open);assert.equal(h.animations.length,before);
  h.document.documentElement.dataset.motion='running';h.click(h.first);h.animations.at(-1).onfinish();h.click(h.first);
  h.media.matches=true;h.events.reduced();assert(!h.first.open);assert(h.animations.at(-1).canceled);
  const body=h.first.childNodes.find(n=>n.className==='fold-content');assert.equal(body.style.height,undefined);assert.equal(body.style.overflow,undefined);
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
