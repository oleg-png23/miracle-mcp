const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Deleting landing-page assets must not leave broken HTML, CSS or SVG references.
test('published pages and styles have valid local resource links and anchors', () => {
  const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  for (const file of walk('website').filter(file => /\.(html|css)$/.test(file))) {
    const source = fs.readFileSync(file, 'utf8');
    const refs = file.endsWith('.html')
      ? [...source.matchAll(/\b(?:src|href)="([^"\s]+)"/g)].map(match => match[1])
      : [...source.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map(match => match[1]);
    for (const ref of refs) {
      if (/^(?:[a-z]+:|\/\/)/i.test(ref)) continue;
      const [relative, fragment] = ref.split('#');
      const target = relative ? path.resolve(path.dirname(file), relative) : file;
      assert(fs.existsSync(target), `${file}: missing ${ref}`);
      if (fragment && /\.(html|svg)$/.test(target)) {
        const ids = [...fs.readFileSync(target, 'utf8').matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
        assert(ids.includes(fragment), `${file}: missing anchor ${ref}`);
      }
    }
  }
});

test('GitHub Pages exactly matches the website source, including file deletions', () => {
  const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.relative(dir.split(path.sep)[0], path.join(dir, entry.name))]).sort();
  const source = walk('website'), published = walk('docs');
  assert.deepEqual(published, source);
  for (const file of source) assert(fs.readFileSync(path.join('website', file)).equals(fs.readFileSync(path.join('docs', file))), file);
});

function copyFixture({denied=false}={}) {
  const timers = new Map(), copied = [], selected = [];
  let next = 0;
  const label = {textContent:'Copy path'}, code = {}, status = {textContent:'',classList:{add(){},remove(){}}}, year = {};
  const button = {dataset:{copy:'release\\run.bat'},querySelector:selector=>selector==='code'?code:label,
    addEventListener:(_event, fn)=>{button.click=fn;}};
  vm.runInNewContext(fs.readFileSync('website/site.js', 'utf8'), {
    document:{getElementById:id=>id==='announcement'?status:year,querySelectorAll:()=>[button],
      createRange:()=>({selectNodeContents:node=>selected.push(node)})},
    window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
    navigator:{clipboard:{writeText:async text=>{if(denied)throw Error('Clipboard denied');copied.push(text);}}},
    setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)
  });
  return {button,label,code,status,year,timers,copied,selected};
}

test('copy uses the real launcher path and repeated clicks keep one reset timer', async () => {
  const f = copyFixture();
  await f.button.click();await f.button.click();
  assert.deepEqual(f.copied,['release\\run.bat','release\\run.bat']);
  assert.equal(f.label.textContent,'Copied ✓');
  assert.equal(f.status.textContent,'Copied release\\run.bat');
  assert.equal(f.timers.size,2);
  for (const fn of f.timers.values()) fn();
  assert.equal(f.label.textContent,'Copy path');
  assert.equal(f.year.textContent,String(new Date().getFullYear()));
});

test('clipboard denial selects the visible launcher path for manual copying', async () => {
  const f = copyFixture({denied:true});await f.button.click();
  assert.deepEqual(f.selected,[f.code]);
  assert.match(f.status.textContent,/selected path/);
  assert.equal(f.label.textContent,'Copy path');
});
