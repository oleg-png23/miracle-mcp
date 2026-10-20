/* Local idea carousel: every displayed suggestion has a complete copyable brief. */
(() => {
  'use strict';
  const button=document.getElementById('welcomePrompt');
  const text=document.getElementById('welcomePromptText');
  const copy=document.getElementById('welcomePromptCopy');
  const counter=document.getElementById('welcomePromptCount');
  if(!button||!text||!copy)return;
  const ideas=[
    ['Give this place warm, golden-hour lighting.','Give this place warm golden-hour lighting. Inspect the current lighting first, then explain your changes.'],
    ['Build a forest clearing with a winding path.','Inspect the place, then build a peaceful forest clearing with a winding footpath, varied trees and soft ambient lighting. Explain what you added.'],
    ['Create a cozy cabin beside a quiet lake.','Create a cozy lakeside cabin with a small dock, a readable entrance and warm window lighting. Fit it into the existing scene and explain the result.'],
    ['Connect floating islands with rope bridges.','Build a small floating-island area with connected rope-style bridges, clear walking surfaces and a safe spawn point. Explain how it is organized.'],
    ['Make a colorful obby with checkpoints.','Create a short colorful obby with progressively harder jumps, working checkpoints and a clear finish. Explain how the checkpoint logic works.'],
    ['Turn a street into a neon-lit night scene.','Inspect the scene, then create a neon-lit night street with contrasting shop signs, gentle fog and readable pathways. Explain your lighting choices.'],
    ['Add a campfire spot under the stars.','Add a small campsite with a campfire, seats, nearby trees and a clear night sky. Use a restrained fire effect and explain what you changed.'],
    ['Build a snowy village with glowing windows.','Create a compact snowy village with varied roof heights, warm windows and a clear main path. Explain how the buildings and snow are grouped.'],
    ['Create a desert oasis with palms and ruins.','Build a desert oasis with a small pool, palms, a shaded resting area and a few weathered ruins. Fit the scale to the existing place.'],
    ['Design an underwater research outpost.','Create a small underwater research outpost with glowing windows, a central room and connected walkways. Keep the interior readable and explain the layout.'],
    ['Make a medieval courtyard with a fountain.','Build a medieval courtyard with a central fountain, stone paths and a few distinct archways. Explain the structure and materials you chose.'],
    ['Build a little train platform in the hills.','Create a small hillside train platform with benches, signs and a simple track segment. Add clear access paths and explain how the scene is arranged.'],
    ['Add a rooftop garden above the city.','Add a rooftop garden with planters, seating, soft lights and clear walking space. Match the scale and style of the surrounding scene.'],
    ['Place a lighthouse on a dramatic sea cliff.','Create a lighthouse scene on a sea cliff, with a winding access path, railings and a visible rotating light effect. Explain the setup.'],
    ['Design a welcoming lobby for new players.','Create a welcoming spawn lobby with clear routes, a central landmark and simple signs for new players. Explain where players arrive and how they find their way.'],
    ['Give an NPC a friendly first conversation.','Inspect available characters, then add or adapt one NPC with a short friendly greeting and a simple interaction prompt. Explain how the dialogue is triggered.'],
    ['Create a trail of collectible coins.','Add a short trail of collectible coins with a visible counter. Make each coin collectible once per player and explain the collection logic.'],
    ['Add sprinting with a simple stamina bar.','Implement player sprinting with a small stamina bar, gradual drain and recovery. Keep the controls clear and explain how to tune the values.'],
    ['Make the sky move from day into night.','Add a gentle configurable day-night cycle that transitions lighting and sky settings smoothly. Inspect existing lighting scripts first and explain the controls.'],
    ['Bring a gentle rainstorm into the scene.','Add a gentle rain effect with soft atmosphere and a few puddle details. Keep important paths visible and explain how to enable or disable the weather.'],
    ['Make a door open as players approach.','Add a door that opens smoothly when a player approaches and closes after they leave. Explain the trigger area and animation settings.'],
    ['Create moving platforms with clear timing.','Build a short moving-platform challenge with smooth predictable travel and visible waiting areas. Explain the movement loop and how to adjust its timing.'],
    ['Build a jump pad with a burst of particles.','Create a jump pad with a clear landing area, a short particle burst and a per-player cooldown. Explain the launch strength and cooldown settings.'],
    ['Connect two areas with glowing portals.','Add two visually distinct portals linking nearby areas, with a cooldown that prevents immediate teleport loops. Explain the destination and cooldown logic.'],
    ['Design a clean health and energy HUD.','Create a readable health and energy HUD that scales to desktop and mobile screens. Connect it to player state and explain how each display updates.'],
    ['Add a compact inventory bar for players.','Create a compact inventory bar for the tools already available in the place. Support mouse and touch selection and explain the UI organization.'],
    ['Guide players with simple waypoint markers.','Add clear waypoint markers leading from spawn to an existing point of interest. Keep them readable at different distances and explain how to change the destination.'],
    ['Create a short cinematic camera intro.','Add a short cinematic camera introduction that moves through a few points, can be skipped and returns control to the player. Explain how to edit the camera path.'],
    ['Find easy ways to make this place run better.','Inspect the place for unnecessary parts, expensive effects and frequently running scripts. Explain the most useful performance improvements before applying any changes.'],
    ['Organize the scene so it is easier to build on.','Inspect the scene hierarchy and propose clear names and folders for related objects. Preserve script references and existing behavior, then explain the organization changes.']
  ].map(([label,prompt])=>({label,prompt}));
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let paused=document.documentElement.dataset.motion==='paused';
  try{paused=paused||localStorage.getItem('miracle.welcome.motionPaused')==='true';}catch{/* optional */}
  let index=0,count=0,phase='typing',timer=0,releaseTimer=0,started=false;
  let visible=true,hovered=false,focused=false,copyHeld=false;
  const held=()=>paused||reduced.matches||hovered||focused||copyHeld;
  const canType=()=>!held()&&!document.hidden&&visible;
  const current=()=>ideas[index];
  // Every full label shares one invisible grid cell. Its intrinsic maximum
  // reserves the correct number of lines at any width, without resize polling.
  const measures=document.createDocumentFragment();
  for(const idea of ideas){
    const measure=document.createElement('span');measure.className='welcome-prompt-measure';
    measure.textContent='“'+idea.label+'”';measures.append(measure);
  }
  copy.append(measures);
  function select(){
    button.dataset.copyPrompt=current().prompt;
    button.setAttribute('aria-label',`Copy idea ${index+1} of ${ideas.length}: ${current().label}`);
    if(counter)counter.textContent=String(index+1).padStart(2,'0')+' / '+ideas.length;
  }
  function paint(cursor=false){
    text.textContent='“'+current().label.slice(0,count)+(count===current().label.length?'”':'');
    text.classList.toggle('is-typing',cursor);
  }
  function queue(delay){clearTimeout(timer);timer=0;if(canType())timer=setTimeout(tick,delay);}
  function tick(){
    timer=0;if(!canType())return;
    if(phase==='hold'){phase='deleting';queue(100);return;}
    if(phase==='deleting'){
      count=Math.max(0,count-1);
      if(!count){index=(index+1)%ideas.length;phase='typing';select();}
      paint(true);queue(count?20:420);return;
    }
    count++;
    if(count>=current().label.length){count=current().label.length;phase='hold';}
    paint(true);queue(phase==='hold'?9000:48);
  }
  function sync(){
    clearTimeout(timer);timer=0;
    if(held()){count=current().label.length;phase='hold';paint();return;}
    paint(canType());queue(phase==='hold'?9000:!started?1100:150);started=true;
  }
  function prepareCopy(target=button){
    if(target!==button)return target.dataset.copyPrompt;
    copyHeld=true;clearTimeout(releaseTimer);sync();
    releaseTimer=setTimeout(()=>{releaseTimer=0;copyHeld=false;sync();},6000);
    return current().prompt;
  }
  window.MiraclePrompts={prepareCopy};
  button.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch'){hovered=true;sync();}});
  button.addEventListener('pointerleave',()=>{hovered=false;sync();});
  button.addEventListener('focusin',()=>{focused=true;sync();});
  button.addEventListener('focusout',()=>{focused=false;sync();});
  button.addEventListener('pointerdown',()=>prepareCopy());
  document.addEventListener('miracle:motion',event=>{paused=Boolean(event.detail.paused);sync();});
  reduced.addEventListener('change',sync);
  function suspend(){clearTimeout(timer);clearTimeout(releaseTimer);timer=releaseTimer=0;copyHeld=false;hovered=false;paint();}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else sync();});
  if('IntersectionObserver'in window){
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.target===button){visible=entry.isIntersecting;if(visible)sync();else suspend();}
    });observer.observe(button);
  }
  window.addEventListener('pagehide',suspend);window.addEventListener('pageshow',sync);
  select();sync();
})();
