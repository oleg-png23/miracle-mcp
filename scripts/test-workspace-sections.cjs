const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('workspace screens preserve state, deep links, history and mobile More selection',()=>{
  const keys=['overview','executor','tools','chats','connection','appearance','usage','events','setupGuide'];
  const frames=[],events={},attrs=new Map();let focused;
  const make=()=>({hidden:false,dataset:{},style:{setProperty(){}},listeners:{},attrs:new Map(),
    classList:{values:new Set(),toggle(k,v){if(v)this.values.add(k);else this.values.delete(k);},contains(k){return this.values.has(k);}},
    setAttribute(k,v){this.attrs.set(k,v);},getAttribute(k){return this.attrs.get(k)||null;},removeAttribute(k){this.attrs.delete(k);},
    addEventListener(k,v){this.listeners[k]=v;},focus(){focused=this;},getBoundingClientRect:()=>({top:0,left:0,width:50,height:50})});
  const homeTitle=make();const screens=keys.map(key=>{const s=make();s.dataset.workspaceScreen=key;s.hidden=key!=='overview';s.querySelector=()=>homeTitle;return s;});
  const links=keys.map(key=>{const el=make();el.setAttribute('href','#'+key);if(keys.indexOf(key)>3)el.classList.values.add('desktop-only');return el;});
  const nav=make();nav.querySelector=()=>links.find(link=>link.classList.contains('active'));
  const menu=make();menu.open=false;menu.showModal=()=>{menu.open=true;};menu.close=()=>{menu.open=false;menu.listeners.close?.();};
  const ids={sectionViewTitle:make(),sectionHeading:make(),sectionBreadcrumb:make(),sectionViewDescription:make(),sectionMenu:menu,openSections:make(),closeSections:make()};
  const location={hash:'#appearance'},history={scrollRestoration:'auto',pushState:(_state,_title,url)=>{location.hash=url;}};
  const document={title:'Preview · Workspace',body:make(),querySelectorAll:q=>q==='[data-workspace-screen]'?screens:links,querySelector:()=>nav,
    getElementById:id=>ids[id],addEventListener:(event,fn)=>{events[event]=fn;},dispatchEvent(){}};
  const window={scrollY:0,scrollTo:({top})=>{window.scrollY=top;},addEventListener:(event,fn)=>{events[event]=fn;}};
  const context={window,document,location,history,matchMedia:()=>({matches:true}),requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},CustomEvent:class{}};
  const flush=()=>{while(frames.length)frames.shift()();};
  vm.runInNewContext(fs.readFileSync('scripts/workspace-sections.js','utf8'),context);flush();
  const api=window.MiracleSections,visible=()=>screens.filter(s=>!s.hidden).map(s=>s.dataset.workspaceScreen);
  assert.deepEqual(visible(),['appearance']);assert.equal(api.current(),'appearance');assert(ids.openSections.classList.contains('active'));
  const draft={value:'return "keep this draft"'};screens[1].editor=draft;
  api.open('executor');flush();assert.deepEqual(visible(),['executor']);assert.equal(focused,ids.sectionViewTitle);
  window.scrollY=180;api.open('tools');flush();assert.deepEqual(visible(),['tools']);assert.equal(window.scrollY,0);
  location.hash='#executor';events.popstate();flush();assert.equal(window.scrollY,180);assert.equal(screens[1].editor,draft);
  ids.openSections.listeners.click();assert(menu.open);assert.equal(ids.openSections.getAttribute('aria-expanded'),'true');
  api.open('usage');flush();assert(!menu.open);assert.deepEqual(visible(),['usage']);assert(ids.openSections.classList.contains('active'));
  api.open('overview');flush();assert(ids.sectionHeading.hidden);assert.equal(focused,homeTitle);assert(!ids.openSections.classList.contains('active'));
  location.hash='#unknown';events.hashchange();flush();assert.deepEqual(visible(),['overview']);
  let prevented=false;
  events.click({target:{closest:()=>links[3]},button:0,preventDefault(){prevented=true;}});flush();
  assert(prevented);assert.deepEqual(visible(),['chats']);assert.equal(location.hash,'#chats');
  assert.equal(history.scrollRestoration,'manual');
});

test('tool catalog requests definitions only and filters server-provided text safely',async()=>{
  const make=()=>({children:[],dataset:{},listeners:{},value:'',textContent:'',setAttribute(){},addEventListener(event,fn){this.listeners[event]=fn;},
    append(...children){this.children.push(...children);},replaceChildren(fragment){this.children=[...fragment.children];}});
  const ids={loadTools:make(),toolCatalog:make(),toolSearch:make(),toolsStatus:make(),toolsCount:make()};
  const requests=[];
  const context={window:{MiraclesBridge:{storage:{read:async()=>({host:'local',bridgeToken:'test-token'})},request:async(_host,path,body)=>{
    requests.push(path);assert.equal(body.token,'test-token');return {ok:true,tools:[{name:'inspect_scene',description:'Inspect the scene',inputSchema:{type:'object'}},{name:'<script>text only</script>',description:'Literal text',inputSchema:{}}]};}}},
    document:{getElementById:id=>ids[id],createElement:make,createDocumentFragment:make}};
  vm.runInNewContext(fs.readFileSync('scripts/tool-catalog.js','utf8'),context);
  await ids.loadTools.listeners.click();assert.deepEqual(requests,['/api/tools/list']);assert.equal(ids.toolCatalog.children.length,2);
  assert.equal(ids.toolCatalog.children[0].children[0].textContent,'<script>text only</script>');
  ids.toolSearch.value='scene';ids.toolSearch.listeners.input();assert.equal(ids.toolCatalog.children.filter(el=>!el.hidden).length,1);
  ids.toolSearch.value='not found';ids.toolSearch.listeners.input();assert.match(ids.toolsStatus.textContent,/No tools match/);
  assert.deepEqual(requests,['/api/tools/list'],'Searching must not make tool calls');
});
