const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const keys=['overview','executor','tools','chats','connection','appearance','usage','events','setupGuide'];

function navigation(){
  const events={},frames=[],emitted=[];let now=1000;
  const make=()=>({dataset:{},hidden:false,listeners:{},style:{setProperty(){}},attrs:new Map(),
    classList:{values:new Set(),toggle(k,v){if(v)this.values.add(k);else this.values.delete(k);},contains(k){return this.values.has(k);}},
    setAttribute(k,v){this.attrs.set(k,v);},getAttribute(k){return this.attrs.get(k)||null;},removeAttribute(k){this.attrs.delete(k);},
    addEventListener(k,fn){this.listeners[k]=fn;},focus(){},getBoundingClientRect:()=>({top:0,left:0,width:50,height:50})});
  const screens=keys.map(key=>{const el=make();el.dataset.workspaceScreen=key;el.querySelector=()=>make();return el;});
  const links=keys.map(key=>{const el=make();el.setAttribute('href','#'+key);return el;});
  const nav=make();nav.querySelector=()=>links.find(el=>el.classList.contains('active'));
  const menu=make();menu.open=false;menu.close=()=>{menu.open=false;};menu.showModal=()=>{menu.open=true;};
  const ids=Object.fromEntries(['main','sectionPosition','sectionViewTitle','sectionHeading','sectionBreadcrumb','sectionViewDescription','openSections','closeSections'].map(id=>[id,make()]));ids.sectionMenu=menu;
  const location={hash:'#overview'},media={matches:true};
  const history={scrollRestoration:'auto',pushState(_state,_title,url){location.hash=url;}};
  const document={title:'Helium',body:make(),querySelectorAll:q=>q==='[data-workspace-screen]'?screens:links,querySelector:()=>nav,
    getElementById:id=>ids[id],addEventListener:(k,fn)=>{events[k]=fn;},dispatchEvent:event=>emitted.push(event)};
  const window={innerWidth:390,scrollY:0,getSelection:()=>({isCollapsed:true}),scrollTo({top}){this.scrollY=top;},addEventListener:(k,fn)=>{events[k]=fn;}};
  const context={document,window,location,history,matchMedia:()=>media,Date:{now:()=>now},getComputedStyle:el=>({overflowX:el.overflowX||'visible'}),
    requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
  vm.runInNewContext(fs.readFileSync('scripts/workspace-sections.js','utf8'),context);
  const flush=()=>{while(frames.length)frames.shift()();};flush();
  const target=(options={})=>({closest:()=>options.ignore?{}:null,parentElement:ids.main,scrollWidth:0,clientWidth:100,...options});
  function start({x=300,y=200,node=target(),touches=1}={}){
    ids.main.listeners.touchstart({target:node,touches:Array.from({length:touches},(_,id)=>({identifier:id,clientX:x,clientY:y}))});
  }
  function move({x=80,y=200,cancelable=true}={}){
    let prevented=false;
    ids.main.listeners.touchmove({touches:[{identifier:0,clientX:x,clientY:y}],cancelable,preventDefault(){prevented=true;}});
    return prevented;
  }
  function end({x=80,y=200}={}){ids.main.listeners.touchend({touches:[],changedTouches:[{identifier:0,clientX:x,clientY:y}]});flush();}
  function swipe(options={}){start(options);const prevented=move({x:options.endX??80,y:options.endY??200});end({x:options.endX??80,y:options.endY??200});return prevented;}
  return {ids,events,window,media,emitted,target,start,move,end,swipe,api:window.MiracleSections,advance:ms=>{now+=ms;}};
}

test('mobile swipes traverse all screens in both directions without wrapping',()=>{
  const h=navigation();
  for(let i=1;i<keys.length;i++){
    assert(h.swipe());assert.equal(h.api.current(),keys[i]);assert.equal(h.ids.sectionPosition.textContent,`${i+1} / 9`);
    assert.equal(h.emitted.at(-1).detail.direction,1);
  }
  h.swipe();assert.equal(h.api.current(),'setupGuide');
  for(let i=keys.length-2;i>=0;i--){h.swipe({x:80,endX:300});assert.equal(h.api.current(),keys[i]);assert.equal(h.emitted.at(-1).detail.direction,-1);}
  h.swipe({x:80,endX:300});assert.equal(h.api.current(),'overview');
});

test('vertical scroll, short/diagonal drags, cancellation and browser edges never navigate',()=>{
  const h=navigation();
  assert(!h.swipe({endX:280,endY:400}));
  h.swipe({endX:270});h.swipe({endX:180,endY:330});
  h.swipe({x:10,endX:250});h.swipe({x:382,endX:80});
  h.start();h.move();h.ids.main.listeners.touchcancel();h.end();
  h.start({touches:2});assert(!h.move());h.end();
  h.start();assert(!h.move({cancelable:false}));h.end();
  h.start();h.advance(1000);assert(!h.move());h.end();
  assert.equal(h.api.current(),'overview');
});

test('editors, controls, selections, nested scrolling, modal menus and desktop retain their gestures',()=>{
  const h=navigation();
  assert(!h.swipe({node:h.target({ignore:true})}),'Native controls keep horizontal drags');
  assert(!h.swipe({node:h.target({scrollWidth:450,clientWidth:100,overflowX:'auto'})}));
  h.window.getSelection=()=>({isCollapsed:false});assert(!h.swipe());h.window.getSelection=()=>({isCollapsed:true});
  h.start();h.window.getSelection=()=>({isCollapsed:false});assert(!h.move());h.end();h.window.getSelection=()=>({isCollapsed:true});
  h.ids.sectionMenu.open=true;assert(!h.swipe());h.ids.sectionMenu.open=false;
  h.media.matches=false;assert(!h.swipe());h.media.matches=true;
  h.start();h.move();h.media.matches=false;h.end();h.media.matches=true;
  h.start();h.move();h.api.open('tools');h.end();assert.equal(h.api.current(),'tools');
});

test('a swipe suppresses its synthetic link click while keyboard and later taps still work',()=>{
  const h=navigation();h.swipe();let prevented=0,stopped=0;
  const click=detail=>h.ids.main.listeners.click({detail,preventDefault(){prevented++;},stopImmediatePropagation(){stopped++;}});
  click(1);assert.equal(prevented,1);assert.equal(stopped,1);
  click(0);assert.equal(prevented,1,'Keyboard activation remains available');
  h.advance(451);click(1);assert.equal(prevented,1,'A later tap remains available');
});

function motion({paused=false,reduced=false,desktop=false}={}){
  const events={},frames=new Map(),animations=[],observers=[],intersections=[];let next=0;
  function node(options={}){
    const el={hidden:false,top:100,bottom:140,glass:false,hasGlass:false,focused:false,
      getClientRects(){return this.hidden||this.screen?.hidden?[]:[{}];},
      getBoundingClientRect(){return {top:this.top,bottom:this.bottom};},
      matches(){return this.glass;},querySelector(){return this.hasGlass?{}:null;},contains(){return this.focused;},
      animate(keyframes,options){const animation={el:this,keyframes,options,canceled:false,cancel(){this.canceled=true;}};animations.push(animation);return animation;},...options};
    return el;
  }
  const screens=keys.map((key,index)=>{const el={dataset:{workspaceScreen:key},hidden:index!==0,nodes:[]};el.nodes=[node({screen:el}),node({screen:el})];el.querySelectorAll=selector=>el.nodes.filter(item=>!item.group||selector.split(',').some(part=>part.trim()===item.group));return el;});
  const heading={hidden:true,children:[node(),node()]},menu={open:false,children:[node(),node()]};
  const document={hidden:false,activeElement:null,body:{dataset:{workspaceSection:'overview'}},querySelectorAll:()=>screens,
    getElementById:id=>id==='sectionHeading'?heading:menu,addEventListener:(k,fn)=>{events[k]=fn;}};
  const media={matches:reduced,addEventListener:(k,fn)=>{events.reduce=fn;}};
  const window={innerHeight:800,IntersectionObserver:true,MutationObserver:true,addEventListener:(k,fn)=>{events[k]=fn;}};
  const context={document,window,localStorage:{getItem:()=>String(paused)},matchMedia:query=>query.startsWith('(min-width')?{matches:desktop}:media,
    requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),
    IntersectionObserver:class{constructor(callback){this.callback=callback;this.observed=new Set();intersections.push(this);}observe(el){this.observed.add(el);}unobserve(el){this.observed.delete(el);}disconnect(){this.observed.clear();}},
    MutationObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(el){this.target=el;}disconnect(){this.target=null;}}};
  vm.runInNewContext(fs.readFileSync('scripts/workspace-motion.js','utf8'),context);
  const flush=()=>{for(const [id,fn]of frames){frames.delete(id);fn();}};
  function enter(index,direction=1){screens.forEach((el,i)=>{el.hidden=i!==index;});heading.hidden=index===0;events['miracle:section']({detail:{section:keys[index],direction}});}
  return {screens,heading,menu,document,events,media,animations,observers,intersections,frames,node,flush,enter};
}

