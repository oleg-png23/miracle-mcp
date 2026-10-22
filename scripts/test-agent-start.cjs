const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Run the actual content scripts with a deterministic chat DOM and clock.
function chat({rich=false,hold='',paste=true,toolCount=1}={}) {
  let now=0,nextTimer=0,readerScans=0,fullScans=0,execCalls=0,pastes=0,inputs=0,observer;
  const timers=new Map(), pending={}, sent=[], requests=[], elements=new Map();
  class Element {
    constructor(tag='div') { this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.dataset={};this.style={};this.value='';this.innerText='';this.textContent='';this.isConnected=true;this.disabled=false;this.hidden=false; }
    set id(v){this.attrs.id=v;elements.set(v,this);} get id(){return this.attrs.id;}
    setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')elements.set(v,this);if(k==='hidden')this.hidden=true;}
    getAttribute(k){return this.attrs[k]??null;}
    append(...nodes){this.children.push(...nodes);} prepend(...nodes){this.children.unshift(...nodes);}
    attachShadow(){return this.shadowRoot=new Element();}
    getElementById(id){return elements.get(id);}
    querySelector(q){return q==='small'?small:q==='.glyph'?glyph:q==='.actions'?actions:null;}
    querySelectorAll(){return [];}
    addEventListener(){} contains(el){return el===this;}
    closest(q){return this===composer&&q==='form'?form:null;}
    getRootNode(){return document;}
    getBoundingClientRect(){return {width:600,height:80,top:200};}
    matches(q){return this===composer&&(rich?q.includes('contenteditable'):q.includes('textarea'));}
    focus(){}
    dispatchEvent(event){
      if(event.type==='input') inputs++;
      if(event.type==='paste') {pastes++;if(paste){event.preventDefault();this.innerText=event.clipboardData.getData('text/plain');}}
      return !event.defaultPrevented;
    }
  }
  Object.defineProperty(Element.prototype,'value',{get(){return this._value||'';},set(v){this._value=v;},configurable:true});
  const small=new Element(),glyph=new Element(),actions=new Element(),composer=new Element(rich?'div':'textarea'),form=new Element('form'),send=new Element('button');
  send.setAttribute('aria-label','Send message');send.click=()=>{sent.push(rich?composer.innerText:composer.value);composer.value='';composer.innerText='';};
  form.querySelectorAll=()=>[send];composer.parentElement=form;
  const selection={removeAllRanges(){},addRange(){}};
  const document={body:new Element(),documentElement:new Element(),getElementById:()=>null,addEventListener(){},getSelection:()=>selection,
    createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag),createRange:()=>({selectNodeContents(){}}),
    querySelector:()=>null,querySelectorAll:q=>{
      if(q==='*') {fullScans++;return [];}
      if(q==='#prompt-textarea,textarea[data-id="root"]') return [composer];
      if(q==='[data-message-author-role="assistant"]') readerScans++;
      return [];
    },execCommand:(_cmd,_ui,value)=>{execCalls++;composer.innerText=value;inputs++;return true;}};
  const runtime={sendMessage(message,callback){requests.push(message.type);const respond=()=>callback(message.type==='MCP_HEALTH'?{online:true,authenticated:true,code:'READY',instance_id:'a'}:message.type==='MCP_TOOLS'?{ok:true,instance_id:'a',tools:Array.from({length:toolCount},(_,i)=>({name:'inspect_'+i,inputSchema:{type:'object',properties:{target:{type:'string'}}}}))}:{ok:true});
    if(message.type===hold) pending[message.type]=respond;else respond();}};
  class Event {constructor(type,options={}){this.type=type;Object.assign(this,options);}preventDefault(){this.defaultPrevented=true;}}
  const context={document,Element,HTMLTextAreaElement:Element,HTMLInputElement:Element,InputEvent:Event,ClipboardEvent:Event,
    DataTransfer:class{setData(k,v){this[k]=v;}getData(k){return this[k];}},
    chrome:{runtime},console:{warn(){}},DOMException,AbortController,crypto:{randomUUID:()=> 'session'},location:{hostname:'chatgpt.com'},
    window:{getSelection:()=>selection},getComputedStyle:()=>({visibility:'visible',display:'block'}),innerHeight:900,
    matchMedia:()=>({matches:true}),setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}}};
  vm.createContext(context);
  for(const file of ['scripts/chat-prompt.js','content/miracle.js']) vm.runInContext(fs.readFileSync(file,'utf8'),context);
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  async function advance(ms){const end=now+ms;await flush();while(true){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();await flush();}now=end;await flush();}
  return {elements,composer,sent,pending,requests,timers,advance,flush,start:()=>elements.get('agent-start').onclick(),stop:()=>elements.get('agent-stop').onclick(),mutate:()=>observer([{target:document.body}]),
    stats:()=>({readerScans,fullScans,execCalls,pastes,inputs})};
}

