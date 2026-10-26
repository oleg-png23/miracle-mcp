/* Demo-only transport. No fetch, extension API, bootstrap or Studio execution. */
(() => {
  'use strict';
  const defaults = {host:'127.0.0.1:19731',bridgeToken:'preview-only',safeMode:true,
    dashboardWallpaper:'lime',dashboardWallpaperMode:'manual',dashboardMaterial:
      matchMedia('(prefers-reduced-transparency: reduce)').matches?'light':'clear',dashboardGlassDepth:68};
  let memory = {};
  const key = 'miracle.website.preview.settings';
  const allowed = ['dashboardWallpaper','dashboardWallpaperMode','dashboardMaterial','dashboardGlassDepth','safeMode'];
  const storage = {
    async read() {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* optional */ }
      return {...defaults,...Object.fromEntries(allowed.filter(k => saved && k in saved).map(k => [k,saved[k]])),...memory};
    },
    async set(values) {
      const clean = Object.fromEntries(allowed.filter(k => k in values).map(k => [k,values[k]]));
      memory = {...memory,...clean};
      try { const saved = await storage.read(); localStorage.setItem(key,JSON.stringify(Object.fromEntries(allowed.map(k => [k,saved[k]])))); } catch { /* memory fallback */ }
    }
  };
  const status = () => ({online:true,queue:0,uptime_s:3720,safe:true,version:'2.9.1',
    studio_linked:true,agent_sessions:[{site:'chatgpt.com',state:'watching',code:'',calls:3,age_s:1,client_version:'2.9.1',extension_version:'2.9.1'}],studio_mode:'native_mcp',native_mcp:{state:'ready',tools_count:12},
    usage:{tokens_total:24800,tokens_in:16400,tokens_out:8400,activations:18,sites:[
      {site:'chatgpt.com',activations:12,tokens_in:10400,tokens_out:5600},
      {site:'claude.ai',activations:6,tokens_in:6000,tokens_out:2800}]},
    recent:[{at:'Demo',src:'preview',text:'Sample workspace loaded. No local bridge is contacted.'},
      {at:'Demo',src:'studio',text:'Illustrative Studio connection with 12 tools.'}]});
  async function request(_address,path) {
    if(path === '/api/status') return status();
    if(path === '/api/tools/list') return {ok:true,demo:true,tools:[
      {name:'get_scene_info',description:'Example: inspect the open place.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
      {name:'run_code',description:'Example: execute Luau in the local application. Execution is disabled in this preview.',inputSchema:{type:'object',properties:{code:{type:'string'}},required:['code']}}]};
    if(path === '/api/auth') return {ok:true};
    throw new Error('Preview only. Download Miracle and open the local workspace to use Studio tools. Nothing was sent.');
  }
  function report(message,error=false) {
    const feedback = document.getElementById('actionFeedback');
    if(feedback){feedback.hidden=false;feedback.textContent=message;feedback.dataset.kind=error?'error':'info';}
    const box = document.getElementById('toasts');
    if(box){const item=document.createElement('div');item.className='toast';item.textContent=message;box.append(item);setTimeout(()=>item.remove(),5000);}
  }
  window.MiraclesBridge = {defaults,storage,request,bootstrap:()=>storage.read(),
    base:()=>'http://127.0.0.1:19731',
    diagnose:()=>({state:'linked',title:'Studio connected · Demo',message:'Sample data. This preview does not connect to Roblox Studio.'}),
    report,copy:text=>navigator.clipboard.writeText(text)};
  document.addEventListener('DOMContentLoaded',()=>{
    for(const id of ['setHost','setToken','saveSettings','resetSettings','toggleToken']){
      const el=document.getElementById(id);if(el){el.disabled=true;el.title='Connection settings are available in the local app.';}
    }
    const run=document.getElementById('runCode');if(run) run.firstChild.textContent='Preview only ';
  });
})();