test('every screen reveals its content, cancels old animations and leaves glass stationary',()=>{
  const h=motion();assert.equal(h.animations.length,2);
  const first=[...h.animations];
  for(let i=1;i<keys.length;i++){
    const shell=h.node({glass:true}),ancestor=h.node({hasGlass:true});h.screens[i].nodes.push(shell,ancestor);
    const before=h.animations.length;h.enter(i);assert.equal(h.animations.length-before,4);
    assert(h.animations.slice(before).every(a=>a.el!==shell&&a.el!==ancestor));
    assert(h.animations.slice(before).every(a=>a.options.fill==='backwards'));
  }
  assert(first.every(a=>a.canceled));
  h.enter(1,-1);assert.match(h.animations.at(-1).keyframes[0].translate,/^-8px/);
  const last=h.animations.at(-1);last.onfinish();assert(last.canceled,'Finished reveals release their animation layer');
});

test('new cards reveal once; ordinary status refreshes do not replay entrances',()=>{
  const h=motion();h.enter(2);const before=h.animations.length;
  h.observers[0].callback([{type:'childList',addedNodes:[{nodeType:3}]}]);assert.equal(h.frames.size,0);
  const card=h.node({screen:h.screens[2]});h.screens[2].nodes.push(card);
  h.observers[0].callback([{type:'childList',addedNodes:[{nodeType:1}]}]);h.flush();
  assert.equal(h.animations.length,before+1);assert.equal(h.animations.at(-1).el,card);
  h.observers[0].callback([{type:'attributes',addedNodes:[]}]);h.flush();assert.equal(h.animations.length,before+1);
});

