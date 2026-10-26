/* One persistent screen at a time; editor and settings DOM are never rebuilt. */
(() => {
  'use strict';
  const screens=new Map([...document.querySelectorAll('[data-workspace-screen]')].map(el=>[el.dataset.workspaceScreen,el]));
  if(!screens.size) return;
  const labels={overview:['Home','Your local creative workspace.'],executor:['Code','From a first line of Luau to something you can play.'],tools:['Studio tools','Find the right tool for your next idea.'],chats:['AI chats','Your favourite AI. Your creative flow.'],connection:['Connection','Manage your local bridge connection.'],appearance:['Appearance','Two color palettes. Choose your mood.'],usage:['Usage','Follow the conversation between your chat and Studio.'],events:['Events','Inspect recent bridge and Studio activity.'],setupGuide:['Setup guide','Connect Studio, the bridge and your chat.']};
  const aliases={home:'overview',code:'executor',guide:'setupGuide'};
  const title=document.getElementById('sectionViewTitle');
  const heading=document.getElementById('sectionHeading');
  const menu=document.getElementById('sectionMenu');
  const more=document.getElementById('openSections');
  const nav=document.querySelector('.navigation');
  const mobile=matchMedia('(max-width:650px)');
  const order=[...screens.keys()];
  const main=document.getElementById('main');
  const position=document.getElementById('sectionPosition');
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
      const direction=current?Math.sign(order.indexOf(target)-order.indexOf(current)):0;
      if(current)positions.set(current,window.scrollY);
      for(const [name,screen]of screens)screen.hidden=name!==target;
      current=target;document.body.dataset.workspaceSection=target;
      const [label,description]=labels[target];
      title.textContent=label;document.getElementById('sectionBreadcrumb').textContent=label;
      document.getElementById('sectionViewDescription').textContent=description;
      heading.hidden=target==='overview';document.title=preview+label+' · Miracle';
      if(position)position.textContent=(order.indexOf(target)+1)+' / '+order.length;
      document.querySelectorAll('a[href^="#"]').forEach(link=>{
        const href=link.getAttribute('href');
        if(!screens.has(href.slice(1)))return;
        const active=href==='#'+target;link.classList.toggle('active',active);
        if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
      });
      window.scrollTo({top:positions.get(target)||0,left:0,behavior:'instant'});
      document.dispatchEvent(new CustomEvent('miracle:section',{detail:{section:target,direction}}));
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
  // Touch gestures stay local to the content. Browser edge gestures, vertical
  // scrolling, selection, editors, controls and nested scrollers keep ownership.
  if(main){
    let gesture=null,suppressClickUntil=0;
    const ignore='input,textarea,select,button,summary,[contenteditable]:not([contenteditable="false"]),pre,.log-entries,.usage-table-wrap,[data-no-swipe]';
    function blocked(target){
      if(!target?.closest||target.closest(ignore))return true;
      for(let el=target;el&&el!==main;el=el.parentElement){
        if(el.scrollWidth>el.clientWidth+2&&/(auto|scroll)/.test(getComputedStyle(el).overflowX))return true;
      }
      return false;
    }
    main.addEventListener('touchstart',event=>{
      gesture=null;
      if(!mobile.matches||menu.open||event.defaultPrevented||event.touches.length!==1||blocked(event.target))return;
      if(window.getSelection?.()?.isCollapsed===false)return;
      const touch=event.touches[0];
      if(touch.clientX<24||touch.clientX>window.innerWidth-24)return;
      gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,start:Date.now(),section:current,horizontal:false};
    },{passive:true});
    main.addEventListener('touchmove',event=>{
      if(!gesture)return;
      if(event.defaultPrevented||event.touches.length!==1||!mobile.matches||menu.open||current!==gesture.section||Date.now()-gesture.start>900||window.getSelection?.()?.isCollapsed===false){gesture=null;return;}
      const touch=[...event.touches].find(t=>t.identifier===gesture.id);if(!touch){gesture=null;return;}
      const dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
      if(!gesture.horizontal){
        if(Math.max(Math.abs(dx),Math.abs(dy))<12)return;
        if(Math.abs(dx)<Math.abs(dy)*1.4){gesture=null;return;}
        gesture.horizontal=true;
      }
      if(!event.cancelable){gesture=null;return;}
      event.preventDefault();
    },{passive:false});
    main.addEventListener('touchend',event=>{
      const swipe=gesture;gesture=null;
      if(!swipe||!swipe.horizontal)return;
      suppressClickUntil=Date.now()+450;
      if(!mobile.matches||menu.open||current!==swipe.section||event.touches.length||Date.now()-swipe.start>900)return;
      const touch=[...event.changedTouches].find(t=>t.identifier===swipe.id);if(!touch)return;
      const dx=touch.clientX-swipe.x,dy=touch.clientY-swipe.y;
      const threshold=Math.max(48,Math.min(88,window.innerWidth*.18));
      if(Math.abs(dx)<threshold||Math.abs(dx)<Math.abs(dy)*1.4)return;
      const next=order[order.indexOf(current)+(dx<0?1:-1)];
      if(next)open(next);
    },{passive:true});
    main.addEventListener('touchcancel',()=>{gesture=null;},{passive:true});
    main.addEventListener('click',event=>{
      if(event.detail&&Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    window.addEventListener('blur',()=>{gesture=null;});
  }
  if('scrollRestoration'in history)history.scrollRestoration='manual';
  window.MiracleSections={open,current:()=>current};
  show(location.hash);
})();
