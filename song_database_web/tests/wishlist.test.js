import test from 'node:test';
import assert from 'node:assert/strict';
import {Store,MEMBERS,stateOf,backupOf,validateBackup} from '../src/store.js';
import {database} from './helpers.js';
import {makeExcel} from '../static/excel.js';
import {unzipSync,strFromU8} from 'fflate';
const wish={name:'想排的歌',version:'Acoustic',languages:['仅日语'],initiator:'ko',supporters:['qian','mu','mu','cat']};
test('fixed members, unique support, revision conflicts and wish removal leave repertoire alone',async()=>{
 const store=new Store(database()),generation=(await store.read()).meta.generation;
 assert.deepEqual(MEMBERS.map(m=>m.label),['🎸ko','🎸mu','🎤🐱','🎹伟','🥁钱']);
 const id=await store.saveWish({...wish,generation});
 let state=stateOf(await store.read());
 assert.equal(state.songs.length,0);assert.deepEqual(state.wishlist[0].supporters,['mu','cat','qian']);
 for(const invalid of [{initiator:'other'},{supporters:['other']},{supporters:'mu'},{initiator:''}])await assert.rejects(store.saveWish({...wish,...invalid,generation}),e=>e.status===400);
 await store.saveWish({...wish,supporters:[],generation,revision:1},id);
 await assert.rejects(store.saveWish({...wish,generation,revision:1},id),e=>e.status===409);
 await assert.rejects(store.delete('wishlist',id,{generation,revision:1}),e=>e.status===409);
 state=stateOf(await store.read());assert.deepEqual(state.wishlist[0].supporters,[]);
 await store.delete('wishlist',id,{generation,revision:2});assert.equal((await store.read()).wishlist.length,0);
});
test('wishlist round-trips through backups; old backups preserve wishes and malformed imports do not mutate',async()=>{
 const store=new Store(database()),generation=(await store.read()).meta.generation;
 await store.saveWish({...wish,generation});
 const original=await store.read(),backup=backupOf(original);
 assert.equal(backup.version,4);
 const invalid=structuredClone(backup);invalid.wishlist[0].supporters=['outsider'];
 await assert.rejects(store.restore(invalid,generation));assert.deepEqual(await store.read(),original);
 const old={...backup,version:1};delete old.wishlist;
 await store.restore(old,generation);assert.deepEqual((await store.read()).wishlist,original.wishlist);
 const next=(await store.read()).meta.generation;
 await store.restore({...backup,wishlist:[]},next);assert.equal((await store.read()).wishlist.length,0);
 await store.restore(backup,(await store.read()).meta.generation);
 assert.deepEqual((await store.read()).wishlist,original.wishlist);
 assert.throws(()=>validateBackup({...backup,wishlist:undefined}),/愿望单/);
});
test('wish Excel contains emoji member labels and the requested columns',()=>{
 const {name,bytes}=makeExcel({kind:'wishlist',songs:[wish],members:MEMBERS,scope:'全部曲目'});
 assert.match(name,/乐队愿望单.*xlsx/);
 const xml=strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
 for(const text of ['发起人','我也想排','🎸ko','🎸mu','🎤🐱','🥁钱'])assert.ok(xml.includes(text),text);
 for(const text of ['演出经历','曲目状态'])assert.ok(!xml.includes(text),text);
});

test('moving a wish creates exactly one pending song and rejects stale or repeated moves',async()=>{
 const store=new Store(database()),generation=(await store.read()).meta.generation;
 const id=await store.saveWish({...wish,generation});
 await store.saveWish({...wish,name:'修改后的愿望',generation,revision:1},id);
 await assert.rejects(store.moveWishToSongs(id,{generation,revision:1}),e=>e.status===409);
 assert.equal((await store.read()).songs.length,0);
 const songId=await store.moveWishToSongs(id,{generation,revision:2,status:'可演',name:'不应使用的客户端文字'});
 const state=stateOf(await store.read());
 assert.equal(state.wishlist.length,0);assert.equal(state.songs.length,1);
 const song=state.songs[0];
 assert.equal(song.id,songId);assert.equal(song.name,'修改后的愿望');
 assert.equal(song.status,'大饼');assert.equal(song.version,wish.version);assert.deepEqual(song.languages,wish.languages);
 assert.equal(song.played_count,0);
 await assert.rejects(store.moveWishToSongs(id,{generation,revision:2}),e=>e.status===409);
 assert.equal((await store.read()).songs.length,1);
});
test('failed wish removal rolls back song creation and the write revision',async()=>{
 const db=database(),store=new Store(db),generation=(await store.read()).meta.generation;
 const id=await store.saveWish({...wish,generation}),before=await store.read();
 db.sqlite.exec("CREATE TRIGGER reject_test_delete BEFORE DELETE ON wishlist BEGIN SELECT RAISE(ABORT,'test write failure'); END");
 await assert.rejects(store.moveWishToSongs(id,{generation,revision:1}),/test write failure/);
 assert.deepEqual(await store.read(),before);
});
