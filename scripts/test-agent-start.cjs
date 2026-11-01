const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Run the actual content scripts with a deterministic chat DOM and clock.
function chat({rich=false,hold='',paste=true,toolCount=1}={}) {
  let now=0,nextTimer=0,readerScans=0,fullScans=0,execCalls=0,pastes=0,inputs=0,observer;
  const timers=new Map(), pending={}, sent=[], requests=[], messages=[], assistants=[], users=[], elements=new Map();
  let blockResultSend=false, streaming=false;
  class Element {
    constructor(tag='div') { this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.dataset={};this.style={};this.value='';this.innerText='';this.textContent='';this.isConnected=true;this.disabled=false;this.hidden=false; }
    set id(v){this.attrs.id=v;elements.set(v,this);} get id(){return this.attrs.id;}
    setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')elements.set(v,this);if(k==='hidden')this.hidden=true;}
    getAttribute(k){return this.attrs[k]??null;}
    append(...nodes){this.children.push(...nodes);} prepend(...nodes){this.children.unshift(...nodes);}
    attachShadow(){return this.shadowRoot=new Element();}
    getElementById(id){return elements.get(id);}
    querySelector(q){return q==='small'?small:q==='.glyph'?glyph:q==='.actions'?actions:null;}
    querySelectorAll(q){return q==='pre code, code'?(this.codes||[]):[];}
    addEventListener(){} contains(el){return el===this;}
    closest(q){if(q==='form'&&this===composer)return form;if(q==='[data-is-streaming="true"]'&&this.attrs['data-is-streaming']==='true')return this;return null;}
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
  send.setAttribute('aria-label','Send message');send.click=()=>{const value=rich?composer.innerText:composer.value;if(blockResultSend&&value.startsWith('Argon tool result:'))return;sent.push(value);const turn=new Element();turn.innerText=value;users.push(turn);composer.value='';composer.innerText='';};
  form.querySelectorAll=()=>[send];composer.parentElement=form;
  const selection={removeAllRanges(){},addRange(){}};
  const document={body:new Element(),documentElement:new Element(),getElementById:()=>null,addEventListener(){},getSelection:()=>selection,
    createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag),createRange:()=>({selectNodeContents(){}}),
    querySelector:()=>null,querySelectorAll:q=>{
      if(q==='*') {fullScans++;return [];}
      if(q==='#prompt-textarea,textarea[data-id="root"]') return [composer];
      if(q==='[data-message-author-role="assistant"]') {readerScans++;return assistants;}
      if(q.includes('[data-message-author-role="user"]'))return users;
      if(q==='[data-testid="stop-button"]')return streaming?[send]:[];
      return [];
    },execCommand:(_cmd,_ui,value)=>{execCalls++;composer.innerText=value;inputs++;return true;}};
  const runtime={sendMessage(message,callback){requests.push(message.type);messages.push(message);const respond=()=>callback(message.type==='MCP_HEALTH'?{online:true,authenticated:true,code:'READY',instance_id:'a'}:message.type==='MCP_TOOLS'?{ok:true,instance_id:'a',tools:Array.from({length:toolCount},(_,i)=>({name:'inspect_'+i,inputSchema:{type:'object',properties:{target:{type:'string'}}}}))}:message.type==='MCP_CALL'?{ok:true,instance_id:'a',result:{content:[{type:'text',text:'Tool result from Studio'}],isError:false}}:{ok:true});
    if(message.type===hold) pending[message.type]=respond;else respond();}};
  class Event {constructor(type,options={}){this.type=type;Object.assign(this,options);}preventDefault(){this.defaultPrevented=true;}}
  const context={document,Element,HTMLTextAreaElement:Element,HTMLInputElement:Element,InputEvent:Event,ClipboardEvent:Event,
    DataTransfer:class{setData(k,v){this[k]=v;}getData(k){return this[k];}},
    chrome:{runtime},console:{warn(){}},DOMException,AbortController,URL,crypto:{randomUUID:()=> 'session'},location:{hostname:'chatgpt.com',href:'https://chatgpt.com/c/test'},Date:{now:()=>now},navigator:{clipboard:{writeText:async()=>{}}},
    window:{getSelection:()=>selection},getComputedStyle:()=>({visibility:'visible',display:'block'}),innerHeight:900,
    matchMedia:()=>({matches:true}),setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}}};
  vm.createContext(context);
  for(const file of ['scripts/chat-prompt.js','scripts/tool-protocol.js','content/helium.js']) vm.runInContext(fs.readFileSync(file,'utf8'),context);
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  async function advance(ms){const end=now+ms;await flush();while(true){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();await flush();}now=end;await flush();}
  function reply(content,{code=false}={}){
    const node=new Element();node.setAttribute('data-message-author-role','assistant');node.innerText=content;node.textContent=content;
    if(code){const child=new Element('code');child.textContent=content;node.codes=[child];}
    assistants.push(node);return node;
  }
  return {location:context.location,elements,composer,sent,pending,requests,messages,timers,advance,flush,reply,
    setStreaming:value=>{streaming=value;},blockResults:value=>{blockResultSend=value;},clearUsers:()=>{users.length=0;},
    watch:()=>elements.get('agent-watch').onclick(),retry:()=>elements.get('retry-result').onclick(),start:()=>elements.get('agent-start').onclick(),stop:()=>elements.get('agent-stop').onclick(),mutate:()=>observer([{target:document.body}]),
    stats:()=>({readerScans,fullScans,execCalls,pastes,inputs})};
}

