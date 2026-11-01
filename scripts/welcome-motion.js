/* Welcome-only motion controls; CSS remains readable without JavaScript. */
(() => {
  'use strict';
  const button = document.getElementById('welcomeMotion');
  if (!button) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'miracle.welcome.motionPaused';
  let paused = false;
  try { paused = localStorage.getItem(key) === 'true'; } catch { /* optional */ }
  const headline = document.getElementById('welcomeTitle');
  const still = headline?.hasAttribute?.('data-headline-static');
  const lead = document.getElementById('welcomeTitleLead');
  const end = document.getElementById('welcomeTitleEnd');
  const phrases = [['Welcome to', 'Argon.'], ['Your ideas.', 'In Studio.'],
    ['Less setup.', 'More flow.'], ['Build with', 'your AI.']];
  let phrase = 0, count = 0, phase = 'typing', timer = 0, visible = true, started = false;
  const total = () => phrases[phrase][0].length + phrases[phrase][1].length;
  const canType = () => lead && end && !paused && !reduced.matches && !document.hidden && visible;
  function paint(cursor = false) {
    if (!lead || !end) return;
    const [first, second] = phrases[phrase];
    lead.textContent = first.slice(0, count);
    end.textContent = second.slice(0, Math.max(0, count - first.length));
    lead.classList.toggle('is-current', cursor && count <= first.length && phase === 'typing');
    end.classList.toggle('is-current', cursor && (count > first.length || phase !== 'typing'));
  }
  function queue(delay) {
    clearTimeout(timer);
    if (canType()) timer = setTimeout(type, delay);
  }
  function type() {
    timer = 0;
    if (!canType()) return;
    if (phase === 'hold') { phase = 'deleting'; queue(100); return; }
    if (phase === 'deleting') {
      count = Math.max(0, count - 1);
      if (!count) { phrase = (phrase + 1) % phrases.length; phase = 'typing'; }
      paint(true); queue(count ? 38 : 380); return;
    }
    count++;
    if (count >= total()) { count = total(); phase = 'hold'; }
    paint(true);
    queue(phase === 'hold' ? 2600 : count === phrases[phrase][0].length ? 280 : 85);
  }
  function syncType() {
    clearTimeout(timer); timer = 0;
    if (!lead || !end) return;
    if (still || paused || reduced.matches) {
      count = total(); phase = 'hold'; started = true; paint(); return;
    }
    if (!canType()) { paint(); return; }
    paint(true);
    queue(!started ? 1000 : phase === 'hold' ? 1800 : 120);
    started = true;
  }
  function render() {
    document.body.dataset.motionPaused = String(paused || reduced.matches);
    document.documentElement?.setAttribute('data-motion',paused||reduced.matches?'paused':'running');
    document.dispatchEvent?.(new CustomEvent('miracle:motion',{detail:{paused:paused||reduced.matches}}));
    button.disabled = reduced.matches;
    button.setAttribute('aria-pressed', String(paused || reduced.matches));
    button.textContent = reduced.matches ? 'Reduced motion' : paused ? 'Resume motion' : 'Pause motion';
    button.hidden = false;
    syncType();
  }
  button.addEventListener('click', () => {
    paused = !paused;
    try { localStorage.setItem(key, String(paused)); } catch { /* memory fallback */ }
    render();
  });
  reduced.addEventListener('change', render);
  const visibility = () => {
    document.body.dataset.pageHidden = String(document.hidden);
    syncType();
  };
  document.addEventListener('visibilitychange', visibility);
  const panel = document.querySelector('.welcome-connect');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === panel) panel.dataset.motionVisible = String(entry.isIntersecting);
        if (entry.target === headline) { visible = entry.isIntersecting; syncType(); }
      }
    });
    if (panel) observer.observe(panel);
    if (headline) observer.observe(headline);
  }
  window.addEventListener('pagehide', () => { clearTimeout(timer); timer = 0; });
  window.addEventListener('pageshow', syncType);
  document.body.dataset.pageHidden = String(document.hidden);
  render();
})();
