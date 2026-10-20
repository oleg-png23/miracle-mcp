const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness({fine=false,reduced=false,paused=false,width=fine?1280:390,navHidden=false}={}){
  const events={},frames=new Map(),animations=[],observers=[],intersections=[],layouts=[];let next=0;
  const style=()=>({values:new Map(),writes:0,setProperty(k,v){this.values.set(k,v);this.writes++;},set transform(v){this.setProperty('transform',v);},get transform(){return this.values.get('transform');}});
  const root={dataset:{motion:paused?'paused':'running'},scrollHeight:2400,style:style()};
  function node(options={}){
    const el={dataset:{},attrs:{},children:[],listeners:{},visible:true,top:100,optical:false,hasOptical:false,
      style:style(),rectReads:0,
      classList:{values:new Set(),add(k){this.values.add(k);},remove(k){this.values.delete(k);},contains(k){return this.values.has(k);}},
      matches(q){if(q==='.glass')return this.optical;if(q==='.brand,.skip')return this.excluded;if(q==='.scene,.landscape-card')return this.selection;return false;},
      querySelector(q){if(q==='.glass')return this.hasOptical?{}:null;if(q==='.site-click-ring')return this.children.find(c=>c.className==='site-click-ring')||null;return this.inner||null;},
      closest(){return this;},getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
      getClientRects(){return this.visible?[{}]:[];},getBoundingClientRect(){this.rectReads++;const top=this.baseTop===undefined?this.top:this.baseTop-window.scrollY;return {top,bottom:top+120,left:0,width:240,height:120};},
      addEventListener(k,fn){this.listeners[k]=fn;},contains(){return this.focused;},
      append(child){child.parent=this;this.children.push(child);},remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);},
      getAnimations(){return animations.filter(a=>a.el===this&&!a.canceled);},
      animate(frames,options){const a={el:this,frames,options,canceled:false,cancel(){this.canceled=true;}};animations.push(a);return a;},...options};return el;
  }
  const content=node(),offscreen=node({top:1400}),glass=node({optical:true}),ancestor=node({hasOptical:true}),card=node(),ambient=node(),photo=node(),header=node(),progress=node();
  const ids={header,experience:node({baseTop:400}),preview:node({baseTop:1000}),setup:node({baseTop:1500}),questions:node({baseTop:1900})};
  const links=['preview','experience','setup','questions'].map(name=>node({visible:!navHidden,attrs:{href:'#'+name}}));
  const body=node();body.classList.add('marketing-site');
  const document={body,documentElement:root,hidden:false,activeElement:null,createElement:()=>node(),getElementById:id=>ids[id],
    addEventListener:(k,fn)=>{events[k]=fn;},querySelector:q=>q==='.nav-progress>span'?progress:null,querySelectorAll:q=>q==='#heroWallpaper'?[photo]:q.startsWith('.nav-links')?links:q==='.hero,.compatibility,.workflow-illustration,.closing'?[ambient]:q.startsWith('.feature-list article,')?[card,glass]:[content,offscreen,glass,ancestor]};
  const pointer={matches:fine,addEventListener:(_k,fn)=>{events.pointerChange=fn;}};
  const media={matches:reduced,addEventListener:(_k,fn)=>{events.reduced=fn;}};
  const compact={matches:width<=900};
  const window={innerWidth:width,innerHeight:800,scrollY:0,IntersectionObserver:true,MutationObserver:true,ResizeObserver:true,addEventListener:(k,fn)=>{events[k]=fn;}};
  const context={document,window,matchMedia:q=>q.includes('reduced')?media:q.includes('max-width')?compact:pointer,
    requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),
    MutationObserver:class{constructor(fn){this.callback=fn;observers.push(this);}observe(){}},
    ResizeObserver:class{constructor(fn){this.callback=fn;this.observed=new Set();layouts.push(this);}observe(el){this.observed.add(el);}},
    IntersectionObserver:class{constructor(fn,options){this.callback=fn;this.options=options;this.observed=new Set();intersections.push(this);}observe(el){this.observed.add(el);}unobserve(el){this.observed.delete(el);}disconnect(){this.observed.clear();}}};
  vm.runInNewContext(fs.readFileSync('website/site-motion.js','utf8'),context);
  const flush=()=>{for(const [id,fn]of frames){frames.delete(id);fn();}};flush();
  return {root,document,window,events,frames,animations,observers,intersections,layouts,node,ids,content,offscreen,glass,ancestor,card,ambient,photo,header,progress,links,media,pointer,flush};
}

test('landing entrances run on touch screens, once per block, without moving optical containers',()=>{
  const h=harness();assert.equal(h.root.dataset.siteMotion,'on');assert.equal(h.animations.length,1);assert.equal(h.animations[0].el,h.content);
  assert(h.offscreen.classList.contains('site-reveal-pending'));assert.equal(h.intersections[0].options.threshold,0);
  assert.equal(h.intersections[0].options.rootMargin,'0px 0px 96px 0px');
  assert(h.intersections[0].observed.has(h.offscreen));h.intersections[0].callback([{target:h.offscreen,isIntersecting:true}]);
  h.intersections[0].callback([{target:h.offscreen,isIntersecting:true}]);assert.equal(h.animations.length,2);
  assert(h.animations.every(a=>a.el!==h.glass&&a.el!==h.ancestor));
  h.animations.at(-1).onfinish();assert.equal(h.offscreen.classList.contains('site-reveal-pending'),false);
});