test('rich editor starts with one paste, no full-page walk and no telemetry wait',async()=>{
  const c=chat({rich:true,hold:'MCP_USAGE',toolCount:100});c.composer.innerText='Inspect my place';
  const start=c.start();await c.advance(1200);await start;
  assert.equal(c.sent.length,1);assert(c.sent[0].includes('Inspect my place'));
  assert.match(c.elements.get('status').textContent,/Session active/);
  assert.equal(c.stats().fullScans,0);assert.equal(c.stats().execCalls,0);assert.equal(c.stats().pastes,1);assert.equal(c.stats().inputs,0);
  assert(c.stats().readerScans<=3,'Only bounded reader scans during setup');
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
  assert(scans>=2&&scans<=5,'Reader must run at bounded intervals during a mutation storm');
  c.stop();
});

test('stopping with a pending reader does not disable observation on the next session',async()=>{
  const c=chat();let start=c.start();await c.advance(1700);await start;
  c.mutate();c.stop();
  start=c.start();await c.advance(1700);await start;
  const before=c.stats().readerScans;c.mutate();await c.advance(450);
  assert.equal(c.stats().readerScans,before+1);c.stop();
});

const command=(id='call-1',code='return 1')=>JSON.stringify({helium_tool:{id,name:'inspect_0',arguments:{code}}});
const calls=c=>c.messages.filter(message=>message.type==='MCP_CALL');
async function started(c){const task=c.start();await c.advance(1700);await task;}

test('a streamed JSON reply longer than 12 KB is not lost after a partial read',async()=>{
  const c=chat({hold:'MCP_USAGE'});await started(c);
  const full=command('long-call','-- '+ 'x'.repeat(14000)+'\nreturn {value="escaped \\\" brace }"}');
  const reply=c.reply(full.slice(0,-3),{code:true});
  await c.advance(1800);assert.equal(calls(c).length,0);
  reply.innerText=reply.textContent=reply.codes[0].textContent=full;
  await c.advance(4000);
  assert.equal(calls(c).length,1,c.elements.get('status').textContent);
  assert.equal(calls(c)[0].arguments.code,JSON.parse(full).helium_tool.arguments.code);
  assert(c.sent.at(-1).includes('Tool result from Studio'));
  assert.equal(c.elements.get('agent-stop').hidden,false);
  for(let i=0;i<30;i++)c.mutate();await c.advance(2000);assert.equal(calls(c).length,1);
  c.stop();await c.advance(16000);
});

test('reader catches completion without a final observed DOM mutation',async()=>{
  const c=chat();await started(c);c.setStreaming(true);
  c.reply('I will use this tool: '+command('unfenced')+' Then inspect the result.');
  await c.advance(2200);assert.equal(calls(c).length,0);
  c.setStreaming(false);await c.advance(4000);
  assert.equal(calls(c).length,1);assert(c.sent.at(-1).startsWith('Argon tool result:'));
  c.stop();
});

test('Watch attaches to the latest reply, preserves a draft and retries only result delivery',async()=>{
  const c=chat();c.reply(command('old-history'));c.reply(command('latest'));
  c.composer.value='Keep my unsent question';
  const watch=c.watch();await c.advance(3000);await watch;
  assert.equal(calls(c).length,1);assert(calls(c)[0].call_id.endsWith(':latest'));
  assert.equal(c.composer.value,'Keep my unsent question');assert.equal(c.sent.length,0);
  assert.equal(c.elements.get('last-result').hidden,false);
  assert.match(c.elements.get('status').textContent,/result is saved/);
  c.composer.value='';const retry=c.retry();await c.advance(2500);await retry;
  assert.equal(calls(c).length,1);assert.equal(c.sent.length,1);assert.match(c.sent[0],/Tool result from Studio/);
  assert.equal(c.elements.get('agent-stop').hidden,false);
  c.stop();const again=c.watch();await c.advance(3000);await again;
  assert.equal(calls(c).length,1,'Watching the same reply cannot run the tool again');c.stop();
});

test('a failed send preserves the result and retry uses the existing result draft',async()=>{
  const c=chat();await started(c);c.blockResults(true);c.reply(command('send-fails'));
  await c.advance(4000);assert.equal(calls(c).length,1);
  assert.match(c.composer.value,/Argon tool result:/);assert.equal(c.sent.length,1);
  assert.match(c.elements.get('status').textContent,/result is saved/);
  c.blockResults(false);const retry=c.retry();await c.advance(2200);await retry;
  assert.equal(calls(c).length,1);assert.equal(c.sent.length,2);c.stop();
});

