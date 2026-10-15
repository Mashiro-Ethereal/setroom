import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Store,backupOf,validateBackup} from '../src/store.js';
import {database,song,event} from './helpers.js';
test('songs, wishes, performances and corrected snapshots accept exactly one language category',async()=>{
 const store=new Store(database()),generation=(await store.read()).meta.generation;
 const id=await store.saveSong({...song(),generation});
 const eid=await store.savePerformance({...event(id,{status:'已完成'}),generation});
 for(const languages of [[],['日语'],['中文'],['仅日语','全语种'],['unknown']]){
  await assert.rejects(store.saveSong({...song(),languages,generation}),/仅日语/);
  await assert.rejects(store.saveWish({...song(),languages,initiator:'ko',supporters:[],generation}),/仅日语/);
  await assert.rejects(store.savePerformance({...event(id),languages,generation}),/仅日语/);
 }
 const raw=await store.read(),archived=raw.performances.find(e=>e.id===eid);
 await assert.rejects(store.savePerformance({...archived,generation,items:[{...raw.items[0],snapshot:{...raw.items[0].snapshot,languages:['日语']}}]},eid),/仅日语/);
});
test('language migration preserves other fields and invalidates old editors; old backups convert identically',async()=>{
 const db=database({demo:true}),store=new Store(db);
 db.sqlite.exec(`UPDATE performances SET languages='["未注明"]' WHERE id='demo-past'; UPDATE setlist_items SET snapshot=json_set(snapshot,'$.languages',json('["未注明"]')) WHERE id='demo-item-1'`);
 const before=await store.read(),old={...backupOf(before),version:2};
 const converted=validateBackup(old);
 assert.deepEqual(converted.songs.find(s=>s.id==='demo-song-2').languages,['全语种']);
 assert.deepEqual(converted.performances.find(e=>e.id==='demo-past').languages,['仅日语']);
 db.sqlite.exec(readFileSync(new URL('../migrations/0004_language_categories.sql',import.meta.url),'utf8'));
 const after=await store.read();assert.notEqual(after.meta.generation,before.meta.generation);
 for(const key of ['songs','performances','wishlist']){
  for(const row of after[key])assert.deepEqual(row,{...converted[key].find(r=>r.id===row.id),revision:before[key].find(r=>r.id===row.id).revision+1});
 }
 assert.deepEqual(after.items,converted.items);
 const newBackup=backupOf(after);assert.equal(newBackup.version,4);
 assert.deepEqual(validateBackup(newBackup).songs,after.songs);
 const invalid=structuredClone(newBackup);invalid.songs[0].languages=['中文'];assert.throws(()=>validateBackup(invalid),/仅日语/);
 const unknown=structuredClone(old);unknown.songs[0].languages=['不认识的语言'];assert.throws(()=>validateBackup(unknown),/无法识别/);
});
