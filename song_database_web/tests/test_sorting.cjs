const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function app() {
  const listeners = {};
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        content:'test', innerHTML:'', addEventListener() {},
        focus() {}, contains() { return false; }, classList:{toggle() {}},
      });
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
  };
  const context = vm.createContext({document, location:{hash:'#songs'}, window:{addEventListener() {}},
    fetch:() => new Promise(() => {}), setTimeout, clearTimeout, URL});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run(`state.songs = [
    {id:'z', name:'Zulu', version:'Version 10', languages:['日语'], status:'可演', played_count:2, last_played:'2026-01-02'},
    {id:'a', name:'alpha', version:'Version 2', languages:['英语'], status:'可演', played_count:10, last_played:'2026-09-01'},
    {id:'b', name:'Beta', version:'Acoustic', languages:['日语'], status:'大饼', played_count:0, last_played:null},
    {id:'c', name:'Charlie', version:'Original', languages:['日语'], status:'可演', played_count:2, last_played:'2026-01-02'},
    {id:'d', name:'Delta', version:'Live', languages:['英语'], status:'取消', played_count:0, last_played:null}
  ];`);
  const ids = () => Array.from(run('visibleSongs().map(s => s.id)'));
  const select = value => listeners.change.forEach(handler => handler({target:{id:'experience-sort',value,dataset:{}}}));
  const click = key => run(`action('sort-songs', {dataset:{key:${JSON.stringify(key)}}})`);
  return {run, ids, select, click, elements};
}

test('name/version header toggles, numeric text order, and source order is preserved', async () => {
  const a = app();
  const original = a.ids();
  await a.click('name'); assert.deepEqual(a.ids(), ['a','b','c','d','z']);
  assert.match(a.run("songSortHeader('name','曲目名称')"), /aria-sort="ascending"/);
  await a.click('name'); assert.deepEqual(a.ids(), ['z','d','c','b','a']);
  assert.match(a.run("songSortHeader('name','曲目名称')"), /aria-sort="descending"/);
  await a.click('version'); assert.deepEqual(a.ids(), ['b','d','c','a','z']);
  await a.click('version'); assert.deepEqual(a.ids(), ['z','a','c','d','b']);
  assert.deepEqual(Array.from(a.run('state.songs.map(s=>s.id)')), original);
});

test('experience counts are numeric; missing dates stay last in both directions', () => {
  const a = app();
  a.select('played_count:desc'); assert.deepEqual(a.ids(), ['a','c','z','b','d']);
  a.select('played_count:asc'); assert.deepEqual(a.ids(), ['b','d','c','z','a']);
  a.select('last_played:desc'); assert.deepEqual(a.ids(), ['a','c','z','b','d']);
  a.select('last_played:asc'); assert.deepEqual(a.ids(), ['c','z','a','b','d']);
  assert.match(a.run('experienceSortHeader()'), /value="last_played:asc" selected/);
  a.select(''); assert.deepEqual(a.ids(), ['z','a','b','c','d']);
});

test('search and language/status/played filters combine with sorting and handle empty results', () => {
  const a = app();
  a.select('played_count:desc');
  a.run("Object.assign(filters.songs, {language:'日语',status:'可演',played:true})");
  assert.deepEqual(a.ids(), ['c','z']);
  a.run("filters.songs.q='zUL'"); assert.deepEqual(a.ids(), ['z']);
  a.run("filters.songs.q='missing'"); assert.deepEqual(a.ids(), []);
  a.run("filters.songs.q=''; view='upcoming'; view='songs'");
  assert.deepEqual(a.ids(), ['c','z']);
  assert.equal(a.run('songSort.key'), 'played_count');
});
