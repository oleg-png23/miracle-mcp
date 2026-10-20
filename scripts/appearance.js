/* Shared local landscapes and clock-based appearance for both entry pages. */
(() => {
  'use strict';
  const wallpapers = {
    fjord:{file:'fjord-optimized.webp',thumb:'fjord-thumb.webp',name:'Ocean',hue:198},
    alpine:{file:'alpine-new.webp',thumb:'alpine-new-thumb.webp',name:'Alps',hue:177},
    coast:{file:'coast-new.webp',thumb:'coast-new-thumb.webp',name:'Coast',hue:190},
    aurora:{file:'aurora-new.webp',thumb:'aurora-new-thumb.webp',name:'Aurora',hue:166},
    dunes:{file:'dunes-optimized.webp',thumb:'dunes-thumb.webp',name:'Canyon',hue:27},
    lavender:{file:'lavender-optimized.webp',thumb:'lavender-thumb.webp',name:'Sunset',hue:30},
    forest:{file:'forest-optimized.webp',thumb:'forest-thumb.webp',name:'Forest',hue:150},
    sunset:{file:'sunset-optimized.webp',thumb:'sunset-thumb.webp',name:'Dusk',hue:345}
  };
  let requestId=0,mode='auto',timer=0;
  function clock(hour=new Date().getHours()) {
    if(hour>=5&&hour<12) return {greeting:'Good morning.',wallpaper:'alpine',period:'Morning'};
    if(hour>=12&&hour<17) return {greeting:'Good afternoon.',wallpaper:'coast',period:'Afternoon'};
    if(hour>=17&&hour<20) return {greeting:'Good evening.',wallpaper:'aurora',period:'Evening'};
    if(hour>=20&&hour<21) return {greeting:'Good evening.',wallpaper:'aurora',period:'Dusk'};
    return {greeting:'Good evening.',wallpaper:'aurora',period:'Night'};
  }
  function tint(image,fallbackHue) {
    let hue=fallbackHue;
    try {
      const canvas=document.createElement('canvas');canvas.width=12;canvas.height=24;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      const ratio=innerWidth/innerHeight;
      const width=Math.min(image.naturalWidth,image.naturalHeight*ratio),height=width/ratio;
      context.drawImage(image,(image.naturalWidth-width)/2,(image.naturalHeight-height)/2,width*.24,height,0,0,12,24);
      const p=context.getImageData(0,0,12,24).data;let r=0,g=0,b=0;
      for(let i=0;i<p.length;i+=4){r+=p[i];g+=p[i+1];b+=p[i+2];}
      const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
      if(d>100) hue=60*(max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4);
    } catch { /* The asset's palette covers browsers that block canvas reads. */ }
    document.documentElement.style.setProperty('--sidebar-accent',`hsl(${hue.toFixed(1)} 55% 82%)`);
  }
  async function apply(key) {
    key=wallpapers[key]?key:'coast';
    const photo=document.getElementById('bgPhoto');
    if(!photo)return false;
    const current=++requestId;
    if(document.body.dataset.wallpaper===key&&photo.complete&&photo.naturalWidth)return true;
    const choice=wallpapers[key];
    const image=new Image();image.decoding='async';image.src=`assets/bg/${choice.file}`;
    try { await image.decode(); }
    catch { if(current===requestId) window.MiraclesBridge?.report('The photograph could not load. Please try again.');return false; }
    if(current!==requestId)return false;
    photo.src=image.src;
    document.body.dataset.wallpaper=key;
    tint(image,choice.hue);
    photo.getAnimations?.().forEach(animation=>animation.cancel());
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&document.documentElement.dataset.motion!=='paused'&&!document.hidden&&photo.animate)photo.animate([{opacity:.45},{opacity:1}],{duration:450,easing:'ease-out'});
    const label=document.getElementById('wallpaperName');if(label)label.textContent=choice.name;
    document.querySelectorAll('.wallpaper-option').forEach(button=>{
      const selected=wallpapers[button.dataset.wallpaper]===choice;
      button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
    });
    return true;
  }
  function refreshClock() {
    clearTimeout(timer);
    if(document.hidden)return;
    const state=clock();
    document.querySelectorAll('[data-greeting]').forEach(el=>el.textContent=state.greeting);
    const label=document.getElementById('timeAppearance');if(label)label.textContent=`${state.period} · local time`;
    if(mode==='auto'&&document.body.dataset.wallpaper!==state.wallpaper)apply(state.wallpaper);
    const date=new Date();timer=setTimeout(refreshClock,(60-date.getMinutes())*60000-date.getSeconds()*1000-date.getMilliseconds()+100);
  }
  function setMode(value,key) {
    mode=value==='manual'?'manual':'auto';document.body.dataset.wallpaperMode=mode;
    const toggle=document.getElementById('autoWallpaper');if(toggle)toggle.setAttribute('aria-checked',String(mode==='auto'));
    if(mode==='manual'&&key)apply(key);
    refreshClock();
  }
  document.addEventListener('visibilitychange',refreshClock);
  window.MiracleAppearance={wallpapers,apply,clock,setMode};
})();
