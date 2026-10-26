const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function dashboard(){
 const ids=Object.fromEntries(['agentState','agentHint','chatAgent','copyDiagnostics'].map(id=>[id,{textContent:'',dataset:{},addEventListener(_name,fn){this.click=fn;}}]));
 const events={},copied=[],reports=[];
 const context={document:{getElementById:id=>ids[id],body:{dataset:{appVersion:'2.9.0'}},addEventListener:(event,fn)=>{events[event]=fn;}},window:{MiraclesBridge:{copy:async value=>{copied.push(value);},report:(...args)=>reports.push(args)}}};
 vm.runInNewContext(fs.readFileSync('scripts/agent-status.js','utf8'),context);
 const render=data=>events['miracles:status']({detail:{host:'127.0.0.1:19731',data:{version:'2.9.0',native_mcp:{state:'ready',tools_count:2},studio_linked:true,...data}}});
 return {ids,events,copied,reports,render};
}
test('dashboard distinguishes Studio connectivity, inactive chat and saved results',()=>{
 const d=dashboard();d.render({});assert.match(d.ids.agentHint.textContent,/reader is stopped/);
 d.render({version:'2.2.0'});assert.match(d.ids.agentState.textContent,/Update the running bridge/);
 d.render({agent_sessions:[{site:'chatgpt.com',state:'paused',code:'RESULT_NOT_SENT',calls:1,age_s:0}]});
 assert.match(d.ids.agentHint.textContent,/does not run the tool again/);
 d.render({agent_sessions:[{site:'chatgpt.com',state:'watching',calls:1,age_s:0,client_version:'2.2.0'}]});
 assert.match(d.ids.agentState.textContent,/Reload/);
 d.events['miracles:offline']();assert.equal(d.ids.agentState.textContent,'Bridge unavailable');
});
test('connection reports exclude tokens, arguments, URLs, results and native messages',async()=>{
 const d=dashboard();d.render({bridgeToken:'PRIVATE_TOKEN',recent:[{text:'PRIVATE_CHAT'}],results:[{output:'PRIVATE_CODE'}],
 native_mcp:{state:'ready',tools_count:2,message:'PRIVATE_PATH'},agent_sessions:[{site:'chatgpt.com',state:'watching',calls:2,age_s:1,session_id:'PRIVATE_SESSION',arguments:{code:'PRIVATE_SOURCE'},url:'https://chatgpt.com/c/PRIVATE_URL'}]});
 await d.ids.copyDiagnostics.click();assert.equal(d.copied.length,1);assert.doesNotMatch(d.copied[0],/PRIVATE_/);
 assert.equal(JSON.parse(d.copied[0]).studio_state,'ready');assert.equal(JSON.parse(d.copied[0]).agents[0].site,'chatgpt.com');
});
