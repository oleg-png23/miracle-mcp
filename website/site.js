(() => {
  'use strict';

  const scenes = new Set(['coast', 'alpine', 'aurora']);
  const photo = document.getElementById('heroWallpaper');
  const status = document.getElementById('announcement');
  let notificationTimer;
  let sceneRequest = 0;
  const announce = message => {
    status.textContent = message;
    status.classList.add('visible');
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => status.classList.remove('visible'), 2600);
  };

  function applyScene(name) {
    photo.src = `assets/bg/${name}-new.webp`;
    document.documentElement.dataset.scene = name;
    document.querySelectorAll('.scene').forEach(button => {
      const selected = button.dataset.scene === name;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    try { localStorage.setItem('miracle.website.scene', name); } catch { /* A blocked store leaves the control usable. */ }
  }

  async function selectScene(name, scrollToHero) {
    if (!scenes.has(name)) return;
    const request = ++sceneRequest;
    const preload = new Image();
    preload.src = `assets/bg/${name}-new.webp`;
    try { await preload.decode(); } catch { announce('This landscape could not load. Try again.'); return; }
    if (request !== sceneRequest) return;
    applyScene(name);
    photo.getAnimations?.().filter(animation=>animation.id==='site-scene-fade').forEach(animation=>animation.cancel());
    if(document.documentElement.dataset.siteMotion==='on'&&photo.animate){const fade=photo.animate([{opacity:.5},{opacity:1}],{duration:550,easing:'ease-out'});fade.id='site-scene-fade';}
    if (scrollToHero) document.querySelector('.hero').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.motion==='paused' ? 'instant' : 'smooth' });
    announce(`${name.charAt(0).toUpperCase() + name.slice(1)} landscape selected`);
  }

  document.querySelectorAll('[data-scene]').forEach(button => button.addEventListener('click', () => {
    selectScene(button.dataset.scene, button.classList.contains('landscape-card'));
  }));

  try {
    const saved = localStorage.getItem('miracle.website.scene');
    if (scenes.has(saved) && saved !== 'coast') selectScene(saved, false);
  } catch { /* Browsing without storage does not change the default view. */ }

  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      announce('Copied '+button.dataset.copy);
      button.querySelector('span').textContent = 'Copied ✓';
      setTimeout(() => { button.querySelector('span').innerHTML = 'Copy <svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg>'; }, 2200);
    } catch {
      announce('Select run.bat above to copy it.');
    }
  }));

  document.getElementById('year').textContent = String(new Date().getFullYear());
})();
