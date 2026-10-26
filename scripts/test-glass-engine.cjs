const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function fixture({material='clear',deferred=false}={}) {
  const frames=[],timers=new Map(),decodes=[],events={};let timerId=0,intersection,resize;
  const media={matches:false,addEventListener(){}};
  const makeNode=primary=>({primary,clientWidth:120,clientHeight:90,dataset:{},children:[],attrs:{},writes:0,
    style:{values:new Map(),writes:0,removals:0,setProperty(k,v){this.values.set(k,v);this.writes++;},removeProperty(k){this.values.delete(k);this.removals++;}},
    append(el){this.children.push(el);el.parent=this;},remove(){this.parent.children=this.parent.children.filter(el=>el!==this);},
    setAttribute(k,v){this.attrs[k]=v;this.writes++;},getAttribute(k){return this.attrs[k];},matches(){return this.primary;}});
  const elements=[makeNode(true),makeNode(true),makeNode(false),makeNode(false)];
  const body=makeNode();body.dataset={glassMode:material,glassChoice:material};
  const root=makeNode();
  const context={window:{},document:{body,documentElement:root,hidden:false,
    querySelectorAll:()=>elements,
    getElementById:()=>null,addEventListener:(event,fn)=>{events[event]=fn;},
    createElementNS:()=>makeNode(),createElement:()=>({width:0,height:0,getContext:()=>({
      createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}}),toDataURL:()=> 'data:image/png;base64,demo'})},
    navigator:{userAgent:'Chrome/130'},CSS:{supports:()=>true},matchMedia:()=>media,
    ResizeObserver:class{constructor(fn){resize=fn;}observe(){}},IntersectionObserver:class{constructor(fn){intersection=fn;}observe(){}},
    requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},
    setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    getComputedStyle:()=>({borderTopLeftRadius:'24'}),performance:{now:()=>0},Uint8ClampedArray};
  if(deferred)context.Image=class{decode(){return new Promise(resolve=>decodes.push(resolve));}};
  context.window.IntersectionObserver=context.IntersectionObserver;
  vm.runInNewContext(fs.readFileSync('scripts/dashboard-glass.js','utf8'),context);
  const engine=context.window.DashboardGlass;
  const flush=()=>{for(const fn of timers.values())fn();timers.clear();while(frames.length)frames.shift()();};
  const seen=(target,visible)=>{intersection([{target,isIntersecting:visible}]);flush();};
  const filter=el=>{
    const id=el.style.values.get('--glass-filter')?.match(/#([^)]*)/)?.[1];
    return body.children[0].children[0].children.find(node=>node.attrs.id===id);
  };
  const decode=async()=>{decodes.splice(0).forEach(fn=>fn());await new Promise(setImmediate);flush();};
  return {elements,body,root,context,engine,media,events,flush,seen,filter,decode,resize:el=>{resize([{target:el}]);flush();}};
}

test('Beautify keeps every lens attached through viewport changes and hidden tabs',()=>{
  const f=fixture();const {elements,engine,body}=f;
  elements.forEach(el=>f.seen(el,true));
  assert.equal(engine.getMetrics().activeSurfaces,2);
  const scale=()=>Number(f.filter(elements[0]).children.find(n=>n.attrs.result==='bend-0').attrs.scale);
  const normal=scale();
  body.dataset.glassMode=body.dataset.glassChoice='beautify';engine.refresh();f.flush();
  assert.equal(engine.getMetrics().activeSurfaces,4);assert(scale()>normal*1.5);
  const maps=engine.getMetrics().mapsBuilt,writes=elements.map(el=>el.style.writes);
  for(let i=0;i<20;i++){f.seen(elements[i%4],false);f.seen(elements[i%4],true);engine.refresh();f.flush();}
  assert.equal(engine.getMetrics().activeSurfaces,4);
  assert.equal(engine.getMetrics().mapsBuilt,maps);
  assert.deepEqual(elements.map(el=>el.style.writes),writes,'Intersection chatter must not rebind the filter');
  f.context.document.hidden=true;f.events.visibilitychange();f.flush();assert.equal(engine.getMetrics().activeSurfaces,4);
  f.context.document.hidden=false;f.events.visibilitychange();f.flush();assert.deepEqual(elements.map(el=>el.style.writes),writes);
  body.dataset.glassMode=body.dataset.glassChoice='clear';engine.refresh();f.flush();
  assert.equal(engine.getMetrics().activeSurfaces,2);assert.equal(scale(),normal);
  f.seen(elements[0],false);assert.equal(elements[0].dataset.glassActive,'false','Clear retains its existing offscreen optimization');
  for(const mode of ['frosted','light']){body.dataset.glassMode=body.dataset.glassChoice=mode;engine.refresh();f.flush();assert.equal(engine.getMetrics().activeSurfaces,0);}
  f.media.matches=true;body.dataset.glassMode=body.dataset.glassChoice='beautify';engine.refresh();f.flush();
  assert.equal(f.root.dataset.glassEngine,'light');
});

test('Beautify retains the old lens until replacement images decode',async()=>{
  const f=fixture({material:'beautify',deferred:true});
  f.elements.forEach(el=>f.seen(el,true));await f.decode();
  const el=f.elements[0],original=el.style.values.get('--glass-filter');assert(original);
  const oldFilter=f.filter(el),oldMap=oldFilter.children[0].attrs.href;
  el.clientWidth+=25;f.resize(el);
  assert.equal(el.style.values.get('--glass-filter'),original);
  assert.equal(oldFilter.children[0].attrs.href,oldMap,'The active feImage is immutable');
  await f.decode();assert.notEqual(el.style.values.get('--glass-filter'),original);
  assert.equal(el.dataset.glassActive,'true');
  const maps=f.engine.getMetrics().mapsBuilt;f.resize(el);assert.equal(f.engine.getMetrics().mapsBuilt,maps);
  const stable=el.style.values.get('--glass-filter'),width=el.clientWidth;
  el.clientWidth+=17;f.resize(el);el.clientWidth=width;f.resize(el);
  await f.decode();assert.equal(el.style.values.get('--glass-filter'),stable,'An obsolete resize must not replace the restored geometry');
});

test('Liquid glass is colorless and retains the visible focal-lens budget across mode changes',async()=>{
  const f=fixture({material:'liquid',deferred:true});
  f.elements.forEach(el=>f.seen(el,true));await f.decode();
  const {engine,body,elements}=f;
  assert.equal(engine.getMetrics().activeSurfaces,2);
  const neutral=()=>f.filter(elements[0]).children;
  assert.equal(neutral().filter(n=>n.attrs.in==='SourceGraphic').length,1);
  assert.equal(neutral().filter(n=>String(n.attrs.result).startsWith('rgb-')).length,0);
  const original=elements[0].style.values.get('--glass-filter');
  body.dataset.glassMode=body.dataset.glassChoice='clear';engine.refresh();f.flush();await f.decode();
  assert.notEqual(elements[0].style.values.get('--glass-filter'),original);
  assert.equal(f.filter(elements[0]).children.filter(n=>String(n.attrs.result).startsWith('rgb-')).length,3);
  body.dataset.glassMode=body.dataset.glassChoice='liquid';engine.refresh();f.flush();await f.decode();
  assert.equal(neutral().filter(n=>String(n.attrs.result).startsWith('rgb-')).length,0);
  assert.equal(engine.getMetrics().activeSurfaces,2);
  const maps=engine.getMetrics().mapsBuilt;engine.setDepth(90);f.flush();assert.equal(engine.getMetrics().mapsBuilt,maps);
  f.seen(elements[0],false);assert.equal(elements[0].dataset.glassActive,'false');
});