test('touch and keyboard presses provide feedback while keeping native activation',()=>{
  const h=harness(),button=h.node();const before=h.animations.length;
  const touch={target:button,button:0,pointerType:'touch',pointerId:1,clientX:80,clientY:90};
  h.events.pointerdown(touch);assert.equal(h.animations.length,before);assert.equal(button.children.length,0);
  h.events.pointerup(touch);assert.equal(h.animations.length,before+2);assert.equal(button.children.length,1);
  h.animations.at(-1).onfinish();assert.equal(button.children.length,0);
  h.events.pointerdown({target:h.glass,button:0});h.events.pointerdown({target:h.node({disabled:true}),button:0});assert.equal(h.animations.length,before+2);
  h.events.keydown({target:button,key:'Enter',preventDefault(){assert.fail('Activation must stay native');}});assert.equal(h.animations.length,before+4);
});

test('fine-pointer tilt batches movement, resets on pause and stays off touch devices',()=>{
  const h=harness({fine:true});h.card.listeners.pointerenter({pointerType:'mouse'});
  h.card.listeners.pointermove({pointerType:'mouse',clientX:70,clientY:40});h.card.listeners.pointermove({pointerType:'mouse',clientX:220,clientY:20});
  assert.equal(h.frames.size,1);h.flush();assert.notEqual(h.card.style.values.get('--tilt-y'),'0deg');
  h.events['miracle:motion']({detail:{paused:true}});assert.equal(h.card.style.values.get('--tilt-y'),'0deg');assert(h.animations.every(a=>a.canceled));
  const touch=harness();touch.card.listeners.pointermove({pointerType:'touch',clientX:100,clientY:20});assert.equal(touch.frames.size,0);
});

test('pause, reduced motion and visibility clean up effects and background fades',()=>{
  const h=harness(),button=h.node();h.events.pointerdown({target:button,button:0});h.photo.animate([],{});
  h.document.hidden=true;h.events.visibilitychange();assert(h.animations.every(a=>a.canceled));assert.equal(button.children.length,0);assert.equal(h.root.dataset.siteMotion,'off');
  h.document.hidden=false;h.events.visibilitychange();h.flush();assert.equal(h.root.dataset.siteMotion,'on');
  h.media.matches=true;h.events.reduced();assert.equal(h.root.dataset.siteMotion,'off');
  assert.equal(harness({reduced:true}).animations.length,0);assert.equal(harness({paused:true}).animations.length,0);
  h.intersections[1].callback([{target:h.ambient,isIntersecting:false}]);assert.equal(h.ambient.dataset.motionVisible,'false');
});

test('scroll progress and active navigation follow the page without rewriting history',()=>{
  const h=harness(),reads=Object.values(h.ids).map(el=>el.rectReads);h.window.scrollY=900;h.events.scroll();h.events.scroll();assert.equal(h.frames.size,1);h.flush();
  assert.equal(h.progress.style.transform,'scaleX(0.5625)');assert.equal(h.root.style.writes,0);assert.equal(h.header.dataset.scrolled,'true');
  assert.equal(h.links[0].getAttribute('aria-current'),'location');assert.equal(h.links[1].getAttribute('aria-current'),null);
  assert.deepEqual(Object.values(h.ids).map(el=>el.rectReads),reads,'Scroll frames must reuse section geometry');
  const writes=h.progress.style.writes;h.events.scroll();h.flush();assert.equal(h.progress.style.writes,writes);
});

test('scroll drags, canceled gestures, multitouch and releasing elsewhere never play tap feedback',()=>{
  const h=harness(),button=h.node(),other=h.node(),before=h.animations.length;
  const touch={target:button,button:0,pointerType:'touch',pointerId:1,clientX:80,clientY:90};
  h.events.pointerdown(touch);h.events.pointermove({...touch,clientY:110});h.events.pointerup({...touch,clientY:110});
  h.events.pointerdown(touch);h.events.pointerup({...touch,clientY:110});
  h.events.pointerdown(touch);h.events.pointercancel(touch);h.events.pointerup(touch);
  h.events.pointerdown(touch);h.events.scroll();h.flush();h.events.pointerup(touch);
  h.events.pointerdown(touch);h.events.pointerdown({...touch,pointerId:2,isPrimary:false});h.events.pointerup(touch);
  h.events.pointerdown(touch);h.events.pointerup({...touch,target:other});
  assert.equal(h.animations.length,before);assert.equal(button.children.length,0);
});

