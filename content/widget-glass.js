/* Edge refraction for the isolated chat widget. No host DOM reads or requests. */
(() => {
  'use strict';
  function mount(root) {
    const supported = /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent)
      && typeof ResizeObserver !== 'undefined' && CSS.supports('backdrop-filter','url(#miracle-widget-lens)');
    if (!supported) return {refresh(){}};
    const reduced = matchMedia('(prefers-reduced-transparency: reduce)');
    const contrast = matchMedia('(forced-colors: active)');
    const ns = 'http://www.w3.org/2000/svg';
    function node(tag,attrs,parent) {
      const el=document.createElementNS(ns,tag);
      for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
      parent.append(el);return el;
    }
    const svg=node('svg',{class:'widget-optics',width:0,height:0,'aria-hidden':'true'},root);
    const defs=node('defs',{},svg);
    const surfaces=[...root.querySelectorAll('.toggle,.panel')].map((el,i)=>{
      const id=`miracle-widget-lens-${i}`;
      const filter=node('filter',{id,filterUnits:'userSpaceOnUse',primitiveUnits:'userSpaceOnUse','color-interpolation-filters':'sRGB'},defs);
      const image=node('feImage',{result:'lens',preserveAspectRatio:'none'},filter);
      node('feDisplacementMap',{in:'SourceGraphic',in2:'lens',xChannelSelector:'R',yChannelSelector:'G',scale:20},filter);
      return {el,id,filter,image,geometry:''};
    });
    let frame=0;
    function refresh() {
      if(frame) return;
      frame=requestAnimationFrame(()=>{
        frame=0;
        for(const surface of surfaces) {
          const {el,filter,image}=surface;
          const width=el.clientWidth,height=el.clientHeight;
          if(el.hidden || !width || !height || document.hidden || reduced.matches || contrast.matches) {
            el.style.removeProperty('--widget-lens');continue;
          }
          const radius=Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius)||30,width/2,height/2);
          const geometry=`${width}:${height}:${radius}`;
          if(geometry!==surface.geometry) {
            const ratio=Math.min(1,Math.sqrt(32768/(width*height)),384/width,384/height);
            const canvas=document.createElement('canvas');
            canvas.width=Math.max(2,Math.floor(width*ratio));canvas.height=Math.max(2,Math.floor(height*ratio));
            const ctx=canvas.getContext('2d',{willReadFrequently:true});
            if(!ctx) continue;
            const pixels=ctx.createImageData(canvas.width,canvas.height);
            const bevel=Math.min(18,radius*.8);
            for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
              const px=(x+.5)/canvas.width*width-width/2,py=(y+.5)/canvas.height*height-height/2;
              const qx=Math.abs(px)-width/2+radius,qy=Math.abs(py)-height/2+radius;
              const mx=Math.max(qx,0),my=Math.max(qy,0),length=Math.hypot(mx,my);
              const inside=-(length+Math.min(Math.max(qx,qy),0)-radius);
              const edge=inside>=0&&inside<bevel?Math.sin(Math.PI*(1-inside/bevel)/2):0;
              const nx=Math.sign(px)*(length?mx/length:qx>qy?1:0);
              const ny=Math.sign(py)*(length?my/length:qx>qy?0:1);
              const i=(y*canvas.width+x)*4;
              pixels.data[i]=Math.round(127.5-nx*edge*114);
              pixels.data[i+1]=Math.round(127.5-ny*edge*114);
              pixels.data[i+2]=128;pixels.data[i+3]=255;
            }
            ctx.putImageData(pixels,0,0);
            for(const [k,v] of Object.entries({x:-24,y:-24,width:width+48,height:height+48})) filter.setAttribute(k,v);
            for(const [k,v] of Object.entries({x:0,y:0,width,height,href:canvas.toDataURL('image/png')})) image.setAttribute(k,v);
            surface.geometry=geometry;
          }
          el.style.setProperty('--widget-lens',`url(#${surface.id})`);
        }
      });
    }
    const resize=new ResizeObserver(refresh);surfaces.forEach(s=>resize.observe(s.el));
    document.addEventListener('visibilitychange',refresh);
    reduced.addEventListener('change',refresh);contrast.addEventListener('change',refresh);
    refresh();return {refresh};
  }
  globalThis.MiracleWidgetGlass={mount};
})();
