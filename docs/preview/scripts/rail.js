/* The tooltip lives in the browser's top layer, outside card stacking contexts. */
(() => {
  'use strict';
  const rail=document.querySelector('.sidebar');if(!rail)return;
  const paused=()=>document.documentElement.dataset.motion==='paused';
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
  function hide(){
    clearTimeout(closeTimer);cancelAnimationFrame(frame);
    anchor?.removeAttribute('aria-describedby');anchor=null;
    tip.classList.remove('is-visible');
    closeTimer=setTimeout(()=>{if(nativePopover&&tip.matches(':popover-open'))tip.hidePopover();else if(!nativePopover)tip.hidden=true;},150);
  }
  function show(button){
    clearTimeout(closeTimer);cancelAnimationFrame(frame);
    anchor?.removeAttribute('aria-describedby');anchor=button;
    tip.textContent=button.getAttribute('aria-label');button.setAttribute('aria-describedby',tip.id);
    if(nativePopover&&!tip.matches(':popover-open'))tip.showPopover();else if(!nativePopover)tip.hidden=false;
    place();frame=requestAnimationFrame(()=>tip.classList.add('is-visible'));
  }
  function magnify(index){if(paused()||reducedMotion.matches)index=-1;links.forEach((link,i)=>{
    const distance=Math.abs(i-index);
    link.style.setProperty('--dock-scale',index<0?'1':distance===0?'1.06':distance===1?'1.02':'1');
    link.style.setProperty('--dock-lift','0px');
  });}
  links.forEach((link,index)=>{
    link.style.setProperty('--rail-order',String(index));
    link.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')magnify(index);});
    link.addEventListener('focus',()=>magnify(index));
    link.addEventListener('click',hide);
  });
  rail.addEventListener('pointerleave',()=>{magnify(-1);hide();});
  rail.addEventListener('focusout',event=>{if(!rail.contains(event.relatedTarget)){magnify(-1);hide();}});
  controls.forEach(button=>{
    button.removeAttribute('title');
    button.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')show(button);});
    button.addEventListener('pointerleave',hide);
    button.addEventListener('focus',()=>show(button));button.addEventListener('blur',hide);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
  window.addEventListener('resize',hide,{passive:true});
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  // The lens stays in the same backdrop coordinate space while scrolling.
  window.addEventListener('scroll',()=>{if(anchor)place();},{passive:true});
  reducedMotion.addEventListener('change',()=>magnify(-1));
  document.addEventListener('miracle:motion',()=>magnify(-1));
})();
