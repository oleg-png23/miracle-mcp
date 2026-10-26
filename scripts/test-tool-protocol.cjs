const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={};vm.runInNewContext(fs.readFileSync('scripts/tool-protocol.js','utf8'),context);
const parse=context.MiraclesToolProtocol.parse;
const envelope=call=>JSON.stringify({helium_tool:call});
const call={id:'step-1',name:'run_code',arguments:{code:'local x = {key="quoted } \\\" value"}; return x'}};
test('tool JSON survives fences, prose, nested braces and escaped strings',()=>{
  for(const text of [envelope(call),'```json\n'+envelope(call)+'\n```','I will run '+envelope(call)+' and read its result.']) {
    const parsed=parse(text);assert.equal(parsed.calls.length,1);assert.equal(parsed.calls[0].arguments.code,call.arguments.code);assert.equal(parsed.error,'');
  }
});
test('streamed fragments stay incomplete and cannot execute',()=>{
  const text=envelope({...call,arguments:{code:'x'.repeat(15000)}});
  assert.equal(parse(text.slice(0,-2)).calls.length,0);assert(parse(text.slice(0,-2)).incomplete);
  assert.equal(parse(text).calls.length,1);
});
test('legacy brand spelling aliases work but ordinary JSON and tool results never become commands',()=>{
  for(const key of ['miracles_tool','miracle_tool']) {
    for(const value of [JSON.stringify({[key]:call}),'Legacy reply: '+JSON.stringify({[key]:call})]) assert.equal(parse(value).calls.length,1);
  }
  const mixed=parse(JSON.stringify({helium_tool:call,miracles_tool:{...call,id:'other'}}));
  assert.equal(mixed.calls.length,0);assert.match(mixed.error,/exactly one/);
  for(const text of [JSON.stringify(call),'{"tool":"run_code","arguments":{}}','{"ok":true,"call_id":"step-1","result":{}}'])assert.equal(parse(text).calls.length,0);
});
test('duplicate ids, malformed arguments and oversized messages are diagnosed',()=>{
  const duplicated=envelope(call)+'\n'+envelope(call);assert.equal(parse(duplicated).calls.length,1);
  assert.match(parse(envelope(call)+envelope({...call,arguments:{code:'different'}})).error,/different arguments/);
  for(const bad of [{...call,id:'bad id'},{...call,id:'x'.repeat(81)},{...call,arguments:[]},{...call,arguments:null}])assert(parse(envelope(bad)).error);
  const huge=parse('x'.repeat(context.MiraclesToolProtocol.maxText+1));assert.equal(huge.calls.length,0);assert.match(huge.error,/1 MB/);
});
