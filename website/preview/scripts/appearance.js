/* Exactly two local palettes. Legacy landscape settings fall back to Lime Soda. */
(() => {
  'use strict';
  const wallpapers = Object.freeze({
    lime:{file:'lime-soda.svg',thumb:'lime-soda.svg',name:'Lime Soda',tint:'#d9f5b0'},
    solar:{file:'solar-flare.svg',thumb:'solar-flare.svg',name:'Solar Flare',tint:'#ffd2b9'}
  });
  const normalize = key => Object.hasOwn(wallpapers,key) ? key : 'lime';
  let requestId=0,timer=0;
  function clock(hour=new Date().getHours()) {
    if(hour>=5&&hour<12)return {greeting:'Good morning.',period:'Morning'};
    if(hour>=12&&hour<17)return {greeting:'Good afternoon.',period:'Afternoon'};
    return {greeting:'Good evening.',period:hour<20?'Evening':'Night'};
  }
  async function apply(value) {
    const key=normalize(value),photo=document.getElementById('bgPhoto');
    if(!photo)return false;
    const current=++requestId,choice=wallpapers[key];
    if(document.body.dataset.wallpaper!==key||!photo.complete||!photo.naturalWidth) {
      const image=new Image();image.decoding='async';image.src=`assets/bg/${choice.file}`;
      try{await image.decode();}catch{if(current===requestId)window.MiraclesBridge?.report('The color theme could not load. Please try again.');return false;}
      if(current!==requestId)return false;
      photo.src=image.src;document.body.dataset.wallpaper=key;
      photo.getAnimations?.().forEach(animation=>animation.cancel());
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&document.documentElement.dataset.motion!=='paused'&&!document.hidden&&photo.animate)
        photo.animate([{opacity:.45},{opacity:1}],{duration:450,easing:'ease-out'});
    }
    document.documentElement.style.setProperty('--sidebar-accent',choice.tint);
    const label=document.getElementById('wallpaperName');if(label)label.textContent=choice.name;
    document.querySelectorAll('.wallpaper-option').forEach(button=>{
      const selected=button.dataset.wallpaper===key;
      button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
    });
    return true;
  }
  function refreshClock() {
    clearTimeout(timer);if(document.hidden)return;
    const state=clock();document.querySelectorAll('[data-greeting]').forEach(el=>el.textContent=state.greeting);
    const date=new Date();timer=setTimeout(refreshClock,(60-date.getMinutes())*60000-date.getSeconds()*1000-date.getMilliseconds()+100);
  }
  function setMode(_legacyMode,key) {
    // A saved automatic mode must not bring back a deleted landscape or change
    // the user's selected palette as the time of day changes.
    document.body.dataset.wallpaperMode='manual';refreshClock();
    return apply(key??document.body.dataset.wallpaper??'lime');
  }
  document.addEventListener('visibilitychange',refreshClock);
  window.addEventListener('pagehide',()=>clearTimeout(timer));
  window.MiracleAppearance={wallpapers,normalize,apply,clock,setMode};
})();
