const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('Beautify refracts every visible surface and restores the normal optical budget', () => {
  const frames = [];
  const media = {matches:false,addEventListener(){}};
  const makeNode = primary => ({primary,clientWidth:120,clientHeight:90,dataset:{},children:[],attrs:{},
    style:{setProperty(){},removeProperty(){}},append(el){this.children.push(el);},
    setAttribute(k,v){this.attrs[k]=v;},matches(){return this.primary;}});
  const elements = [makeNode(true),makeNode(true),makeNode(false),makeNode(false)];
  const body = makeNode();body.dataset={glassMode:'clear',glassChoice:'clear'};
  const root = makeNode();
  let intersection;
  const context = {window:{},document:{body,documentElement:root,hidden:false,
    querySelectorAll:()=>elements,getElementById:()=>null,addEventListener(){},
    createElementNS:()=>makeNode(),createElement:()=>({width:0,height:0,getContext:()=>({
      createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}}),toDataURL:()=> 'data:image/png;base64,demo'})},
    navigator:{userAgent:'Chrome/130'},CSS:{supports:()=>true},matchMedia:()=>media,
    ResizeObserver:class{observe(){}},IntersectionObserver:class{
      constructor(callback){intersection=callback;}observe(){}},
    requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},
    setTimeout:()=>0,clearTimeout(){},getComputedStyle:()=>({borderTopLeftRadius:'24'}),
    performance:{now:()=>0},Uint8ClampedArray};
  context.window.IntersectionObserver=context.IntersectionObserver;
  vm.runInNewContext(fs.readFileSync('scripts/dashboard-glass.js','utf8'),context);
  const engine=context.window.DashboardGlass;
  const flush=()=>{while(frames.length) frames.shift()();};
  intersection(elements.map(target=>({target,isIntersecting:true})));flush();
  assert.equal(engine.getMetrics().activeSurfaces,2);
  assert.equal(elements[2].dataset.glassPassive,'true');
  const heroFilter=body.children[0].children[0].children[0];
  const scale=()=>Number(heroFilter.children.find(n=>n.attrs.result==='bend-0').attrs.scale);
  const clearScale=scale();
  body.dataset.glassMode=body.dataset.glassChoice='beautify';engine.refresh();flush();
  assert.equal(engine.getMetrics().activeSurfaces,4);
  assert.equal(elements[2].dataset.glassPassive,'false');
  assert(scale()>clearScale*1.5);
  intersection([{target:elements[2],isIntersecting:false}]);flush();
  assert.equal(engine.getMetrics().activeSurfaces,3);
  body.dataset.glassMode=body.dataset.glassChoice='clear';engine.refresh();flush();
  assert.equal(engine.getMetrics().activeSurfaces,2);
  assert.equal(scale(),clearScale);
  for(const mode of ['frosted','light']){
    body.dataset.glassMode=body.dataset.glassChoice=mode;engine.refresh();flush();
    assert.equal(engine.getMetrics().activeSurfaces,0);
  }
  media.matches=true;
  body.dataset.glassMode=body.dataset.glassChoice='beautify';engine.refresh();flush();
  assert.equal(root.dataset.glassEngine,'light','Forced colors must disable optics');
});
