/* Desktop motion is event-driven. Optical surfaces and their ancestors stay put. */
(() => {
  'use strict';
  const root=document.documentElement;
  const desktop=matchMedia('(min-width:651px) and (hover:hover) and (pointer:fine)');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const controls='button, a, summary';
  const excluded='.nav-link,.rail-brand,.brand,.desktop-brand,.welcome-wordmark,.skip,.skip-link,[data-no-motion]';
  const values='.metric > strong:not(#stUptime),.usage-metrics strong,.usage-directions b,#agentState';
  const effects=new Set(),channels=new WeakMap(),seen=new WeakSet(),previous=new WeakMap();
  const ambient=[...document.querySelectorAll('.live-dot,.demo-line,.scroll-cue')];
  let paused=root.dataset.motion==='paused';
  const allowed=()=>desktop.matches&&!reduced.matches&&!paused&&!document.hidden;
  const optical=el=>el.matches('.glass,.welcome-connect')||Boolean(el.querySelector('.glass,.welcome-connect'));
  function animate(el,frames,options,channel='feedback',cleanup=()=>{}){
    if(!allowed()||!el?.animate||optical(el))return;
    let own=channels.get(el);if(!own){own=new Map();channels.set(el,own);}
    own.get(channel)?.finish();
    const animation=el.animate(frames,{duration:360,easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards',...options});
    const effect={finish(){animation.cancel();cleanup();effects.delete(effect);if(own.get(channel)===effect)own.delete(channel);}};
    own.set(channel,effect);effects.add(effect);animation.onfinish=effect.finish;return animation;
  }
  function settle(){for(const effect of [...effects])effect.finish();}
  function control(target){
    const el=target?.closest?.(controls);
    return el&&!el.matches(excluded)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'?el:null;
  }
  function press(el){
    if(!allowed()||!el||typeof el.animate!=='function'||optical(el))return;
    animate(el,[{scale:'1'},{scale:'.985',offset:.35},{scale:'1'}],{duration:240},'press');
  }
  document.addEventListener('pointerdown',event=>{
    if(event.defaultPrevented||event.button!==0||event.pointerType==='touch')return;
    press(control(event.target));
  });
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.repeat||!['Enter',' '].includes(event.key))return;
    const el=control(event.target);if(event.key===' '&&el?.tagName==='A')return;press(el);
  });
  function feedback(record){
    const el=record.target;
    if(record.type==='attributes'){
      if(!el.getClientRects().length)return;
      const value=el.getAttribute(record.attributeName);if(record.oldValue===value)return;
      if(record.attributeName==='aria-checked'){
        const thumb=el.matches('.switch')?el.querySelector('span'):null;
        if(thumb)animate(thumb,[{scale:'.96'},{scale:'1'}],{duration:220},'selection');
      }else if(value==='true'&&el.matches('.segmented-control button,.wallpaper-option,.scene,.landscape-card')){
        const image=el.querySelector('img,.scene-swatch')||el;
        animate(image,[{opacity:.7},{opacity:1}],{duration:220},'selection');
      }
    }else if(el.matches?.(values)){
      const text=el.textContent,old=previous.get(el);previous.set(el,text);
      if(old===text||old===undefined||!el.getClientRects().length||el.getAnimations?.().some(a=>a.playState==='running'))return;
      if(el.id==='agentState'&&el.parentElement?.getAnimations?.().some(a=>a.playState==='running'))return;
      const rect=el.getBoundingClientRect();
      if(rect.bottom<=0||rect.top>=window.innerHeight)return;
      animate(el,[{opacity:.55,translate:'0px 5px'},{opacity:1,translate:'0px 0px'}],{duration:300},'value');
    }
  }
  document.querySelectorAll(values).forEach(el=>previous.set(el,el.textContent));
  const updates='MutationObserver'in window?new MutationObserver(records=>records.forEach(feedback)):null;
  const watch=()=>updates?.observe(document.body,{subtree:true,childList:true,attributes:true,attributeOldValue:true,attributeFilter:['aria-pressed','aria-checked']});

  const landing='.nav > *, .hero-copy > *, .preview-top > *, .preview-rail > *, .preview-main > *, .chat-note > *, .hero-bottom > :not(.glass), .scenery-switch > *, .compatibility-inner > *, .section-heading > *, .workflow-illustration > *, .feature-list > article, .atmosphere-heading > *, .landscape-grid > *, #preview > :not(.demo-grid), .demo-grid > a, .setup-intro > *, .setup > .setup-steps > li, .questions > div:not(.faq-list) > *, .faq-list > details, .closing > *, .footer > *';
  const welcome='.welcome-connect > :not(.welcome-steps):not(.welcome-bridge-visual), .welcome-steps > li, .welcome-bridge-visual > *';
  const pageNodes=document.querySelector('[data-workspace-screen]')?[]:[...document.querySelectorAll(document.body.classList.contains('welcome-page')?welcome:landing)];
  function reveal(el,index){
    if(seen.has(el)||optical(el))return;seen.add(el);
    if(el.contains(document.activeElement))return;
    animate(el,[{opacity:0,translate:'0px 10px'},{opacity:1,translate:'0px 0px'}],{duration:420,delay:Math.min(index*28,140)},'reveal');
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
      document.querySelectorAll('#bgPhoto,#heroWallpaper').forEach(el=>el.getAnimations?.().forEach(animation=>animation.cancel()));updates?.disconnect();});
  window.addEventListener('pageshow',()=>{watch();sync();});
  watch();sync();
})();
