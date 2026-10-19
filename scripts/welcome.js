(() => {
  'use strict';
  window.MiracleAppearance.setMode('auto');
  let timer=0,checking=false;
  function updateTime(){
    clearTimeout(timer);const date=new Date(),node=document.getElementById('welcomeTime');
    node.textContent=new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',hour12:false}).format(date);node.dateTime=date.toISOString();
    if(!document.hidden)timer=setTimeout(updateTime,(60-date.getSeconds())*1000-date.getMilliseconds()+50);
  }
  async function checkConnection(){
    if(checking||document.hidden)return;checking=true;
    const label=document.getElementById('welcomeStatus');
    try{
      const client=window.MiraclesBridge,settings=await client.storage.read();
      const data=await client.request(settings.host,'/api/status',undefined,5000);
      const ready=data.online===true&&data.native_mcp?.state==='ready';document.body.dataset.studioReady=String(ready);
      label.textContent=ready?'Studio MCP connected':data.online===true?'Bridge online · open Studio':'Start the local bridge';
    }catch{document.body.dataset.studioReady='false';label.textContent='Start the local bridge';}
    finally{checking=false;}
  }
  document.addEventListener('visibilitychange',()=>{updateTime();checkConnection();});updateTime();checkConnection();
})();
