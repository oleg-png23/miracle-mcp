/* Read the advertised catalog only; this screen never invokes Studio tools. */
(() => {
  'use strict';
  const button=document.getElementById('loadTools');if(!button)return;
  const list=document.getElementById('toolCatalog'),search=document.getElementById('toolSearch');
  const status=document.getElementById('toolsStatus'),count=document.getElementById('toolsCount');
  let tools=[],catalogMessage='';
  function filter() {
    const query=search.value.trim().toLowerCase();let visible=0;
    for(const row of list.children){row.hidden=!row.dataset.search.includes(query);if(!row.hidden)visible++;}
    count.textContent=visible+' / '+tools.length+' tools';
    if(tools.length)status.textContent=visible?catalogMessage:'No tools match your search.';
  }
  button.addEventListener('click',async()=>{
    button.disabled=true;button.setAttribute('aria-busy','true');status.textContent='Loading Studio tool catalog…';
    try {
      const client=window.MiraclesBridge,settings=await client.storage.read();
      if(!settings.bridgeToken)throw new Error('Connect the bridge first, then load the catalog.');
      const result=await client.request(settings.host,'/api/tools/list',{token:settings.bridgeToken},20000);
      if(!result.ok||!Array.isArray(result.tools))throw new Error(result.message||'Studio did not return a tool catalog.');
      tools=result.tools.filter(tool=>typeof tool?.name==='string').sort((a,b)=>a.name.localeCompare(b.name));
      const fragment=document.createDocumentFragment();
      for(const tool of tools){
        const row=document.createElement('details');row.className='tool-card';row.dataset.search=(tool.name+' '+String(tool.description||'')).toLowerCase();
        const summary=document.createElement('summary');summary.textContent=tool.name;
        const description=document.createElement('p');description.textContent=String(tool.description||'No description supplied by Studio.');
        const schema=document.createElement('pre');schema.textContent=JSON.stringify(tool.inputSchema||{},null,2);schema.setAttribute('aria-label',tool.name+' input schema');
        row.append(summary,description,schema);fragment.append(row);
      }
      list.replaceChildren(fragment);
      catalogMessage=result.demo?'Sample catalog for this preview. No Studio connection or tool execution.':'Catalog from your Studio. This screen only inspects tool definitions.';
      status.textContent=tools.length?catalogMessage:'Studio returned an empty tool catalog.';filter();
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='Refresh tools';}
  });
  search.addEventListener('input',filter);
})();
