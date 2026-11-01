/* The tooltip lives in the browser's top layer, outside card stacking contexts. */
(() => {
  'use strict';
  const rail=document.querySelector('.sidebar');if(!rail)return;
  const paused=()=>document.documentElement.dataset.motion==='paused';
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const fine=matchMedia('(hover: hover) and (pointer: fine)');
  const links=[...rail.querySelectorAll('.navigation .nav-link')];
  const controls=[...links,rail.querySelector('.rail-action')].filter(Boolean);
  const tip=document.createElement('div');tip.id='railTooltip';tip.className='rail-tooltip';
  tip.setAttribute('role','tooltip');tip.setAttribute('popover','manual');
  document.body.append(tip);
  const nativePopover=typeof tip.showPopover==='function';
  if(!nativePopover)tip.hidden=true;
  let anchor=null,closeTimer=0,frame=0;
  function place(){
    if(!anchor)return;
    const rect=anchor.getBoundingClientRect(),size=tip.getBoundingClientRect();
    const dock=innerWidth<=650;
    const x=dock?rect.left+(rect.width-size.width)/2:rect.right+19;
    const y=dock?rect.top-size.height-13:rect.top+(rect.height-size.height)/2;
    tip.style.left=`${Math.max(10,Math.min(innerWidth-size.width-10,x))}px`;
    tip.style.top=`${Math.max(10,Math.min(innerHeight-size.height-10,y))}px`;
    tip.dataset.placement=dock?'above':'right';
  }
  function hide(immediate=false){
    clearTimeout(closeTimer);cancelAnimationFrame(frame);
    anchor?.removeAttribute('aria-describedby');anchor=null;
    tip.classList.remove('is-visible');
    const conceal=()=>{if(nativePopover&&tip.matches(':popover-open'))tip.hidePopover();else if(!nativePopover)tip.hidden=true;};
    if(immediate||tip.dataset.instant==='true'||paused()||reducedMotion.matches)conceal();else closeTimer=setTimeout(conceal,150);
  }
  function show(button,keyboard=false){
    const instant=keyboard||(nativePopover?tip.matches(':popover-open'):!tip.hidden)||paused()||reducedMotion.matches;
    tip.dataset.instant=String(instant);
    clearTimeout(closeTimer);cancelAnimationFrame(frame);
    anchor?.removeAttribute('aria-describedby');anchor=button;
    tip.textContent=button.getAttribute('aria-label');button.setAttribute('aria-describedby',tip.id);
    if(nativePopover&&!tip.matches(':popover-open'))tip.showPopover();else if(!nativePopover)tip.hidden=false;
    place();if(instant)tip.classList.add('is-visible');else frame=requestAnimationFrame(()=>tip.classList.add('is-visible'));
  }
  rail.addEventListener('pointerleave',()=>hide());
  rail.addEventListener('focusout',event=>{if(!rail.contains(event.relatedTarget))hide(true);});
  controls.forEach(button=>{
    button.removeAttribute('title');
    button.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch'&&fine.matches)show(button);});
    button.addEventListener('pointerleave',()=>hide());
    button.addEventListener('click',()=>hide(true));
    button.addEventListener('focus',()=>show(button,true));button.addEventListener('blur',()=>hide(true));
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hide(true);});
  window.addEventListener('resize',()=>hide(true),{passive:true});
  window.addEventListener('pagehide',()=>hide(true));
  // The lens stays in the same backdrop coordinate space while scrolling.
  window.addEventListener('scroll',()=>{if(anchor)place();},{passive:true});
  reducedMotion.addEventListener('change',()=>hide(true));
  document.addEventListener('miracle:motion',()=>hide(true));
})();
