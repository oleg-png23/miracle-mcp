const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('widget lenses bound their textures, cache geometry and release hidden surfaces',()=>{
  const frames=[],maps=[];
  const node=()=>({children:[],attrs:{},style:{values:new Map(),setProperty(k,v){this.values.set(k,v);},removeProperty(k){this.values.delete(k);}},
    append(el){this.children.push(el);},setAttribute(k,v){this.attrs[k]=v;}});
  const toggle=Object.assign(node(),{clientWidth:128,clientHeight:50,radius:999});
  const panel=Object.assign(node(),{clientWidth:350,clientHeight:600,radius:30,hidden:true});
  const root=node();root.querySelectorAll=()=>[toggle,panel];
  const reduced={matches:false,addEventListener(){}},contrast={matches:false,addEventListener(){}};
  const context={navigator:{userAgent:'Chrome/130'},CSS:{supports:()=>true},ResizeObserver:class{observe(){}},
    matchMedia:q=>q.includes('transparency')?reduced:contrast,
    getComputedStyle:el=>({borderTopLeftRadius:String(el.radius)}),requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},
    document:{hidden:false,addEventListener(){},createElementNS:node,createElement:()=>({width:0,height:0,
      getContext:()=>({createImageData:(w,h)=>{const image={width:w,height:h,data:new Uint8ClampedArray(w*h*4)};maps.push(image);return image;},putImageData(){}}),toDataURL:()=> 'data:image/png;base64,test'})}};
  vm.runInNewContext(fs.readFileSync('content/widget-glass.js','utf8'),context);
  const api=context.MiracleWidgetGlass.mount(root);
  const flush=()=>{while(frames.length)frames.shift()();};flush();
  assert.equal(maps.length,1);assert(toggle.style.values.has('--widget-lens'));
  const map=maps[0],center=((Math.floor(map.height/2)*map.width)+Math.floor(map.width/2))*4;
  assert.equal(map.data[center],128);assert.equal(map.data[center+1],128);
  assert(map.data.some((value,i)=>i%4===0&&Math.abs(value-128)>20),'The rim must displace the backdrop');
  api.refresh();flush();assert.equal(maps.length,1,'Stable sizes reuse their map');
  panel.hidden=false;api.refresh();flush();assert.equal(maps.length,2);
  for(const map of maps)assert(map.width*map.height<=32768);
  assert(panel.style.values.has('--widget-lens'));
  panel.hidden=true;api.refresh();flush();assert(!panel.style.values.has('--widget-lens'));
  reduced.matches=true;api.refresh();flush();assert(!toggle.style.values.has('--widget-lens'));
  reduced.matches=false;context.document.hidden=true;api.refresh();flush();assert(!toggle.style.values.has('--widget-lens'));
});