test('rich editor starts with one paste, no full-page walk and no telemetry wait',async()=>{
  const c=chat({rich:true,hold:'MCP_USAGE',toolCount:100});c.composer.innerText='Inspect my place';
  const start=c.start();await c.advance(1200);await start;
  assert.equal(c.sent.length,1);assert(c.sent[0].includes('Inspect my place'));
  assert.match(c.elements.get('status').textContent,/Session active/);
  assert.deepEqual(c.stats(),{readerScans:1,fullScans:0,execCalls:0,pastes:1,inputs:0});
  c.stop();await c.advance(16000);
});

test('textarea and plain contenteditable retain their supported input paths',async()=>{
  for(const options of [{},{rich:true,paste:false}]) {
    const c=chat(options);const start=c.start();await c.advance(1200);await start;
    assert.equal(c.sent.length,1,c.elements.get('status').textContent);assert.equal(c.stats().inputs,1);
    assert.equal(c.stats().execCalls,options.rich?1:0);c.stop();
  }
});

test('cancel during catalog loading prevents late instructions and permits retry',async()=>{
  const c=chat({hold:'MCP_TOOLS'});c.composer.value='Keep this draft';
  const start=c.start();await c.flush();
  assert.equal(c.elements.get('agent-stop').hidden,false);
  c.stop();await start;c.pending.MCP_TOOLS();await c.flush();
  assert.equal(c.composer.value,'Keep this draft');assert.equal(c.sent.length,0);
  assert.equal(c.elements.get('agent-start').disabled,false);
  assert.equal(c.elements.get('agent-stop').hidden,true);
  const retry=c.start();await c.flush();c.pending.MCP_TOOLS();await c.advance(1200);await retry;
  assert.equal(c.sent.length,1);c.stop();
});

test('unanswered extension request times out and restores Start session',async()=>{
  const c=chat({hold:'MCP_HEALTH'});const start=c.start();await c.advance(15000);await start;
  assert.match(c.elements.get('status').textContent,/timed out/);
  assert.equal(c.elements.get('agent-start').disabled,false);assert.equal(c.elements.get('agent-stop').hidden,true);
  c.pending.MCP_HEALTH();await c.flush();assert.equal(c.sent.length,0);
});

test('continuous page mutations cannot starve the assistant reader or scan per mutation',async()=>{
  const c=chat();const start=c.start();await c.advance(1700);await start;
  const before=c.stats().readerScans;
  for(let i=0;i<100;i++){c.mutate();await c.advance(10);}
  const scans=c.stats().readerScans-before;
  assert(scans>=2&&scans<=3,'Reader must run at bounded intervals during a mutation storm');
  c.stop();
});

test('stopping with a pending reader does not disable observation on the next session',async()=>{
  const c=chat();let start=c.start();await c.advance(1700);await start;
  c.mutate();c.stop();
  start=c.start();await c.advance(1700);await start;
  const before=c.stats().readerScans;c.mutate();await c.advance(450);
  assert.equal(c.stats().readerScans,before+1);c.stop();
});
