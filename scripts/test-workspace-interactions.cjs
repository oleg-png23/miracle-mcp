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
  const document={title:'Argon',body:make(),querySelectorAll:q=>q==='[data-workspace-screen]'?screens:links,querySelector:()=>nav,
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
