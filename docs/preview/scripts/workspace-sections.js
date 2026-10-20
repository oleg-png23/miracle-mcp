/* One persistent screen at a time; editor and settings DOM are never rebuilt. */
(() => {
  'use strict';
  const screens=new Map([...document.querySelectorAll('[data-workspace-screen]')].map(el=>[el.dataset.workspaceScreen,el]));
  if(!screens.size) return;
  const labels={overview:['Home','Your local creative workspace.'],executor:['Code','Write Luau, inspect the result and keep your draft.'],tools:['Studio tools','Explore the capabilities advertised by Studio.'],chats:['AI chats','Choose the chat where you want to create.'],connection:['Connection','Manage your local bridge connection.'],appearance:['Appearance','Choose your landscape and glass material.'],usage:['Usage','See the traffic passing through your bridge.'],events:['Events','Inspect recent bridge and Studio activity.'],setupGuide:['Setup guide','Connect Studio, the bridge and your chat.']};
  const aliases={home:'overview',code:'executor',guide:'setupGuide'};
  const title=document.getElementById('sectionViewTitle');
  const heading=document.getElementById('sectionHeading');
  const menu=document.getElementById('sectionMenu');
  const more=document.getElementById('openSections');
  const nav=document.querySelector('.navigation');
  const mobile=matchMedia('(max-width:650px)');
  const positions=new Map();let current=null;
  const preview=document.title.startsWith('Preview')?'Preview · ':'';
  function key(value) {
    let raw;try{raw=decodeURIComponent(String(value||'').replace(/^#/,''));}catch{raw='overview';}
    raw=aliases[raw]||raw;return screens.has(raw)?raw:'overview';
  }
  function closeMenu() {
    if(menu.open){if(typeof menu.close==='function')menu.close();else menu.removeAttribute('open');}
    more.setAttribute('aria-expanded','false');
  }
  function indicator() {
    const link=nav.querySelector('.nav-link.active');
    const useMore=mobile.matches&&Boolean(link?.classList.contains('desktop-only'));
    more.classList.toggle('active',useMore);
    const active=useMore?more:link;
    nav.classList.toggle('has-selection',Boolean(active));
    if(!active)return;
    const outer=nav.getBoundingClientRect(),inner=active.getBoundingClientRect();
    for(const [name,value] of Object.entries({x:inner.left-outer.left,y:inner.top-outer.top,width:inner.width,height:inner.height}))nav.style.setProperty('--nav-'+name,value+'px');
  }
  function show(value,{focus=false}={}) {
    const target=key(value);closeMenu();
    if(current!==target){
      if(current)positions.set(current,window.scrollY);
      for(const [name,screen]of screens)screen.hidden=name!==target;
      current=target;document.body.dataset.workspaceSection=target;
      const [label,description]=labels[target];
      title.textContent=label;document.getElementById('sectionBreadcrumb').textContent=label;
      document.getElementById('sectionViewDescription').textContent=description;
      heading.hidden=target==='overview';document.title=preview+label+' · Miracle';
      document.querySelectorAll('a[href^="#"]').forEach(link=>{
        const href=link.getAttribute('href');
        if(!screens.has(href.slice(1)))return;
        const active=href==='#'+target;link.classList.toggle('active',active);
        if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
      });
      window.scrollTo({top:positions.get(target)||0,left:0,behavior:'instant'});
      document.dispatchEvent(new CustomEvent('miracle:section',{detail:{section:target}}));
    }
    if(focus){const node=target==='overview'?screens.get(target).querySelector('h1'):title;node?.setAttribute('tabindex','-1');node?.focus({preventScroll:true});}
    requestAnimationFrame(()=>{indicator();window.DashboardGlass?.refresh();});
  }
  function open(value,options={focus:true}) {
    const target=key(value);
    if(location.hash!=='#'+target)history.pushState({workspaceSection:target},'','#'+target);
    show(target,options);
  }
  document.addEventListener('click',event=>{
    if(event.defaultPrevented||event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    const link=event.target.closest('a[href^="#"]');if(!link)return;
    const raw=link.getAttribute('href').slice(1);if(!screens.has(raw)&&!aliases[raw])return;
    event.preventDefault();open(raw);
  });
  more.addEventListener('click',()=>{
    if(typeof menu.showModal==='function')menu.showModal();else menu.setAttribute('open','');
    more.setAttribute('aria-expanded','true');document.getElementById('closeSections').focus();
  });
  document.getElementById('closeSections').addEventListener('click',closeMenu);
  menu.addEventListener('close',()=>more.setAttribute('aria-expanded','false'));
  menu.addEventListener('cancel',()=>more.setAttribute('aria-expanded','false'));
  menu.addEventListener('click',event=>{if(event.target===menu){const r=menu.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeMenu();}});
  window.addEventListener('hashchange',()=>show(location.hash,{focus:true}));
  window.addEventListener('popstate',()=>show(location.hash,{focus:true}));
  window.addEventListener('resize',indicator,{passive:true});
  if('ResizeObserver'in window)new ResizeObserver(indicator).observe(nav);
  document.fonts?.ready.then(indicator);
  if('scrollRestoration'in history)history.scrollRestoration='manual';
  window.MiracleSections={open,current:()=>current};
  show(location.hash);
})();
