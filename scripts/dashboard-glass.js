/* One bounded optical surface. No animation loop, pointer tracking, or RGB
 * filter stacks. A normal map bends the real backdrop at the rounded bevel. */
(() => {
  'use strict';
  const surface = document.querySelector('[data-glass]');
  const hint = document.getElementById('glassEngineStatus');
  const root = document.documentElement;
  let geometry = '', timer = 0, visible = false, displacement;
  const supported = !!surface && !!window.ResizeObserver && CSS.supports('backdrop-filter', 'url(#lens)');
  const ns = 'http://www.w3.org/2000/svg';
  let filter, map;
  if (supported) {
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true'); svg.classList.add('optics-definitions');
    svg.innerHTML = '<defs><filter id="dashboard-lens" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feImage result="normal" preserveAspectRatio="none"/><feDisplacementMap in="SourceGraphic" in2="normal" xChannelSelector="R" yChannelSelector="G" scale="27"/></filter></defs>';
    document.body.append(svg);
    filter = svg.querySelector('filter'); map = svg.querySelector('feImage');
    displacement = svg.querySelector('feDisplacementMap');
  }
  // The initial material respects OS transparency preferences. An explicit
  // choice in Appearance overrides that default, including on Windows.
  function enabled() { return supported && document.body.dataset.glassMode === 'clear'; }
  function state() {
    const active = enabled() && visible && !document.hidden;
    surface?.style.setProperty('--glass-filter', active ? 'url(#dashboard-lens)' : 'none');
    root.dataset.glassEngine = active ? 'refraction' : 'light';
    if (hint) hint.textContent = !supported ? 'Transparent material; refraction is unavailable in this browser.'
      : document.body.dataset.glassMode === 'light' ? 'Effects off.'
      : document.body.dataset.glassMode === 'frosted' ? 'Frosted glass blurs the background.'
      : 'Refraction along the main card edges.';
    if (active) schedule();
  }
  function update() {
    if (!enabled() || !visible || document.hidden) return;
    const w = Math.round(surface.clientWidth), h = Math.round(surface.clientHeight);
    if (!w || !h || geometry === `${w}:${h}`) return;
    const canvas = document.createElement('canvas');
    // At most 24,576 pixels, independent of display DPI and card size.
    canvas.width = Math.min(192, Math.max(16, Math.round(w / 3)));
    canvas.height = Math.min(128, Math.max(16, Math.round(h / 3)));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(canvas.width, canvas.height);
    const radius = Math.min(parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 25, w / 2, h / 2);
    const bevel = Math.min(24, radius);
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const px = (x + .5) / canvas.width * w - w / 2;
        const py = (y + .5) / canvas.height * h - h / 2;
        const qx = Math.abs(px) - w / 2 + radius, qy = Math.abs(py) - h / 2 + radius;
        const mx = Math.max(qx, 0), my = Math.max(qy, 0), length = Math.hypot(mx, my);
        const distance = length + Math.min(Math.max(qx, qy), 0) - radius;
        const slope = Math.max(0, Math.min(.97, 1 + distance / bevel));
        const bend = Math.tan(Math.asin(slope) - Math.asin(slope / 1.52));
        const nx = length ? mx / length : qx > qy ? 1 : 0;
        const ny = length ? my / length : qx > qy ? 0 : 1;
        const i = (y * canvas.width + x) * 4;
        image.data[i] = clamp(128 - Math.sign(px) * nx * bend * 110);
        image.data[i + 1] = clamp(128 - Math.sign(py) * ny * bend * 110);
        image.data[i + 2] = 128; image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    for (const node of [filter, map]) { node.setAttribute('width', w); node.setAttribute('height', h); node.setAttribute('x', '0'); node.setAttribute('y', '0'); }
    map.setAttribute('href', canvas.toDataURL('image/png'));
    geometry = `${w}:${h}`;
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  }
  window.DashboardGlass = {
    setDepth(value) {
      const depth = Math.max(.2, Math.min(1, Number(value) / 100 || .68));
      displacement?.setAttribute('scale', (8 + depth * 28).toFixed(1));
    },
    refresh: state
  };
  if (supported) {
    new ResizeObserver(schedule).observe(surface);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => { visible = entries[0].isIntersecting; state(); }).observe(surface);
    } else visible = true;
    document.addEventListener('visibilitychange', state);
  }
  state();
})();
