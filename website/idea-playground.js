/* An offline concept builder; the illustrated route never calls Studio or an AI. */
(() => {
  'use strict';
  const playground=document.getElementById('playground');
  if(!playground)return;
  const worlds={
    sky:{name:'Sky islands',caption:'Somewhere above the clouds.',alt:'Floating grassy islands and a luminous stone portal above a sea of clouds.',direction:'floating islands, soft shapes and little bridges that invite exploration',ideas:[
      'A chain of floating islands with a glowing portal and tiny bridges.',
      'A floating skatepark above a sea of clouds.',
      'A tiny observatory on an island that collects passing rain clouds.',
      'A sky-train station with platforms drifting between islands.',
      'A windmill village on a ring of miniature floating islands.',
      'A stargazing campsite beside a waterfall that disappears into the clouds.'
    ]},
    neon:{name:'Neon city',caption:'A city that dreams in color.',alt:'A cinematic futuristic city courtyard with an elevated tram, warm lights and rain reflections.',direction:'a compact city block, layered rooftops and cyan light accents',ideas:[
      'A rain-lit neon street with a tiny rooftop arcade.',
      'A vertical city with a hover-tram weaving between towers.',
      'A retro-futuristic night market under glowing signs.',
      'A neon racing checkpoint inside a curved light tunnel.',
      'A rooftop garden above a bright futuristic skyline.',
      'A midnight train platform lit in electric blue and pink.'
    ]},
    moon:{name:'Moon garden',caption:'A softer side of outer space.',alt:'A luminous botanical garden inside a glass dome on the moon, with Earth above the horizon.',direction:'a small lunar island, a transparent dome and a garden of strange flowers',ideas:[
      'A miniature moon garden inside a transparent dome.',
      'A quiet lunar base surrounded by star-shaped flowers.',
      'A low-gravity playground built around a little crater.',
      'A cozy moon cafe with a view of Earth.',
      'Three lunar greenhouses connected by glass walkways.',
      'A silver forest with a miniature observatory at its center.'
    ]}
  };
  const lights={
    dawn:{name:'Soft dawn',caption:'Soft dawn · a quieter kind of magic',direction:'soft dawn light, a cool sky and gentle atmospheric haze'},
    golden:{name:'Golden hour',caption:'Golden hour · everything feels a little warmer',direction:'warm golden-hour light, long soft shadows and amber highlights'},
    night:{name:'After dark',caption:'After dark · let the little lights lead',direction:'a deep-blue night sky, soft ambient light and a few glowing focal points'}
  };
  const get=id=>document.getElementById(id);
  const form=get('ideaForm'),input=get('ideaInput'),brief=get('ideaBrief'),copy=get('ideaCopy'),feedback=get('ideaFeedback');
  const photo=get('ideaWorldImage'),artwork=get('ideaArtwork'),imageStatus=get('ideaImageStatus');
  const presets=[...playground.querySelectorAll('[data-idea-preset]')];
  const moods=[...playground.querySelectorAll('[data-idea-mood]')];
  const steps=[...playground.querySelectorAll('[data-idea-step]')];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let world='sky',light='dawn',suggested=worlds.sky.ideas[0],fullBrief='',timer=0,running=false,visible=true;
  let paused=document.documentElement.dataset.motion==='paused',bag=[],count=0,glyphs=[];
  let imageRequest=0,pendingImageWorld='';
  const clean=value=>Array.from(String(value).replace(/\s+/gu,' ').trim()).slice(0,180).join('');
  const text=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
  const canAnimate=()=>!paused&&!reduced.matches&&!document.hidden&&visible;
  const imageSet=key=>`assets/playground/${key}-640.webp 640w, assets/playground/${key}.webp 1280w`;
  function cancelPhotoFade(){photo.getAnimations?.().filter(animation=>animation.id==='idea-photo-fade').forEach(animation=>animation.cancel());}
  function imageReady(){artwork.dataset.imageState='ready';imageStatus.hidden=true;}
  function imageError(){
    artwork.dataset.imageState='error';imageStatus.hidden=false;
    text(imageStatus,'This image could not load. Choose this world again to retry.');
  }
  function imageAlt(key){photo.alt=`${worlds[key].alt} ${lights[light].name} color grade.`;}
  async function updateImage(key,force=false){
    if(!force&&photo.dataset.world===key&&photo.dataset.imageValid!=='false'){
      imageRequest++;pendingImageWorld='';imageReady();imageAlt(key);return;
    }
    if(!force&&pendingImageWorld===key)return;
    const request=++imageRequest;pendingImageWorld=key;
    artwork.dataset.imageState='loading';imageStatus.hidden=false;text(imageStatus,`Loading ${worlds[key].name.toLowerCase()}…`);
    const preload=new Image();preload.sizes=photo.sizes;preload.srcset=imageSet(key);preload.src=`assets/playground/${key}.webp`;
    try{await preload.decode();}
    catch{if(request===imageRequest){pendingImageWorld='';imageError();}return;}
    if(request!==imageRequest)return;
    pendingImageWorld='';cancelPhotoFade();
    photo.srcset=imageSet(key);photo.src=`assets/playground/${key}.webp`;photo.dataset.world=key;photo.dataset.imageValid='true';imageAlt(key);imageReady();
    if(canAnimate()&&photo.animate){const fade=photo.animate([{opacity:.7},{opacity:1}],{duration:280,easing:'ease-out'});fade.id='idea-photo-fade';}
  }
  function compose(idea){
    return `In my open Roblox Studio place, build this idea: ${idea}\n\nVisual direction: ${worlds[world].direction}. Use ${lights[light].direction}.\n\nInspect the existing scene first. Group the new build in its own model and preserve unrelated work. Explain what changed and what I can adjust.`;
  }
  function phase(index,done=false){
    playground.dataset.ideaPhase=done?'ready':String(index);
    steps.forEach((step,i)=>{
      if(i===index)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');
      step.dataset.complete=String(done||i<index);
    });
  }
  function stop(){clearTimeout(timer);timer=0;}
  function finish(){
    stop();running=false;playground.dataset.ideaRunning='false';
    brief.value=fullBrief;brief.scrollTop=0;brief.setAttribute('aria-busy','false');
    phase(2,true);
  }
  function seed(idea){
    let value=2166136261;
    for(const char of `${world}/${light}/${idea}`)value=Math.imul(value^char.codePointAt(0),16777619)>>>0;
    return value.toString(16).toUpperCase().padStart(8,'0').slice(-4);
  }
  function paint(){
    playground.dataset.ideaWorld=world;playground.dataset.ideaLight=light;
    presets.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.ideaPreset===world)));
    moods.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.ideaMood===light)));
    text(get('ideaSceneName'),worlds[world].caption);text(get('ideaSceneMood'),lights[light].caption);
    imageAlt(photo.dataset.world||'sky');updateImage(world);
  }
  function prepare(validate=false){
    const idea=clean(input.value);
    if(!idea){
      stop();running=false;playground.dataset.ideaRunning='false';fullBrief='';glyphs=[];brief.value='';copy.disabled=true;
      brief.setAttribute('aria-busy','false');phase(0);
      text(feedback,'Add a little idea above to create your brief.');
      if(validate){input.setCustomValidity('Add your idea first.');input.reportValidity();input.focus();}
      return false;
    }
    input.setCustomValidity('');fullBrief=compose(idea);glyphs=Array.from(fullBrief);copy.disabled=false;
    text(get('ideaSeed'),`${world.toUpperCase()} / ${seed(idea)}`);
    return true;
  }
  function type(){
    if(!canAnimate()){finish();text(feedback,'Brief ready. Copy it into your AI chat with Miracle.');return;}
    count=Math.min(glyphs.length,count+7);
    brief.value=glyphs.slice(0,count).join('');
    if(count>=glyphs.length){finish();text(feedback,'Brief ready. Copy it into your AI chat with Miracle.');}
    else timer=setTimeout(type,24);
  }
  function run(){
    stop();paint();if(!prepare(true))return;
    if(!canAnimate()){finish();text(feedback,'Brief ready. Copy it into your AI chat with Miracle.');return;}
    running=true;playground.dataset.ideaRunning='true';phase(0);count=0;brief.value='';brief.scrollTop=0;brief.setAttribute('aria-busy','true');
    text(feedback,'One idea. A few possibilities. Let’s give it a direction.');
    timer=setTimeout(()=>{
      phase(1);text(feedback,'A world, a mood, a plan. Your spark is taking shape.');
      timer=setTimeout(()=>{phase(2);type();},520);
    },520);
  }
  function settleMotion(){
    if(!canAnimate())cancelPhotoFade();
    if(running&&!canAnimate()){finish();text(feedback,'Brief ready. Copy it into your AI chat with Miracle.');}
  }
  presets.forEach(button=>button.addEventListener('click',()=>{
    const next=button.dataset.ideaPreset;if(!worlds[next])return;
    if(next===world){if(artwork.dataset.imageState==='error')updateImage(next,true);return;}
    world=next;
    if(!clean(input.value)||clean(input.value)===clean(suggested)){suggested=worlds[world].ideas[0];input.value=suggested;}
    run();
  }));
  moods.forEach(button=>button.addEventListener('click',()=>{
    const next=button.dataset.ideaMood;if(!lights[next]||next===light)return;light=next;run();
  }));
  get('ideaSurprise').addEventListener('click',()=>{
    if(!bag.length){
      bag=Object.entries(worlds).flatMap(([key,value])=>value.ideas.map(idea=>({world:key,idea})));
      for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
    }
    if(bag.length>1&&bag.at(-1).idea===clean(input.value)){[bag[0],bag[bag.length-1]]=[bag[bag.length-1],bag[0]];}
    const next=bag.pop();world=next.world;suggested=next.idea;input.value=suggested;
    const alternatives=Object.keys(lights).filter(key=>key!==light);light=alternatives[Math.floor(Math.random()*alternatives.length)];run();
  });
  form.addEventListener('submit',event=>{event.preventDefault();run();});
  input.addEventListener('input',()=>{
    input.setCustomValidity('');stop();running=false;playground.dataset.ideaRunning='false';
    if(prepare()){finish();text(feedback,'Your brief is up to date. Follow the spark to see its route.');}
  });
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();form.requestSubmit();}
  });
  brief.addEventListener('focus',()=>{if(running){finish();text(feedback,'Brief ready. Select the text or use Copy brief.');}});
  copy.addEventListener('click',async()=>{
    if(!prepare(true))return;finish();
    const copied=fullBrief;
    try{
      await navigator.clipboard.writeText(copied);
      if(fullBrief===copied)text(feedback,'Copied. Open your AI chat, start Miracle, and bring this idea into Studio.');
    }catch{
      if(fullBrief===copied){brief.focus();brief.select();text(feedback,'Clipboard unavailable. Your brief is selected; copy the text manually.');}
    }
  });
  document.addEventListener('miracle:motion',event=>{paused=Boolean(event.detail.paused);settleMotion();});
  document.addEventListener('visibilitychange',settleMotion);reduced.addEventListener('change',settleMotion);
  photo.addEventListener('load',()=>{photo.dataset.imageValid='true';if(photo.dataset.world===world&&!pendingImageWorld)imageReady();});
  photo.addEventListener('error',()=>{photo.dataset.imageValid='false';if(photo.dataset.world===world&&!pendingImageWorld)imageError();});
  window.addEventListener('pagehide',()=>{imageRequest++;pendingImageWorld='';cancelPhotoFade();if(running){finish();text(feedback,'Brief ready. Copy it into your AI chat with Miracle.');}else stop();});
  window.addEventListener('pageshow',()=>updateImage(world));
  if('IntersectionObserver'in window)new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.target===playground){visible=entry.isIntersecting;settleMotion();}
  }).observe(playground);
  if(photo.complete&&photo.naturalWidth===0)photo.dataset.imageValid='false';
  paint();prepare();finish();get('ideaControls').disabled=false;
})();
