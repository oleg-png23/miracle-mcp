/* Motion feedback is event-driven. Optical surfaces and their ancestors stay put. */
(() => {
  'use strict';
  const root=document.documentElement;
  const desktop=matchMedia('(min-width:651px) and (hover:hover) and (pointer:fine)');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const effects=new Set(),seen=new WeakSet();
  root.dataset.motionInput='keyboard';
  const ambient=[...document.querySelectorAll('.live-dot,.demo-line,.scroll-cue')];
  let paused=root.dataset.motion==='paused';
  const motionAllowed=()=>!reduced.matches&&!paused&&!document.hidden;
  const allowed=()=>desktop.matches&&motionAllowed();
  const optical=el=>el.matches('.glass,.welcome-connect')||Boolean(el.querySelector('.glass,.welcome-connect'));
  function animate(el,frames,options){
    if(!allowed()||!el?.animate||optical(el))return;
    const animation=el.animate(frames,{duration:200,easing:'cubic-bezier(.23,1,.32,1)',fill:'backwards',...options});
    const effect={finish(){animation.cancel();effects.delete(effect);}};
    effects.add(effect);animation.onfinish=effect.finish;return animation;
  }
  function settle(){for(const effect of [...effects])effect.finish();}
  // CSS owns pointer press/release feedback. Keyboard activation stays instant.
  document.addEventListener('pointerdown',event=>{
    if(!event.defaultPrevented&&event.button===0)root.dataset.motionInput='pointer';
  },true);
  document.addEventListener('keydown',()=>{
    root.dataset.motionInput='keyboard';settle();arrivals?.disconnect();pageNodes.forEach(el=>seen.add(el));
  },true);

  const landing='.nav > *, .hero-copy > *, .preview-top > *, .preview-rail > *, .preview-main > *, .chat-note > *, .hero-bottom > :not(.glass), .scenery-switch > *, .compatibility-inner > *, .section-heading > *, .workflow-illustration > *, .feature-list > article, .atmosphere-heading > *, .landscape-grid > *, #preview > :not(.demo-grid), .demo-grid > a, .setup-intro > *, .setup > .setup-steps > li, .questions > div:not(.faq-list) > *, .faq-list > details, .closing > *, .footer > *';
  const welcome='.welcome-connect > :not(.welcome-steps):not(.welcome-bridge-visual), .welcome-steps > li, .welcome-bridge-visual > *';
  const pageNodes=document.querySelector('[data-workspace-screen]')?[]:[...document.querySelectorAll(document.body.classList.contains('welcome-page')?welcome:landing)];
  function reveal(el,index){
    if(seen.has(el)||optical(el))return;seen.add(el);
    if(el.contains(document.activeElement))return;
    animate(el,[{opacity:0,translate:'0px 10px'},{opacity:1,translate:'0px 0px'}],{delay:Math.min(index*50,100)});
  }
  const arrivals='IntersectionObserver'in window?new IntersectionObserver(entries=>{
    let index=0;
    for(const entry of entries){if(entry.isIntersecting){arrivals.unobserve(entry.target);reveal(entry.target,index++);}}
  },{threshold:.08}):null;
  const ambience='IntersectionObserver'in window?new IntersectionObserver(entries=>{
    for(const entry of entries)entry.target.dataset.desktopVisible=String(entry.isIntersecting);
  }):null;
  function scan(){
    let index=0;
    for(const el of pageNodes){
      if(seen.has(el)||optical(el)||!el.getClientRects().length)continue;
      if(!allowed()){seen.add(el);continue;}
      const rect=el.getBoundingClientRect();
      if(arrivals&&(rect.top>=window.innerHeight||rect.bottom<=0))arrivals.observe(el);else reveal(el,index++);
    }
  }
  function sync(){
    root.dataset.desktopMotion=allowed()?'on':'off';root.dataset.pageHidden=String(document.hidden);
    if(!allowed()){
      settle();arrivals?.disconnect();ambience?.disconnect();
      document.querySelectorAll('#bgPhoto,#heroWallpaper').forEach(el=>el.getAnimations?.().forEach(animation=>animation.cancel()));
      ambient.forEach(el=>{el.dataset.desktopVisible='false';});
    }else ambient.forEach(el=>{el.dataset.desktopVisible='true';ambience?.observe(el);});
    scan();
  }
  document.addEventListener('miracle:motion',event=>{paused=Boolean(event.detail.paused);sync();});
  document.addEventListener('miracle:section',settle);
  document.addEventListener('visibilitychange',sync);
  desktop.addEventListener('change',sync);reduced.addEventListener('change',sync);
  window.addEventListener('pagehide',()=>{settle();arrivals?.disconnect();ambience?.disconnect();
      document.querySelectorAll('#bgPhoto,#heroWallpaper').forEach(el=>el.getAnimations?.().forEach(animation=>animation.cancel()));});
  window.addEventListener('pageshow',sync);
  sync();
})();
