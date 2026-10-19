/* Welcome-only motion controls; CSS remains readable without JavaScript. */
(() => {
  'use strict';
  const button = document.getElementById('welcomeMotion');
  if (!button) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'miracle.welcome.motionPaused';
  let paused = false;
  try { paused = localStorage.getItem(key) === 'true'; } catch { /* optional */ }
  function render() {
    document.body.dataset.motionPaused = String(paused || reduced.matches);
    button.disabled = reduced.matches;
    button.setAttribute('aria-pressed', String(paused || reduced.matches));
    button.textContent = reduced.matches ? 'Reduced motion' : paused ? 'Resume motion' : 'Pause motion';
    button.hidden = false;
  }
  button.addEventListener('click', () => {
    paused = !paused;
    try { localStorage.setItem(key, String(paused)); } catch { /* memory fallback */ }
    render();
  });
  reduced.addEventListener('change', render);
  const visibility = () => { document.body.dataset.pageHidden = String(document.hidden); };
  document.addEventListener('visibilitychange', visibility);
  const panel = document.querySelector('.welcome-connect');
  if (panel && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      panel.dataset.motionVisible = String(entries[0].isIntersecting);
    });
    observer.observe(panel);
  }
  visibility();
  render();
})();