test('Stop retains a late tool result without posting it to the chat',async()=>{
  const c=chat({hold:'MCP_CALL'});await started(c);c.reply(command('late'));
  await c.advance(1600);assert.equal(calls(c).length,1);c.stop();
  c.pending.MCP_CALL();await c.advance(1600);
  assert.equal(c.sent.length,1);assert.equal(c.elements.get('last-result').hidden,false);
  assert.match(c.elements.get('last-result-text').value,/Tool result from Studio/);
});

test('historical assistant JSON remains ineligible even when its text changes',async()=>{
  const c=chat();const old=c.reply(command('old'));await started(c);
  old.innerText=old.textContent=command('changed-old');await c.advance(3000);
  assert.equal(calls(c).length,0);c.stop();
});

test('malformed envelopes show a diagnostic and a corrected reply can still run',async()=>{
  const c=chat();await started(c);const reply=c.reply('{"miracles_tool":{"id":"bad id","name":"inspect_0","arguments":{}}}');
  await c.advance(1800);assert.equal(calls(c).length,0);assert.match(c.elements.get('status').textContent,/unique id/);
  reply.innerText=reply.textContent=command('fixed-id');await c.advance(4000);
  assert.equal(calls(c).length,1);c.stop();
});

test('a new ChatGPT conversation is adopted only when it contains this session prompt',async()=>{
  const c=chat();c.location.href='https://chatgpt.com/';
  const start=c.start();await c.advance(1200);await start;
  c.location.href='https://chatgpt.com/c/new';c.reply(command('new-chat'));
  await c.advance(4000);assert.equal(calls(c).length,1,c.elements.get('status').textContent);
  assert.match(c.sent[0],/\[Argon session session\]/);c.stop();
});

test('a new conversation without the session prompt is not adopted',async()=>{
  const c=chat();c.location.href='https://chatgpt.com/';
  const start=c.start();await c.advance(1200);await start;
  c.clearUsers();c.location.href='https://chatgpt.com/c/unrelated';c.reply(command('other-chat'));
  await c.advance(32000);assert.equal(calls(c).length,0);
  assert.match(c.elements.get('status').textContent,/conversation changed/);
});

test('switching chats during a tool call saves the result for the original conversation',async()=>{
  const c=chat({hold:'MCP_CALL'});await started(c);c.reply(command('late-switch'));
  await c.advance(1600);assert.equal(calls(c).length,1);
  c.location.href='https://chatgpt.com/c/other';c.mutate();await c.advance(500);
  c.pending.MCP_CALL();await c.advance(1600);
  assert.equal(c.sent.length,1);assert.equal(c.elements.get('last-result').hidden,false);
  const wrong=c.retry();await c.advance(1000);await wrong;
  assert.equal(c.sent.length,1);assert.match(c.elements.get('status').textContent,/original conversation/);
  c.location.href='https://chatgpt.com/c/test';const retry=c.retry();await c.advance(2500);await retry;
  assert.equal(c.sent.length,2);assert.equal(calls(c).length,1);c.stop();
});

test('a root chat cannot adopt a different conversation after its tool has started',async()=>{
  const c=chat({hold:'MCP_CALL'});c.location.href='https://chatgpt.com/';
  await started(c);c.reply(command('root-pending'));await c.advance(1600);
  assert.equal(calls(c).length,1);c.location.href='https://chatgpt.com/c/other';
  c.mutate();await c.advance(500);c.pending.MCP_CALL();await c.advance(1600);
  assert.equal(c.sent.length,1);assert.equal(c.elements.get('last-result').hidden,false);
  assert.match(c.elements.get('status').textContent,/conversation changed/);
});

test('switching chats after the result is filled still prevents sending',async()=>{
  const c=chat({hold:'MCP_CALL'});await started(c);c.reply(command('switch-before-send'));
  await c.advance(1600);c.pending.MCP_CALL();await c.flush();
  assert.match(c.composer.value,/Argon tool result/);
  c.location.href='https://chatgpt.com/c/other';await c.advance(3000);
  assert.equal(c.sent.length,1);assert.equal(c.elements.get('last-result').hidden,false);
  assert.match(c.elements.get('status').textContent,/result is saved/);
});

test('switching chats while setup is pending cannot send instructions into the new chat',async()=>{
  const c=chat({hold:'MCP_TOOLS'});c.composer.value='Existing draft';const start=c.start();await c.flush();
  c.location.href='https://chatgpt.com/c/other';c.pending.MCP_TOOLS();await c.advance(1200);await start;
  assert.equal(c.sent.length,0);assert.equal(c.composer.value,'Existing draft');
  assert.match(c.elements.get('status').textContent,/conversation changed/);
});
