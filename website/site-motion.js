/* Landing-page motion runs on touch and desktop; live glass never moves. */
(() => {
  'use strict';
  if(!document.body.classList.contains('marketing-site'))return;
  const root=document.documentElement;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const fine=matchMedia('(hover:hover) and (pointer:fine)');
  const compact=matchMedia('(max-width:900px)');
  const header=document.getElementById('header');
  const progress=document.querySelector('.nav-progress>span');
  let paused=root.dataset.motion==='paused',scrollFrame=0,pointerFrame=0,point=null,touchPress=null;
  const effects=new Set(),channels=new WeakMap(),seen=new WeakSet(),tilted=new Set();
  const allowed=()=>!paused&&!reduced.matches&&!document.hidden;
  const optical=el=>el.matches('.glass')||Boolean(el.querySelector('.glass'));
  function animate(el,frames,options={},channel='feedback',cleanup=()=>{}){
    if(!allowed()||!el?.animate||optical(el))return;
    let own=channels.get(el);if(!own){own=new Map();channels.set(el,own);}
    own.get(channel)?.finish();
    const animation=el.animate(frames,{duration:450,easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards',...options});
    const effect={finish(){animation.cancel();cleanup();effects.delete(effect);if(own.get(channel)===effect)own.delete(channel);}};
    own.set(channel,effect);effects.add(effect);animation.onfinish=effect.finish;
  }
  const selector='.nav > :not(.nav-progress),.hero-copy > *, .preview-top > *, .preview-rail > *, .preview-main > *, .chat-note > *, .hero-bottom > :not(.glass), .scenery-switch > *, .compatibility-inner > :not(.compatibility-window), .section-heading > *, .workflow-illustration > *, .feature-list > article, .atmosphere-heading > *, .landscape-grid > *, #preview > :not(.demo-grid), .demo-grid > a, .setup-intro > *, .setup > .setup-steps > li, .questions > div:not(.faq-list) > *, .faq-list > details, .closing > *, .footer > *';
  const targets=[...document.querySelectorAll(selector)];
  const settleReveal=el=>{seen.add(el);el.classList.remove('site-reveal-pending');};
  function reveal(el,index=0){
    if(seen.has(el)||optical(el))return;seen.add(el);
    if(!allowed()||!el.animate||el.contains(document.activeElement)){settleReveal(el);return;}
    const mobile=compact.matches||!fine.matches;
    animate(el,[{opacity:0,translate:mobile?'0px 16px':'0px 24px'},{opacity:1,translate:'0px 0px'}],
      {duration:mobile?520:640,delay:mobile?0:Math.min(index*45,135)},'entrance',()=>settleReveal(el));
  }
  const arrivals='IntersectionObserver'in window?new IntersectionObserver(entries=>{
    let index=0;for(const entry of entries)if(entry.isIntersecting){
      arrivals.unobserve(entry.target);
      const rect=entry.boundingClientRect||entry.target.getBoundingClientRect();
      if(rect.top<0||rect.bottom<=0)settleReveal(entry.target);else reveal(entry.target,index++);
    }
  },{threshold:0,rootMargin:'0px 0px 96px 0px'}):null;
  const ambient=[...document.querySelectorAll('.hero,.compatibility,.workflow-illustration,.closing')];
  const ambience='IntersectionObserver'in window?new IntersectionObserver(entries=>{
    for(const entry of entries)entry.target.dataset.motionVisible=String(entry.isIntersecting);
  }):null;
  function scan(){
    let index=0;
    for(const el of targets){
      if(seen.has(el)||optical(el)||!el.getClientRects().length)continue;
      if(!allowed()){settleReveal(el);continue;}
      const rect=el.getBoundingClientRect();
      if(rect.bottom<=0)settleReveal(el);
      else if(arrivals&&rect.top>=window.innerHeight){el.classList.add('site-reveal-pending');arrivals.observe(el);}
      else reveal(el,index++);
    }
  }
  const cards=[...document.querySelectorAll('.feature-list article,.workflow-illustration,.landscape-card,.demo-card,.setup-steps li')].filter(el=>!optical(el));
  function resetPointer(){
    cancelAnimationFrame(pointerFrame);pointerFrame=0;point=null;
    for(const card of tilted){card.style.setProperty('--tilt-x','0deg');card.style.setProperty('--tilt-y','0deg');}
    tilted.clear();
  }
  cards.forEach(card=>{
    card.classList.add('site-tilt');let rect=null;
    card.addEventListener('pointerenter',event=>{if(allowed()&&fine.matches&&event.pointerType!=='touch')rect=card.getBoundingClientRect();});
    card.addEventListener('pointermove',event=>{
      if(!allowed()||!fine.matches||event.pointerType==='touch'||card.contains(document.activeElement))return;
      rect=rect||card.getBoundingClientRect();point={card,rect,x:event.clientX,y:event.clientY};
      if(pointerFrame)return;
      pointerFrame=requestAnimationFrame(()=>{
        pointerFrame=0;if(!point||!allowed()||!fine.matches)return;
        const {card,rect,x,y}=point;
        tilted.add(card);
        const px=Math.max(0,Math.min(1,(x-rect.left)/rect.width)),py=Math.max(0,Math.min(1,(y-rect.top)/rect.height));
        card.style.setProperty('--tilt-x',((.5-py)*4).toFixed(2)+'deg');card.style.setProperty('--tilt-y',((px-.5)*5).toFixed(2)+'deg');
        card.style.setProperty('--glow-x',(px*100).toFixed(1)+'%');card.style.setProperty('--glow-y',(py*100).toFixed(1)+'%');
      });
    },{passive:true});
    const leave=()=>{rect=null;resetPointer();};
    card.addEventListener('pointerleave',leave);card.addEventListener('pointercancel',leave);card.addEventListener('focusin',leave);
  });
  function press(target){
    const el=target?.closest?.('button,a,summary');
    if(!allowed()||!el||!el.animate||el.disabled||el.getAttribute('aria-disabled')==='true'||el.matches('.brand,.skip')||optical(el))return;
    animate(el,[{scale:'1'},{scale:'.95',offset:.3},{scale:'1.035',offset:.7},{scale:'1'}],{duration:430},'press');
    const ring=document.createElement('span');ring.className='site-click-ring';ring.setAttribute('aria-hidden','true');el.classList.add('site-reactive');el.append(ring);
    animate(ring,[{opacity:.5,scale:'1'},{opacity:0,scale:'1.16'}],{duration:480},'ring',()=>{ring.remove();if(!el.querySelector('.site-click-ring'))el.classList.remove('site-reactive');});
  }
  // Native scrolling cancels a touch gesture; only a completed tap gets a press effect.
  document.addEventListener('pointerdown',event=>{
    touchPress=null;
    if(event.defaultPrevented||event.button!==0||event.isPrimary===false)return;
    if(event.pointerType==='touch'||event.pointerType==='pen'){
      const el=event.target.closest?.('button,a,summary');
      if(el)touchPress={id:event.pointerId,el,x:event.clientX,y:event.clientY};
    }else press(event.target);
  },{passive:true});
  document.addEventListener('pointermove',event=>{
    if(touchPress&&touchPress.id===event.pointerId&&Math.hypot(event.clientX-touchPress.x,event.clientY-touchPress.y)>8)touchPress=null;
  },{passive:true});
  document.addEventListener('pointerup',event=>{
    const tap=touchPress;touchPress=null;
    if(tap&&tap.id===event.pointerId&&!event.defaultPrevented&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=8&&event.target.closest?.('button,a,summary')===tap.el)press(tap.el);
  },{passive:true});
  document.addEventListener('pointercancel',()=>{touchPress=null;},{passive:true});
  document.addEventListener('contextmenu',()=>{touchPress=null;});
  document.addEventListener('focusin',event=>{
    for(const el of targets)if(el===event.target||el.contains(event.target)){
      channels.get(el)?.get('entrance')?.finish();settleReveal(el);arrivals?.unobserve(el);
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.repeat||!['Enter',' '].includes(event.key))return;
    if(event.key===' '&&event.target.closest?.('a'))return;press(event.target);
  });
  if('MutationObserver'in window)new MutationObserver(records=>{
    for(const record of records){
      const el=record.target,value=el.getAttribute('aria-pressed');
      if(record.oldValue===value||value!=='true'||!el.matches('.scene,.landscape-card')||!el.getClientRects().length)continue;
      animate(el.querySelector('img,.scene-swatch')||el,[{scale:'.94'},{scale:'1.06',offset:.65},{scale:'1'}],{duration:520},'selection');
    }
  }).observe(document.body,{subtree:true,attributes:true,attributeFilter:['aria-pressed'],attributeOldValue:true});
  const links=[...document.querySelectorAll('.nav-links a[href^="#"]')];
  const sections=links.map(link=>({link,section:document.getElementById(link.getAttribute('href').slice(1))})).filter(item=>item.section);
  let geometryDirty=true,range=0,routes=[],activeLink=null,lastProgress='';
  function measureRoutes(){
    range=Math.max(0,root.scrollHeight-window.innerHeight);
    routes=sections.filter(item=>item.link.getClientRects().length).map(item=>({...item,top:item.section.getBoundingClientRect().top+window.scrollY}));
    geometryDirty=false;
  }
  function routeState(){
    scrollFrame=0;if(document.hidden)return;
    if(geometryDirty)measureRoutes();
    const value=range?Math.max(0,Math.min(1,window.scrollY/range)).toFixed(4):'0';
    if(progress&&value!==lastProgress){progress.style.transform=`scaleX(${value})`;lastProgress=value;}
    const scrolled=String(window.scrollY>36);
    if(header&&header.dataset.scrolled!==scrolled)header.dataset.scrolled=scrolled;
    let active=null,closest=-Infinity;
    for(const item of routes)if(item.top<=window.scrollY+180&&item.top>closest){active=item.link;closest=item.top;}
    if(active!==activeLink){activeLink?.removeAttribute('aria-current');active?.setAttribute('aria-current','location');activeLink=active;}
  }
  function scheduleScroll(){if(!scrollFrame)scrollFrame=requestAnimationFrame(routeState);}
  function scheduleLayout(){geometryDirty=true;scheduleScroll();}
  if('ResizeObserver'in window){
    const layout=new ResizeObserver(scheduleLayout);
    layout.observe(document.body);sections.forEach(item=>layout.observe(item.section));
  }
  document.addEventListener('load',scheduleLayout,true);
  document.addEventListener('toggle',scheduleLayout,true);
  document.fonts?.ready.then(scheduleLayout);
  function sync(){
    root.dataset.siteMotion=allowed()?'on':'off';root.dataset.pageHidden=String(document.hidden);
    if(!allowed()){
      for(const effect of [...effects])effect.finish();arrivals?.disconnect();ambience?.disconnect();resetPointer();touchPress=null;
      document.querySelectorAll('#heroWallpaper').forEach(el=>el.getAnimations?.().forEach(animation=>animation.cancel()));
      ambient.forEach(el=>{el.dataset.motionVisible='false';});
    }else for(const el of ambient){el.dataset.motionVisible='true';ambience?.observe(el);}
    scan();
  }
  document.addEventListener('miracle:motion',event=>{paused=Boolean(event.detail.paused);sync();});
  document.addEventListener('visibilitychange',()=>{sync();if(!document.hidden)scheduleLayout();});
  reduced.addEventListener('change',sync);fine.addEventListener('change',resetPointer);
  window.addEventListener('scroll',()=>{touchPress=null;scheduleScroll();},{passive:true});window.addEventListener('resize',()=>{resetPointer();scheduleLayout();},{passive:true});
  window.addEventListener('pagehide',()=>{for(const effect of [...effects])effect.finish();arrivals?.disconnect();ambience?.disconnect();cancelAnimationFrame(scrollFrame);scrollFrame=0;resetPointer();touchPress=null;});
  window.addEventListener('pageshow',()=>{sync();scheduleLayout();});
  sync();scheduleScroll();
})();
