const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function appearance(){
 const events={},requests=[],pending=new Map();let defer=false;
 const photo={complete:true,naturalWidth:2560,src:'assets/bg/lime-soda.svg',getAnimations:()=>[]};
 const label={textContent:''};const body={dataset:{wallpaper:'lime'}};
 const buttons=['lime','gradient'].map(key=>({dataset:{wallpaper:key},classList:{toggle(){}},setAttribute(name,value){this[name]=value;}}));
 const context={document:{hidden:false,body,documentElement:{dataset:{},style:{setProperty(){}}},getElementById:id=>id==='bgPhoto'?photo:id==='wallpaperName'?label:null,
 querySelectorAll:q=>q==='.wallpaper-option'?buttons:[],addEventListener:(event,fn)=>events[event]=fn},window:{addEventListener:(event,fn)=>events[event]=fn},matchMedia:()=>({matches:true}),
 setTimeout:()=>1,clearTimeout(){},Image:class{set src(value){this._src=value;requests.push(value);}get src(){return this._src;}decode(){return defer?new Promise(resolve=>pending.set(this.src,resolve)):Promise.resolve();}}};
 vm.runInNewContext(fs.readFileSync('scripts/appearance.js','utf8'),context);
 return {api:context.window.MiracleAppearance,body,photo,label,buttons,requests,events,pending,setDefer:value=>defer=value};
}
test('only the two Lime Soda backgrounds are exposed and removed or inherited keys fall back to Lime Soda',async()=>{
 const a=appearance();assert.deepEqual(Object.keys(a.api.wallpapers),['lime','gradient']);
 for(const key of ['solar','fjord','coast','aurora','alpine','dunes','lavender','forest','sunset','constructor','__proto__',undefined])assert.equal(a.api.normalize(key),'lime');
 a.body.dataset.wallpaper='coast';await a.api.setMode('auto','coast');
 assert.equal(a.body.dataset.wallpaper,'lime');assert.equal(a.body.dataset.wallpaperMode,'manual');assert.equal(a.label.textContent,'Lime Soda');
 await a.api.apply('gradient');assert.equal(a.body.dataset.wallpaper,'gradient');assert.equal(a.label.textContent,'Animated gradient');
 a.events.visibilitychange();assert.equal(a.body.dataset.wallpaper,'gradient','Time and visibility changes must preserve the selected theme');
 assert(a.requests.every(src=>/\/(lime-soda|lime-gradient)\.svg$/.test(src)));
});
test('a slow earlier image decode cannot replace the newer theme selection',async()=>{
 const a=appearance();a.setDefer(true);const old=a.api.apply('gradient');await a.api.apply('lime');
 a.pending.get('assets/bg/lime-gradient.svg')();assert.equal(await old,false);
 assert.equal(a.body.dataset.wallpaper,'lime');assert.equal(a.photo.src,'assets/bg/lime-soda.svg');
});
test('removed materials migrate to Tinted glass and Liquid glass stays distinct',()=>{
 const a=appearance();assert.equal(a.api.normalizeMaterial('liquid'),'liquid');
 for(const value of ['clear','beautify','frosted','light','solar',undefined,'constructor','__proto__'])assert.equal(a.api.normalizeMaterial(value),'clear');
});
