const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('welcome headline types, rotates, and completes text when motion is paused', () => {
  const timers = new Map(), events = {}, classes = new Map();
  let id = 0, mediaChange, intersection;const motionEvents=[];
  const node = () => ({dataset:{},textContent:'',setAttribute(){},
    classList:{toggle:(name,value)=>classes.set(name,value)}});
  const nodes = {welcomeMotion:node(),welcomeTitle:node(),welcomeTitleLead:node(),welcomeTitleEnd:node()};
  const media = {matches:false,addEventListener:(_event,fn)=>{mediaChange=fn;}};
  nodes.welcomeMotion.addEventListener=(_event,fn)=>{events.click=fn;};
  const panel=node();
  const document = {documentElement:{setAttribute(){}},dispatchEvent:event=>motionEvents.push(event),body:node(),hidden:false,getElementById:id=>nodes[id],querySelector:()=>panel,
    addEventListener:(event,fn)=>{events[event]=fn;}};
  const context = {CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},document,matchMedia:()=>media,localStorage:{getItem:()=>null,setItem(){}},
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),
    IntersectionObserver:class{constructor(fn){intersection=fn;}observe(){}},
    window:{IntersectionObserver:true,addEventListener:(event,fn)=>{events[event]=fn;}}};
  const step=()=>{const [key,fn]=timers.entries().next().value;timers.delete(key);fn();};
  const text=()=>nodes.welcomeTitleLead.textContent+' '+nodes.welcomeTitleEnd.textContent;
  const complete=()=>assert(['Welcome to Miracle.','Your ideas. In Studio.','Less setup. More flow.','Build with your AI.'].includes(text()));
  vm.runInNewContext(fs.readFileSync('scripts/welcome-motion.js','utf8'),context);
  assert.equal(timers.size,1);
  step(); assert.equal(nodes.welcomeTitleLead.textContent,'W');
  const seen=new Set();
  for(let i=0;i<100;i++){step();seen.add(text());}
  assert(seen.has('Welcome to Miracle.'));
  assert(seen.has('Your ideas. In Studio.'));
  events.click(); complete(); assert.equal(timers.size,0);assert.equal(motionEvents.at(-1).detail.paused,true);
  events.click(); assert.equal(timers.size,1);assert.equal(motionEvents.at(-1).detail.paused,false);
  document.hidden=true;events.visibilitychange();assert.equal(timers.size,0);
  document.hidden=false;events.visibilitychange();assert.equal(timers.size,1);
  intersection([{target:nodes.welcomeTitle,isIntersecting:false}]);assert.equal(timers.size,0);
  intersection([{target:nodes.welcomeTitle,isIntersecting:true}]);assert.equal(timers.size,1);
  media.matches=true;mediaChange();complete();assert.equal(timers.size,0);
  assert.equal(nodes.welcomeMotion.disabled,true);
});
