/* Shared, offline headline typing for the dashboard and marketing site. */
(() => {
  'use strict';
  const headings=[...document.querySelectorAll('[data-typewriter]')];
  if(!headings.length) return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const key='miracle.motionPaused';
  let paused=false;
  try { paused=(localStorage.getItem(key)??localStorage.getItem('miracle.welcome.motionPaused'))==='true'; } catch { /* optional */ }
  const controls=[...document.querySelectorAll('[data-motion-toggle]')];
  const states=headings.map(el=>{
    const lines=[...el.querySelectorAll('[data-type-line]')];
    let phrases;
    try { phrases=JSON.parse(el.dataset.typePhrases); } catch { return null; }
    if(!lines.length || !Array.isArray(phrases) || !phrases.length || phrases.some(p=>!Array.isArray(p)||p.length!==lines.length||p.some(t=>typeof t!=='string'||!t.length))) return null;
    if(el.dataset.typewriter==='dashboard') {
      const greeting=window.MiracleAppearance?.clock().greeting || phrases[0][0];
      phrases[0][0]=greeting;el.setAttribute('aria-label',greeting+' Miracle workspace.');
    }
    return {el,lines,phrases,phrase:0,count:0,phase:'typing',timer:0,visible:true,started:false};
  }).filter(Boolean);
  const canType=s=>!paused&&!reduced.matches&&!document.hidden&&s.visible;
  const length=s=>s.phrases[s.phrase].join('').length;
  function paint(s,cursor=false) {
    let left=s.count;
    s.lines.forEach((line,i)=>{
      const text=s.phrases[s.phrase][i];line.textContent=text.slice(0,Math.max(0,left));
      const current=left<=text.length&&left>=0&&(i===0||left>0);
      line.classList.toggle('is-current',cursor&&(s.phase==='hold'?i===s.lines.length-1:current));
      left-=text.length;
    });
  }
  function queue(s,delay) {
    clearTimeout(s.timer);s.timer=0;
    if(canType(s)) s.timer=setTimeout(()=>tick(s),delay);
  }
  function tick(s) {
    s.timer=0;if(!canType(s)) return;
    if(s.phase==='hold'){s.phase='deleting';queue(s,100);return;}
    if(s.phase==='deleting') {
      s.count=Math.max(0,s.count-1);
      if(!s.count){s.phrase=(s.phrase+1)%s.phrases.length;s.phase='typing';}
      paint(s,true);queue(s,s.count?35:380);return;
    }
    s.count++;
    if(s.count>=length(s)){s.count=length(s);s.phase='hold';}
    paint(s,true);queue(s,s.phase==='hold'?2800:80);
  }
  function sync(s) {
    clearTimeout(s.timer);s.timer=0;
    if(paused||reduced.matches){s.count=length(s);s.phase='hold';paint(s);return;}
    paint(s,canType(s));queue(s,!s.started?900:s.phase==='hold'?1800:120);s.started=true;
  }
  function render() {
    controls.forEach(button=>{
      button.hidden=false;button.disabled=reduced.matches;
      button.setAttribute('aria-pressed',String(paused||reduced.matches));
      button.textContent=reduced.matches?'Reduced motion':paused?'Resume motion':'Pause motion';
    });
    states.forEach(sync);
  }
  controls.forEach(button=>button.addEventListener('click',()=>{
    paused=!paused;try{localStorage.setItem(key,String(paused));}catch{/* memory fallback */}render();
  }));
  reduced.addEventListener('change',render);
  document.addEventListener('visibilitychange',()=>states.forEach(sync));
  window.addEventListener('pagehide',()=>states.forEach(s=>clearTimeout(s.timer)));
  window.addEventListener('pageshow',()=>states.forEach(sync));
  if('IntersectionObserver' in window) {
    const byElement=new Map(states.map(s=>[s.el,s]));
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      const s=byElement.get(entry.target);if(s){s.visible=entry.isIntersecting;sync(s);}
    }));
    states.forEach(s=>observer.observe(s.el));
  }
  render();
})();
