/* Pointer effects are event-driven and limited to one pending frame per card. */
(() => {
  'use strict';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const fine=matchMedia('(hover: hover) and (pointer: fine)');
  const maxPitch=1.8,maxYaw=2.4;
  document.querySelectorAll('.main-content .glass, .welcome-connect').forEach(card=>{
    card.classList.add('pointer-card');
    let frame=0,rect=null,point=null;
    function reset(){
      cancelAnimationFrame(frame);frame=0;point=null;rect=null;
      card.style.setProperty('--card-rx','0deg');card.style.setProperty('--card-ry','0deg');
      card.classList.remove('pointer-tracking');
    }
    function allowed(event){return event.pointerType!=='touch'&&fine.matches&&!reduced.matches&&document.documentElement.dataset.motion!=='paused'&&document.body.dataset.glassMode!=='beautify'&&!document.hidden&&!card.matches(':focus-within');}
    card.addEventListener('pointerenter',event=>{if(allowed(event))rect=card.getBoundingClientRect();});
    card.addEventListener('pointermove',event=>{
      if(!allowed(event)){reset();return;}
      rect=rect||card.getBoundingClientRect();point={x:event.clientX,y:event.clientY};
      if(frame)return;
      frame=requestAnimationFrame(()=>{
        frame=0;if(!point||!rect)return;
        const x=Math.max(0,Math.min(1,(point.x-rect.left)/rect.width));
        const y=Math.max(0,Math.min(1,(point.y-rect.top)/rect.height));
        card.style.setProperty('--card-rx',`${((.5-y)*2*maxPitch).toFixed(2)}deg`);
        card.style.setProperty('--card-ry',`${((x-.5)*2*maxYaw).toFixed(2)}deg`);
        card.style.setProperty('--card-glow-x',`${(x*100).toFixed(1)}%`);
        card.style.setProperty('--card-glow-y',`${(y*100).toFixed(1)}%`);
        card.classList.add('pointer-tracking');
      });
    },{passive:true});
    card.addEventListener('pointerleave',reset);card.addEventListener('pointercancel',reset);
    card.addEventListener('focusin',reset);reduced.addEventListener('change',reset);
    document.addEventListener('miracle:motion',reset);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
    window.addEventListener('pagehide',reset);
    window.addEventListener('resize',reset,{passive:true});
  });

  // Preserve the content wrapper for styling, and let native details own
  // pointer, keyboard, programmatic state, focus and accessibility.
  const bound=new WeakSet();
  function bindDetails(details){
    if(bound.has(details))return;
    const summary=details.querySelector(':scope > summary');if(!summary)return;
    bound.add(details);
    const body=document.createElement('div');body.className='fold-content';
    [...details.childNodes].filter(node=>node!==summary).forEach(node=>body.append(node));details.append(body);
  }
  document.querySelectorAll('details').forEach(bindDetails);
  if('MutationObserver'in window)new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
      if(node.nodeType!==1)continue;
      if(node.matches('details'))bindDetails(node);
      node.querySelectorAll('details').forEach(bindDetails);
    }
  }).observe(document.body,{childList:true,subtree:true});
})();
