import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,stateOf,backupOf} from '../src/store.js';
import {database,song,event} from './helpers.js';
async function setup() {
  const db=database(), store=new Store(db), raw=await store.read(), generation=raw.meta.generation;
  const id=await store.saveSong({...song(),generation});
  return {db,store,generation,id};
}
test('archive snapshots, live future songs, repeated songs counted once, and safe deletes', async () => {
  const {store,generation,id}=await setup();
  const historical=await store.savePerformance({...event(id,{status:'已完成',items:[{song_id:id,note:'开场'},{song_id:id,note:'返场'}]}),generation});
  const planned=await store.savePerformance({...event(id),generation});
  await store.saveSong({...song('新名字'),version:'新版本',id,revision:1,generation},id);
  const state=stateOf(await store.read());
  assert.equal(state.songs[0].played_count,1);
  assert.equal(state.songs[0].last_played,'2026-09-01');
  assert.equal(state.performances.find(e=>e.id===historical).items[0].song.name,'测试曲目');
  assert.equal(state.performances.find(e=>e.id===planned).items[0].song.version,'新版本');
  await assert.rejects(store.delete('songs',id,{revision:2,generation}),/已被演出引用/);
  await assert.rejects(store.savePerformance({...event(id),revision:1,generation},historical),/历史演出/);
});
test('record revisions and atomic D1 write guard reject stale edits without partial changes', async () => {
  const {store,generation,id}=await setup();
  const stale=await store.read();
  await store.saveSong({...song('第一窗口'),revision:1,generation},id);
  await assert.rejects(store.saveSong({...song('第二窗口'),revision:1,generation},id),e=>e.status===409);
  await assert.rejects(store.write(stale,[store.statement('DELETE FROM songs')]),e=>e.status===409);
  assert.equal((await store.read()).songs[0].name,'第一窗口');
  const raw=await store.read();
  await assert.rejects(store.write(raw,[store.statement('DELETE FROM songs'),store.statement("INSERT INTO setlist_items (id,performance_id,song_id,position,note,snapshot,band_id) VALUES ('broken','missing','missing',0,'',NULL,'krb')")]));
  assert.deepEqual(await store.read(),raw);
});
test('cancelled songs, invalid dates, empty archives, snapshot corrections and 500-item setlists', async () => {
  const {store,generation,id}=await setup();
  const planned=await store.savePerformance({...event(id),generation});
  await store.saveSong({...song(),status:'取消',revision:1,generation},id);
  await assert.rejects(store.savePerformance({...event(id),generation}),/已取消/);
  const existing=stateOf(await store.read()).performances[0];
  await store.savePerformance({...existing,name:'保留已有取消歌曲',generation},planned);
  await assert.rejects(store.savePerformance({...event(id,{date:'2026-02-30'}),generation}),/有效的演出日期/);
  await assert.rejects(store.savePerformance({...event(id,{status:'已完成',date:'2099-01-01'}),generation}),/未来日期/);
  await assert.rejects(store.savePerformance({...event(id,{status:'已完成',items:[]}),generation}),/歌单/);
  const history=await store.savePerformance({...event(id,{status:'已完成',items:Array.from({length:500},()=>({song_id:id,note:'测试'}))}),generation});
  const archived=stateOf(await store.read()).performances.find(e=>e.id===history);
  archived.items[0].snapshot.name='本场更正';
  await store.savePerformance({...archived,generation},history);
  assert.equal(stateOf(await store.read()).performances.find(e=>e.id===history).items[0].song.name,'本场更正');
  assert.equal((await store.read()).songs[0].name,'测试曲目');
});
test('restore validates references and order, preserves a prior backup, changes generation', async () => {
  const {store,db,generation,id}=await setup();
  await store.savePerformance({...event(id,{status:'已完成'}),generation});
  const original=await store.read(), backup=backupOf(original);
  const invalid=structuredClone(backup); invalid.items[0].song_id='missing';
  await assert.rejects(store.restore(invalid,generation),/关联不完整/);
  assert.deepEqual(await store.read(),original);
  const duplicate=structuredClone(backup); duplicate.items.push({...duplicate.items[0],id:'duplicate'});
  await assert.rejects(store.restore(duplicate,generation),/顺序无效/);
  await store.saveSong({...song('额外曲目'),generation});
  await store.restore(backup,generation);
  const restored=await store.read();
  assert.notEqual(restored.meta.generation,generation);
  assert.deepEqual(restored.songs,original.songs);
  assert.equal(JSON.parse(db.sqlite.prepare('SELECT payload FROM restore_backup').get().payload).songs.length,2);
  await assert.rejects(store.saveSong({...song(),generation}),e=>e.status===409);
});
