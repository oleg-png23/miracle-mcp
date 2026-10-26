/* Rounded lenses refract the live backdrop, never the foreground content.
 * Optical model: https://kube.io/blog/liquid-glass-css-svg/
 * Material layers: https://developer.apple.com/videos/play/wwdc2025/219/ */
(() => {
  'use strict';
  const root = document.documentElement;
  const hint = document.getElementById('glassEngineStatus');
  const primarySelector = '.hero-card, .sidebar.glass, .welcome-connect';
  const elements = [...document.querySelectorAll('.glass, .welcome-connect')];
  if (!elements.length) return;

  const optics = Object.freeze({
    refractiveIndex: 1.5,
    maxMapSide: 512,
    maxMapPixels: 65536,
    maxCachedMaps: 32,
    maxBevel: 34,
    minBevel: 6,
    defaultDepth: 68,
    dispersion: 0.035,
    resizeDelay: 100
  });
  // Parsing url() alone also succeeds in engines that cannot apply SVG to a
  // backdrop. Restrict that path to Chromium; retain a CSS material elsewhere.
  const supported = /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent)
    && typeof ResizeObserver !== 'undefined'
    && CSS.supports('backdrop-filter', 'url(#miracle-lens)');
  const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
  const contrast = matchMedia('(forced-colors: active)');
  const ns = 'http://www.w3.org/2000/svg';
  const cache = new Map();
  const pending = new Set();
  let timer = 0, frame = 0;
  const metrics = {mapsBuilt: 0, pixelsBuilt: 0, generationMs: 0};
  let depth = Number(document.getElementById('glassDepth')?.value) || optics.defaultDepth;
  let defs;

  function node(tag, attrs, parent) {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    parent.append(el);
    return el;
  }
  if (supported) {
    const svg = node('svg', {width: 0, height: 0, 'aria-hidden': 'true', class: 'optics-definitions'}, document.body);
    defs = node('defs', {}, svg);
  }

  const surfaces = elements.map((el, index) => ({
    el, id: `miracle-lens-${index}`, idBase: `miracle-lens-${index}`, revision: 0, active: null, boundId: null, requestedGeometry: '', visible: false, geometry: '',
    filter: null, map: null, displacements: [], scale: 0,
    primary: el.matches(primarySelector),
    chromatic: true
  }));
  const byElement = new Map(surfaces.map(surface => [surface.el, surface]));

  function mode() {
    if (contrast.matches || (transparency.matches && !['clear', 'liquid', 'beautify'].includes(document.body.dataset.glassChoice))) return 'light';
    return document.body.dataset.glassMode || 'clear';
  }
  function enabled() { return supported && ['clear', 'liquid', 'beautify'].includes(mode()); }
  function eligible(surface) { return mode() === 'beautify' || surface.primary; }
  function retained(surface) { return mode() === 'beautify' || surface.visible; }
  function setActive(surface, active) {
    if (surface.active !== active) {
      surface.el.dataset.glassActive = String(active);
      surface.active = active;
    }
    if (active && surface.boundId !== surface.id) {
      surface.el.style.setProperty('--glass-filter', `url(#${surface.id})`);
      surface.boundId = surface.id;
    } else if (!active && surface.boundId !== null) {
      surface.el.style.removeProperty('--glass-filter');
      surface.boundId = null;
    }
  }
  function updateScale(surface) {
    const strength = (0.45 + depth / 100 * 0.9) * (mode() === 'beautify' ? 1.7 : 1);
    surface.displacements.forEach((el, index) => {
      const dispersion = surface.chromatic ? 1 + (index - 1) * (mode() === 'beautify' ? 0.065 : optics.dispersion) : 1;
      const value = (surface.scale * strength * dispersion).toFixed(2);
      if (el.getAttribute('scale') !== value) el.setAttribute('scale', value);
    });
  }
  function createFilter(surface) {
    surface.filter = node('filter', {
      id: surface.id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB'
    }, defs);
    surface.map = node('feImage', {result: 'normal', preserveAspectRatio: 'none'}, surface.filter);
    if (!surface.chromatic) {
      surface.displacements.push(node('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'normal', xChannelSelector: 'R', yChannelSelector: 'G'
      }, surface.filter));
      return;
    }
    // Split then add RGB, keeping alpha at 1. This avoids the milky image and
    // doubled edges produced by blending three complete translucent images.
    for (let channel = 0; channel < 3; channel++) {
      surface.displacements.push(node('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'normal', xChannelSelector: 'R', yChannelSelector: 'G', result: `bend-${channel}`
      }, surface.filter));
      const matrix = Array(20).fill(0);
      matrix[channel * 6] = 1;
      matrix[18] = 1;
      node('feColorMatrix', {in: `bend-${channel}`, type: 'matrix', values: matrix.join(' '), result: `rgb-${channel}`}, surface.filter);
    }
    node('feBlend', {in: 'rgb-0', in2: 'rgb-1', mode: 'screen', result: 'rg'}, surface.filter);
    node('feBlend', {in: 'rg', in2: 'rgb-2', mode: 'screen'}, surface.filter);
  }

  function makeMaps(width, height, radius, bevel) {
    const started = performance.now();
    const maxSide = mode() === 'beautify' ? 768 : optics.maxMapSide;
    const maxPixels = mode() === 'beautify' ? 262144 : optics.maxMapPixels;
    const ratio = Math.min(1, maxSide / width, maxSide / height,
      Math.sqrt(maxPixels / (width * height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.floor(width * ratio));
    canvas.height = Math.max(2, Math.floor(height * ratio));
    // These pixels originate on the CPU. A software canvas avoids waiting for
    // GPU readback when exporting the two small optical textures.
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) return null;
    const normal = ctx.createImageData(canvas.width, canvas.height);
    const specular = ctx.createImageData(canvas.width, canvas.height);
    const thickness = bevel * 0.95;
    const reach = thickness * 1.3;
    const encode = value => Math.max(0, Math.min(255, Math.round(value)));
    // Curvature depends only on distance into the bevel. Cache the optical
    // profile once instead of evaluating trigonometry for every edge pixel.
    const samples = 512;
    const profile = Array.from({length: samples + 1}, (_, index) => {
      const t = Math.max(0.001, Math.min(1, index / samples * 1.4));
      const heightAt = Math.sqrt(1 - (1 - t) ** 2);
      const incidence = Math.atan((1 - t) / Math.max(heightAt, 0.001) * thickness / bevel);
      const transmitted = Math.asin(Math.sin(incidence) / optics.refractiveIndex);
      const inside = index / samples * bevel * 1.4;
      return {
        bend: t < 1 ? Math.tan(incidence - transmitted) * (thickness + heightAt * bevel * 0.35) : 0,
        rim: Math.exp(-(((inside - 1.1) / 1.35) ** 2)),
        innerRim: Math.exp(-(((inside - bevel * 0.65) / (bevel * 0.22)) ** 2))
      };
    });

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const px = (x + 0.5) / canvas.width * width - width / 2;
        const py = (y + 0.5) / canvas.height * height - height / 2;
        // Signed distance and analytic normal of a rounded rectangle. Each
        // map is generated at its own aspect ratio, including pill-shaped rails.
        const qx = Math.abs(px) - width / 2 + radius;
        const qy = Math.abs(py) - height / 2 + radius;
        const mx = Math.max(qx, 0), my = Math.max(qy, 0), length = Math.hypot(mx, my);
        const distance = length + Math.min(Math.max(qx, qy), 0) - radius;
        const inside = -distance;
        const i = (y * canvas.width + x) * 4;
        normal.data[i] = 128;
        normal.data[i + 1] = 128;
        normal.data[i + 2] = 128;
        normal.data[i + 3] = 255;
        // The flat interior has no curvature, displacement or edge light.
        if (inside < 0 || inside >= bevel * 1.4) continue;
        const nx = Math.sign(px) * (length ? mx / length : qx > qy ? 1 : 0);
        const ny = Math.sign(py) * (length ? my / length : qx > qy ? 0 : 1);
        const {bend, rim, innerRim} = profile[Math.min(samples, Math.round(inside / (bevel * 1.4) * samples))];
        normal.data[i] = encode(127.5 - nx * bend / reach * 127.5);
        normal.data[i + 1] = encode(127.5 - ny * bend / reach * 127.5);
        normal.data[i + 2] = 128;
        normal.data[i + 3] = 255;

        const light = Math.max(0, nx * -0.55 + ny * -0.83);
        const returnLight = Math.max(0, nx * 0.7 + ny * 0.7);
        const alpha = inside >= 0
          ? rim * (0.23 + light ** 3 * 0.72 + returnLight ** 5 * 0.3)
            + innerRim * (light ** 8 * 0.14 + returnLight ** 8 * 0.08) : 0;
        specular.data[i] = 235;
        specular.data[i + 1] = 250;
        specular.data[i + 2] = 255;
        specular.data[i + 3] = encode(alpha * 255);
      }
    }
    ctx.putImageData(normal, 0, 0);
    const displacement = canvas.toDataURL('image/png');
    ctx.putImageData(specular, 0, 0);
    const specularMap = canvas.toDataURL('image/png');
    metrics.mapsBuilt++;
    metrics.pixelsBuilt += canvas.width * canvas.height;
    metrics.generationMs += performance.now() - started;
    const maps = {displacement, specular: specularMap, scale: reach * 2, loaded: true};
    if (typeof Image !== 'undefined') {
      maps.loaded = false;
      const decode = src => { const image = new Image(); image.src = src; return image.decode(); };
      maps.ready = Promise.all([decode(displacement), decode(specularMap)]).then(
        () => { maps.loaded = true; }, () => { maps.failed = true; }
      );
    }
    return maps;
  }

  function update(surface) {
    if (!enabled() || document.hidden || !retained(surface) || !eligible(surface)) return;
    const material = mode();
    const width = Math.round(surface.el.clientWidth), height = Math.round(surface.el.clientHeight);
    if (!width || !height) return;
    const style = getComputedStyle(surface.el);
    const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 25, width / 2, height / 2);
    const bevel = Math.max(2, Math.min(mode() === 'beautify' ? 42 : optics.maxBevel, radius * 0.9,
      Math.max(optics.minBevel, Number(surface.el.dataset.glassBevel) || radius), Math.min(width, height) / 3));
    const geometry = `${mode()}:${width}:${height}:${radius.toFixed(1)}:${bevel.toFixed(1)}`;
    if (geometry === surface.geometry) { surface.requestedGeometry = ''; setActive(surface, true); return; }
    if (geometry === surface.requestedGeometry) return;
    surface.requestedGeometry = geometry;
    let maps = cache.get(geometry);
    if (!maps) {
      maps = makeMaps(width, height, radius, bevel);
      if (!maps) { surface.requestedGeometry = ''; return; }
      if (cache.size >= optics.maxCachedMaps) cache.delete(cache.keys().next().value);
      cache.set(geometry, maps);
    }
    const commit = () => {
      if (surface.requestedGeometry !== geometry) return;
      if (!enabled() || !eligible(surface) || !retained(surface) || mode() !== material) { surface.requestedGeometry = ''; return; }
      if (surface.el.clientWidth !== width || surface.el.clientHeight !== height) { surface.requestedGeometry = ''; schedule(surface); return; }
      if (!maps.loaded) { surface.requestedGeometry = ''; return; }
      // Build an immutable replacement while the previous lens remains attached.
      const next = {id: `${surface.idBase}-${++surface.revision}`, chromatic: material !== 'liquid', displacements: []};
      createFilter(next);
      const padding = Math.ceil(maps.scale * 2.6);
      for (const [key, value] of Object.entries({x: -padding, y: -padding, width: width + padding * 2, height: height + padding * 2})) next.filter.setAttribute(key, value);
      for (const [key, value] of Object.entries({x: 0, y: 0, width, height, href: maps.displacement})) next.map.setAttribute(key, value);
      const previous = surface.filter;
      Object.assign(surface, next, {scale: maps.scale, geometry, width, height, requestedGeometry: ''});
      surface.el.style.setProperty('--glass-specular', `url("${maps.specular}")`);
      updateScale(surface);
      setActive(surface, true);
      if (previous) requestAnimationFrame(() => previous.remove());
    };
    if (maps.loaded) commit();
    else maps.ready.then(commit);
  }

  function drain() {
    frame = 0;
    if (!enabled() || document.hidden) { pending.clear(); return; }
    const surface = pending.values().next().value;
    if (surface) { pending.delete(surface); update(surface); }
    // Prepare one resize per frame without detaching the previously rendered lens.
    if (pending.size) frame = requestAnimationFrame(drain);
  }
  function schedule(surface) {
    if (!enabled() || document.hidden || !retained(surface) || !eligible(surface)) return;
    pending.add(surface);
    if (!frame) frame = requestAnimationFrame(drain);
  }
  function state() {
    const material = mode();
    root.dataset.glassEngine = material === 'light' ? 'light'
      : material === 'frosted' ? 'frosted' : supported ? 'refraction' : 'fallback';
    if (document.hidden) { pending.clear(); return; }
    surfaces.forEach(surface => {
      surface.el.dataset.glassPassive = String(!eligible(surface));
      updateScale(surface);
      if (enabled() && retained(surface) && eligible(surface)) schedule(surface);
      else setActive(surface, false);
    });
    if (hint) hint.textContent = material === 'light' ? 'Effects off.'
      : material === 'frosted' ? 'Soft, frosted glass.'
      : material === 'beautify' ? (supported ? 'Beautify · persistent refraction and RGB glass on every surface.' : 'Beautify · rich frosted glass. Live refraction needs Chrome or Edge.')
      : material === 'liquid' ? 'Transparent glass. No added color, just light and the background.'
      : 'Tinted glass. A soft wash of Lime Soda color.';
  }
  window.DashboardGlass = {
    getMetrics() { return {...metrics, activeSurfaces: surfaces.filter(surface => surface.el.dataset.glassActive === 'true').length}; },
    setDepth(value) {
      const parsed = Number(value);
      depth = Number.isFinite(parsed) ? Math.max(20, Math.min(100, parsed)) : optics.defaultDepth;
      root.style.setProperty('--glass-strength', (depth / 100).toFixed(2));
      surfaces.forEach(updateScale);
    },
    refresh: state
  };
  if (supported) {
    const resize = new ResizeObserver(entries => {
      entries.forEach(entry => {
        const surface = byElement.get(entry.target);
        if (surface && retained(surface) && eligible(surface) && (surface.el.clientWidth !== surface.width || surface.el.clientHeight !== surface.height)) pending.add(surface);
      });
      clearTimeout(timer);
      timer = setTimeout(() => { if (!frame && pending.size) frame = requestAnimationFrame(drain); }, optics.resizeDelay);
    });
    surfaces.forEach(surface => resize.observe(surface.el));
    if ('IntersectionObserver' in window) {
      const intersection = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const surface = byElement.get(entry.target);
          surface.visible = entry.isIntersecting;
          if (retained(surface)) schedule(surface);
          else { pending.delete(surface); setActive(surface, false); }
        });
      });
      surfaces.forEach(surface => intersection.observe(surface.el));
    } else surfaces.forEach(surface => { surface.visible = true; });
  }
  document.addEventListener('visibilitychange', state);
  transparency.addEventListener('change', state);
  contrast.addEventListener('change', state);
  window.DashboardGlass.setDepth(depth);
  state();
})();
