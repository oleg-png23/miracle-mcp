(() => {
  'use strict';
  const number=new Intl.NumberFormat('en-US');
  let siteSignature='';
  function show(id,value){const node=document.getElementById(id);if(node&&node.textContent!==value)node.textContent=value;}
  document.addEventListener('miracles:status',event=>{
    const usage=event.detail?.data?.usage;if(!usage)return;
    show('usageTokens','≈ '+number.format(usage.tokens_total||0));
    show('usageInput',number.format(usage.tokens_in||0));show('usageOutput',number.format(usage.tokens_out||0));
    show('usageActivations',number.format(usage.activations||0));
    const sites=Array.isArray(usage.sites)?usage.sites:[];
    show('usageSiteCount',number.format(sites.length));
    const list=document.getElementById('usageSites');if(!list)return;
    const signature=JSON.stringify(sites.map(site=>[site.site,site.activations||0,site.tokens_in||0,site.tokens_out||0]));
    if(signature!==siteSignature){
      siteSignature=signature;
      const fragment=document.createDocumentFragment();
      for(const site of sites){
        const row=document.createElement('tr');
        for(const value of [site.site,number.format(site.activations||0),'≈ '+number.format((site.tokens_in||0)+(site.tokens_out||0))]){
          const cell=document.createElement('td');cell.textContent=value;row.append(cell);
        }
        fragment.append(row);
      }
      list.replaceChildren(fragment);
    }
    document.getElementById('usageEmpty').hidden=sites.length>0;
    show('usageEmpty','No sessions recorded yet. Start Miracle in an AI chat.');
    document.getElementById('usageTable').hidden=!sites.length;
  });
})();