test('Home connection actions and agent contents reveal on desktop and mobile without moving their glass',()=>{
  for(const desktop of [false,true]){
    const h=motion({desktop}),home=h.screens[0];
    const actions=Array.from({length:3},()=>h.node({screen:home,group:'.connection-actions > *'}));
    const contents=[h.node({screen:home,group:'.agent-status > *'}),h.node({screen:home,group:'.agent-status > *'})];
    const glass=h.node({screen:home,group:'.agent-status > *',glass:true});
    const ancestor=h.node({screen:home,group:'.agent-status > *',hasGlass:true});
    home.nodes.push(...actions,...contents,glass,ancestor);
    const before=h.animations.length;
    h.observers[0].callback([{type:'childList',addedNodes:[{nodeType:1}]}]);h.flush();
    assert.deepEqual(h.animations.slice(before).map(animation=>animation.el),[...actions,...contents]);
    h.observers[0].callback([{type:'childList',addedNodes:[{nodeType:3}]}]);h.flush();
    assert.equal(h.animations.length,before+5,'Polling text must not replay entrances');
    const late=h.node({screen:home,group:'.connection-actions > *',top:1000,bottom:1040});home.nodes.push(late);
    h.observers[0].callback([{type:'childList',addedNodes:[{nodeType:1}]}]);h.flush();
    assert(h.intersections[0].observed.has(late));
    h.intersections[0].callback([{target:late,isIntersecting:true}]);
    assert.equal(h.animations.at(-1).el,late);
    h.events['miracle:motion']({detail:{paused:true}});
    assert(h.animations.every(animation=>animation.canceled));
    assert(h.animations.every(animation=>animation.el!==glass&&animation.el!==ancestor));
  }
});

test('offscreen content reveals on entry and motion preferences settle all active effects',()=>{
  const h=motion();h.screens[1].nodes[1].top=1000;h.screens[1].nodes[1].bottom=1040;h.enter(1);
  const observer=h.intersections[0],offscreen=h.screens[1].nodes[1];assert(observer.observed.has(offscreen));
  const before=h.animations.length;observer.callback([{target:offscreen,isIntersecting:true}]);assert.equal(h.animations.length,before+1);
  h.events['miracle:motion']({detail:{paused:true}});assert(h.animations.every(a=>a.canceled));
  h.enter(2);assert.equal(h.animations.length,before+1);
  h.events['miracle:motion']({detail:{paused:false}});h.enter(3);assert(h.animations.length>before+1);
  h.media.matches=true;h.events.reduce();assert(h.animations.every(a=>a.canceled));
  const count=h.animations.length;h.enter(4);assert.equal(h.animations.length,count);
  assert.equal(motion({reduced:true}).animations.length,0);assert.equal(motion({paused:true}).animations.length,0);
});

test('hidden tabs settle effects and an active editor is never animated',()=>{
  const h=motion();h.screens[1].nodes[0].focused=true;const before=h.animations.length;h.enter(1);
  assert.equal(h.animations.length-before,3);
  h.document.hidden=true;h.events.visibilitychange();assert(h.animations.every(a=>a.canceled));
  const count=h.animations.length;h.enter(2);assert.equal(h.animations.length,count);
  h.document.hidden=false;h.events.visibilitychange();h.flush();assert.equal(h.animations.length,count);
});


test('desktop sections use a short reveal cascade and stagger every menu link',()=>{
  const h=motion({desktop:true});assert.equal(h.animations[0].options.duration,360);assert.equal(h.animations[1].options.delay,28);
  h.menu.open=true;h.menu.querySelectorAll=()=>Array.from({length:11},()=>h.node());
  const before=h.animations.length;h.observers[1].callback();assert.equal(h.animations.length-before,11);
  assert.equal(h.animations.at(-1).options.delay,112);
});