test('touch and narrow layouts reveal directly without scale, bounce or delayed cascades',()=>{
  for(const options of [{},{fine:true,width:600}]){
    const h=harness(options),animation=h.animations[0];
    assert.equal(animation.frames.length,2);assert(animation.frames.every(frame=>!('scale'in frame)));
    assert.equal(animation.frames[0].translate,'0px 16px');assert.equal(animation.frames[1].translate,'0px 0px');
    assert.equal(animation.options.delay,0);assert.equal(animation.options.duration,520);
    h.events.resize();h.flush();assert.equal(animation.canceled,false,'Browser toolbar resizing must not restart an entrance');
  }
});

test('fast scrolling, focus and motion pause leave pending content visible without replay',()=>{
  const h=harness(),before=h.animations.length;
  h.offscreen.top=-90;h.intersections[0].callback([{target:h.offscreen,isIntersecting:true}]);
  assert.equal(h.animations.length,before);assert.equal(h.offscreen.classList.contains('site-reveal-pending'),false);
  const focused=harness();focused.events.focusin({target:focused.offscreen});
  assert.equal(focused.offscreen.classList.contains('site-reveal-pending'),false);assert.equal(focused.intersections[0].observed.has(focused.offscreen),false);
  focused.intersections[0].callback([{target:focused.offscreen,isIntersecting:true}]);assert.equal(focused.animations.length,1);
  const paused=harness();paused.events['miracle:motion']({detail:{paused:true}});assert.equal(paused.offscreen.classList.contains('site-reveal-pending'),false);
  const fallback=harness();fallback.offscreen.animate=null;fallback.intersections[0].callback([{target:fallback.offscreen,isIntersecting:true}]);assert.equal(fallback.offscreen.classList.contains('site-reveal-pending'),false);
});

test('layout changes refresh cached navigation while hidden mobile links require no section measurements',()=>{
  const h=harness();h.window.scrollY=900;h.events.scroll();h.flush();assert.equal(h.links[0].getAttribute('aria-current'),'location');
  h.ids.preview.baseTop=1400;h.root.scrollHeight=3000;h.layouts[0].callback([]);h.flush();
  assert.equal(h.links[1].getAttribute('aria-current'),'location');assert.equal(h.progress.style.transform,'scaleX(0.4091)');
  const mobile=harness({navHidden:true}),sections=['preview','experience','setup','questions'];
  assert(sections.every(id=>mobile.ids[id].rectReads===0));
  for(let i=0;i<20;i++){mobile.window.scrollY=i*50;mobile.events.scroll();mobile.flush();}
  assert(sections.every(id=>mobile.ids[id].rectReads===0));assert.equal(mobile.root.style.writes,0);assert.equal(mobile.card.style.writes,0);
});

test('scene feedback ignores repeated selected-state writes',()=>{
  const h=harness(),selected=h.node({selection:true,attrs:{'aria-pressed':'true'}});const count=h.animations.length;
  const record={target:selected,oldValue:'true'};h.observers[0].callback([record]);assert.equal(h.animations.length,count);
  h.observers[0].callback([{...record,oldValue:'false'}]);assert.equal(h.animations.length,count+1);
});

test('landscape changes preserve ambient animation and setup copies the actual release path',async()=>{
  const buttons=[],timers=new Map(),copied=[],fades=[];let timer=0,oldCanceled=0,ambientCanceled=0;
  const node=()=>({dataset:{},textContent:'',classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},addEventListener(k,fn){this[k]=fn;}});
  for(const scene of ['coast','alpine','aurora']){const button=node();button.dataset.scene=scene;buttons.push(button);}
  const photo=node();photo.getAnimations=()=>[{id:'',cancel(){ambientCanceled++;}},{id:'site-scene-fade',cancel(){oldCanceled++;}}];
  photo.animate=()=>{const fade={};fades.push(fade);return fade;};
  const status=node(),year=node(),copy=node(),copyLabel=node();copy.dataset.copy='release\\run.bat';copy.querySelector=()=>copyLabel;
  const root={dataset:{siteMotion:'on',motion:'running'}};
  const context={document:{documentElement:root,getElementById:id=>({heroWallpaper:photo,announcement:status,year})[id],querySelectorAll:q=>q==='[data-scene]'||q==='.scene'?buttons:q==='[data-copy]'?[copy]:[]},
    Image:class{decode(){return Promise.resolve();}},localStorage:{getItem:()=>null,setItem(){}},navigator:{clipboard:{writeText:async value=>copied.push(value)}},
    setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync('website/site.js','utf8'),context);
  buttons[1].click();await new Promise(setImmediate);assert.equal(photo.src,'assets/bg/alpine-new.webp');assert.equal(ambientCanceled,0);assert.equal(oldCanceled,1);assert.equal(fades[0].id,'site-scene-fade');
  root.dataset.siteMotion='off';buttons[2].click();await new Promise(setImmediate);assert.equal(fades.length,1);
  await copy.click();assert.deepEqual(copied,['release\\run.bat']);assert.equal(status.textContent,'Copied release\\run.bat');
});
