/* Reveal content, never transform/opacity a live glass surface or its ancestor. */
(() => {
  'use strict';
  const screens=[...document.querySelectorAll('[data-workspace-screen]')];
  if(!screens.length)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const desktop=matchMedia('(min-width:651px) and (hover:hover) and (pointer:fine)');
  const heading=document.getElementById('sectionHeading');
  const menu=document.getElementById('sectionMenu');
  const selector='.page-heading > *, .hero-card > *, .metric > *, .panel > :not(.chat-services):not(.tool-catalog), .workspace-shortcuts > a, .chat-services > a, .tool-catalog > details';
  const desktopSelector='.page-heading > :not(div), .page-heading > div > *, .hero-card > *, .metric > *, .panel > :not(.chat-services):not(.tool-catalog):not(form):not(.usage-metrics):not(.usage-directions):not(.usage-table-wrap):not(.log-entries):not(.setup-steps), .panel form > *, .workspace-shortcuts > a, .chat-services > a, .tool-catalog > details, .usage-metrics > *, .usage-directions > *, .usage-table-wrap tbody > tr, .log-entries > .log-entry, .setup-guide .setup-steps > li';
  const active=new Map(),waiting=new Map();
  let screen=null,seen=new WeakSet(),direction=0,frame=0,paused=false;
  try{paused=(localStorage.getItem('miracle.motionPaused')??localStorage.getItem('miracle.welcome.motionPaused'))==='true';}catch{/* optional */}
  const allowed=()=>!paused&&!reduced.matches&&!document.hidden;
  function settle(){
    cancelAnimationFrame(frame);frame=0;
    active.forEach(animation=>animation.cancel());active.clear();
    intersection?.disconnect();waiting.clear();
  }
  function play(el,index=0){
    if(seen.has(el))return;
    seen.add(el);
    if(!allowed()||typeof el.animate!=='function'||el.contains(document.activeElement))return;
    active.get(el)?.cancel();
    const distance=window.innerWidth<=650?6:8;
    const animation=el.animate([
      {opacity:0,translate:`${direction*distance}px 8px`},
      {opacity:1,translate:'0px 0px'}
    ],{duration:desktop.matches?360:320,delay:Math.min(index*28,112),easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards'});
    active.set(el,animation);
    animation.onfinish=()=>{if(active.get(el)===animation)active.delete(el);animation.cancel();};
  }
  const intersection='IntersectionObserver'in window?new IntersectionObserver(entries=>{
    let index=0;
    for(const entry of entries){
      if(!entry.isIntersecting||!waiting.has(entry.target))continue;
      waiting.delete(entry.target);intersection.unobserve(entry.target);play(entry.target,index++);
    }
  },{threshold:.06}):null;
  function collect(){
    frame=0;if(!screen||screen.hidden)return;
    const nodes=[...(heading&&!heading.hidden?heading.children:[]),...screen.querySelectorAll(desktop.matches?desktopSelector:selector)];
    let index=0;
    for(const el of nodes){
      if(seen.has(el)||waiting.has(el)||el.hidden||!el.getClientRects().length)continue;
      // Future panels can safely contain another optical surface.
      if(el.matches('.glass')||el.querySelector('.glass'))continue;
      if(!allowed()){seen.add(el);continue;}
      const rect=el.getBoundingClientRect();
      if(intersection&&(rect.top>=window.innerHeight||rect.bottom<=0)){
        waiting.set(el,true);intersection.observe(el);
      }else play(el,index++);
    }
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(collect);}
  const changes='MutationObserver'in window?new MutationObserver(records=>{
    // Status text refreshes must not replay entrances or create idle work.
    if(records.some(record=>record.type==='attributes'||[...record.addedNodes].some(node=>node.nodeType===1)))schedule();
  }):null;
  function enter(section,nextDirection=0){
    settle();changes?.disconnect();seen=new WeakSet();direction=nextDirection;
    screen=screens.find(el=>el.dataset.workspaceScreen===section)||screens.find(el=>!el.hidden);
    if(!screen)return;
    changes?.observe(screen,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
    collect();
  }
  document.addEventListener('miracle:section',event=>enter(event.detail.section,event.detail.direction||0));
  document.addEventListener('miracle:motion',event=>{paused=Boolean(event.detail.paused);if(!allowed())settle();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)settle();else schedule();});
  reduced.addEventListener('change',()=>{if(reduced.matches)settle();});
  window.addEventListener('pagehide',()=>{settle();changes?.disconnect();});
  window.addEventListener('pageshow',()=>{if(screen)changes?.observe(screen,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});schedule();});
  // The native dialog owns focus and Escape; animate only its non-glass contents.
  if(menu&&'MutationObserver'in window)new MutationObserver(()=>{
    if(!menu.open)return;
    [...menu.querySelectorAll('.section-menu-heading > *, .section-menu-links > a')].forEach((el,index)=>{
      seen.delete(el);play(el,index);
    });
  }).observe(menu,{attributes:true,attributeFilter:['open']});
  enter(document.body.dataset.workspaceSection);
})();
