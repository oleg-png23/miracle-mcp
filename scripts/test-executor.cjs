const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function workspace({saved=new Map(),requestExecute=async()=>({id:7})}={}){
  const elements=new Map(),events=new Map(),timers=new Map(),requests=[];let timerId=0,uuid=0;
  function element(id){
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',dataset:{},firstChild:{textContent:''},listeners:{},
      setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;},focus(){}});
    return elements.get(id);
  }
  const settings={host:'127.0.0.1:19731',bridgeToken:'fixture-token'};
  const local=new Map([['miracles.code','return 1']]);
  const store=map=>({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
  const client={storage:{read:async()=>settings},diagnose:()=>({state:'linked'}),report(){},
    request:async(host,path,body)=>{
      if(path==='/api/status')return {online:true,instance_id:'instance-a'};
      if(path==='/api/execute'){requests.push(body);return requestExecute(body,requests.length);}
      throw new Error('Unexpected request '+path);
    }};
  const context={document:{getElementById:element,addEventListener:(type,fn)=>events.set(type,fn)},
    window:{MiraclesBridge:client,MiraclesPrompt:{intro:'fixture'},MiraclesDashboard:{refresh(){}}},
    localStorage:store(local),sessionStorage:store(saved),crypto:{randomUUID:()=>`uuid-${++uuid}`},Date,
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync('scripts/executor.js','utf8'),context);
  return {saved,elements,requests,run:()=>element('runCode').listeners.click(),
    expire:()=>{for(const [id,timer] of [...timers])if(timer.ms===0||timer.ms>1000){timers.delete(id);timer.fn();}},
    result:row=>events.get('miracles:status')({detail:{host:settings.host,data:{instance_id:'instance-a',results:[row]}}})};
}

test('a lost manual acknowledgement retries the original ID and preserves it across reload',async()=>{
  const saved=new Map();
  const first=workspace({saved,requestExecute:async()=>{throw new TypeError('connection closed');}});
  await first.run();
  assert.equal(first.requests.length,1);
  const intent=JSON.parse(saved.get('miracles.pending'));
  assert.equal(intent.id,null);assert.equal(intent.call_id,first.requests[0].call_id);
  const restored=workspace({saved});restored.expire();await restored.run();
  assert.equal(restored.requests[0].call_id,intent.call_id);
  assert.equal(restored.requests[0].instance_id,'instance-a');
  assert.equal(JSON.parse(saved.get('miracles.pending')).id,7);
});

test('the original result can complete a manual task whose acknowledgement was lost',async()=>{
  const page=workspace({requestExecute:async()=>{throw new TypeError('connection closed');}});
  await page.run();
  page.result({id:7,call_id:page.requests[0].call_id,ok:true,output:'Completed once',elapsed_ms:5});
  assert.match(page.elements.get('executionTitle').textContent,/Completed in Studio/);
  assert.equal(page.elements.get('executionOutput').textContent,'Completed once');
  assert.equal(page.saved.has('miracles.pending'),false);
  assert.equal(page.elements.get('runCode').disabled,false);
});

test('changing code cannot replace an unconfirmed manual task with a new request',async()=>{
  const page=workspace({requestExecute:async()=>{throw new TypeError('connection closed');}});
  await page.run();page.expire();page.elements.get('luauCode').value='return 2';await page.run();
  assert.equal(page.requests.length,1);
  assert.match(page.elements.get('executionTitle').textContent,/Previous task unconfirmed/);
});

test('a rejected admission releases the manual intent because execution never started',async()=>{
  const page=workspace({requestExecute:async()=>{throw Object.assign(new Error('queue full'),{httpStatus:429,not_sent:true});}});
  await page.run();
  assert.equal(page.saved.has('miracles.pending'),false);
  assert.equal(page.elements.get('runCode').disabled,false);
});

test('a status result received before an acknowledgement is never replaced with pending state',async()=>{
  for(const loseAck of [false,true]){
    const page=workspace({requestExecute:async body=>{
      page.result({id:7,call_id:body.call_id,ok:true,output:'Completed first'});
      if(loseAck)throw new TypeError('lost acknowledgement');
      return {id:7};
    }});
    await page.run();
    assert.match(page.elements.get('executionTitle').textContent,/Completed in Studio/);
    assert.equal(page.saved.has('miracles.pending'),false);
    assert.equal(page.elements.get('runCode').disabled,false);
  }
});

test('a preview refusal never leaves an unconfirmed task behind',async()=>{
  const page=workspace({requestExecute:async()=>{throw Object.assign(new Error('Preview only. Nothing was sent.'),{not_sent:true});}});
  await page.run();
  assert.equal(page.saved.has('miracles.pending'),false);
  assert.match(page.elements.get('executionOutput').textContent,/Nothing was sent/);
  assert.equal(page.elements.get('runCode').disabled,false);
});

test('a cached completion resolves a recovered manual request without waiting for a status row',async()=>{
  const saved=new Map([['miracles.pending',JSON.stringify({id:null,call_id:'manual:original',luau:'return 1',host:'127.0.0.1:19731',instance:'instance-a',created:Date.now()-80000})]]);
  const page=workspace({saved,requestExecute:async()=>({id:7,completion:{id:7,ok:true,output:'Original cached output'}})});
  page.expire();await page.run();
  assert.equal(page.requests[0].call_id,'manual:original');
  assert.match(page.elements.get('executionTitle').textContent,/Completed in Studio/);
  assert.equal(page.elements.get('executionOutput').textContent,'Original cached output');
  assert.equal(page.saved.has('miracles.pending'),false);
});
