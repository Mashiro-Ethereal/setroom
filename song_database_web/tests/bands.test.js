import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../src/worker.js';
import {Store,backupOf,stateOf} from '../src/store.js';
import {createBand,manageBand,publicBand} from '../src/bands.js';
import {database,song,event} from './helpers.js';
import {makeExcel} from '../static/excel.js';
import {unzipSync,strFromU8} from 'fflate';
const origin='https://band.example';
const envOf=()=>({DB:database(),ADMIN_PASSWORD:'test-krb-key-26.',PLATFORM_PASSWORD:'test-platform-key-26.',AUTH_SECRET:'test-pepper-independent-26.',ASSETS:{async fetch(request){try{return new Response(await readFile(new URL('../static/'+new URL(request.url).pathname.slice(1),import.meta.url)));}catch{return new Response('missing',{status:404});}}}});
const application=(slug)=>({slug,name:'朋友 '+slug,contact_name:'小明',contact_info:'微信测试',password:'friend-shared-key-26.',consent:true});
async function call(env,path,{data,cookie,band,ip='1.2.3.4'}={}) {
 return worker.fetch(new Request(origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-App-Token':'setroom-web','CF-Connecting-IP':ip,...(cookie?{Cookie:cookie}:{}),...(band?{'X-Band-ID':band}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
}
async function signIn(env,data) {const r=await call(env,'/api/login',{data});assert.equal(r.status,200,await r.clone().text());return r.headers.get('Set-Cookie').split(';')[0];}
async function friend(env,slug) {const {id}=await createBand(env,application(slug),true);return publicBand(await env.DB.prepare('SELECT * FROM bands WHERE id=?').bind(id).first());}

test('application approval opens an empty text space; private progress and admin API never reveal keys',async()=>{
 const env=envOf(),data=application('friend-one');
 const response=await call(env,'/api/apply',{data});assert.equal(response.status,200);
 const {token}=await response.json();assert.match(token,/^[a-f0-9]{64}$/);
 const row=await env.DB.prepare('SELECT * FROM bands WHERE slug=?').bind(data.slug).first();
 assert.notEqual(row.password_hash,data.password);assert.match(row.password_hash,/^pbkdf2:/);assert.notEqual(row.progress_token,token);
 assert.equal((await call(env,'/api/login',{data})).status,401);
 assert.equal((await call(env,'/api/admin/bands')).status,401);
 assert.equal((await call(env,'/api/application',{data:{token:'0'.repeat(64)}})).status,404);
 const pending=await (await call(env,'/api/application',{data:{token}})).json();assert.equal(pending.status,'pending');assert.equal(pending.contact_info,undefined);
 assert.equal((await call(env,'/api/apply',{data})).status,409);
 const admin=await signIn(env,{kind:'platform',password:env.PLATFORM_PASSWORD});
 const listing=await (await call(env,'/api/admin/bands',{cookie:admin})).text();assert.ok(!listing.includes(row.password_hash));assert.ok(!listing.includes(data.password));assert.ok(!listing.includes(row.progress_token));
 assert.equal((await call(env,'/api/admin/bands/'+row.id,{cookie:admin,data:{action:'approve',auth_version:1,review_note:'欢迎'}})).status,200);
 assert.equal((await call(env,'/api/admin/bands/'+row.id,{cookie:admin,data:{action:'approve',auth_version:1}})).status,409);
 const approved=await (await call(env,'/api/application',{data:{token}})).json();assert.equal(approved.status,'active');assert.equal(approved.review_note,'欢迎');
 const cookie=await signIn(env,data),state=await (await call(env,'/api/state',{cookie})).json();
 assert.equal(state.band.wish_mode,'text');assert.deepEqual(state.members,[]);assert.deepEqual(state.songs,[]);
 assert.equal((await call(env,'/api/admin/bands',{cookie})).status,403);
 assert.equal((await call(env,'/login?admin=1',{cookie})).status,200);
 assert.equal((await call(env,'/login?band=krb',{cookie})).status,200);
});

test('band sessions cannot cross spaces; platform can enter each without their password',async()=>{
 const env=envOf(),a=await friend(env,'friend-a'),b=await friend(env,'friend-b');
 const sa=new Store(env.DB,a),sb=new Store(env.DB,b),ga=(await sa.read()).meta.generation,gb=(await sb.read()).meta.generation;
 const bid=await sb.saveSong({...song('B 的私密歌曲'),generation:gb});await sb.savePerformance({...event(bid),generation:gb});
 const ac=await signIn(env,application(a.slug));
 assert.equal((await call(env,'/api/state',{cookie:ac,band:b.id})).status,403);
 assert.equal((await call(env,'/b/'+b.slug,{cookie:ac})).status,403);
 assert.equal((await call(env,'/api/songs/'+bid,{cookie:ac,data:{...song('越权'),generation:ga,revision:1,band_id:b.id}})).status,409);
 assert.equal((await call(env,'/api/export/songs',{cookie:ac,data:{generation:ga,ids:[bid]}})).status,409);
 assert.equal((await call(env,'/api/performances',{cookie:ac,data:{...event(bid),generation:ga}})).status,400);
 await env.DB.prepare('INSERT INTO restore_backup(id,band_id,created_at,payload) VALUES (1,?,?,?)').bind(b.id,new Date().toISOString(),JSON.stringify(backupOf(await sb.read()))).all();
 const previous=await call(env,'/api/backup/previous',{cookie:ac,data:{}});assert.equal(previous.status,400);assert.match(await previous.text(),/还没有恢复前的备份/);
 assert.equal((await call(env,'/api/restore',{cookie:ac,data:backupOf(await sb.read())})).status,400);
 const admin=await signIn(env,{kind:'platform',password:env.PLATFORM_PASSWORD});
 for(const band of [a,b]) {assert.equal((await call(env,'/b/'+band.slug,{cookie:admin})).status,200);const state=await (await call(env,'/api/state',{cookie:admin,band:band.id})).json();assert.equal(state.band.id,band.id);}
 const response=await call(env,'/api/songs/'+bid,{cookie:admin,band:b.id,data:{...song('管理员修正'),generation:gb,revision:1}});assert.equal(response.status,200);
 assert.equal((await sb.read()).songs[0].name,'管理员修正');assert.equal((await sa.read()).songs.length,0);
 // Composite foreign keys enforce ownership even below API validation.
 const aid=await sa.saveSong({...song('A 曲目'),generation:ga}),aeid=await sa.savePerformance({...event(aid),generation:ga});
 assert.throws(()=>env.DB.sqlite.prepare('INSERT INTO setlist_items(id,band_id,performance_id,song_id,position,note) VALUES (?,?,?,?,1,?)').run('bad',a.id,aeid,bid,''),/FOREIGN KEY/);
});

test('identical record IDs remain independent through edits, deletion, restore and concurrency',async()=>{
 const env=envOf(),a=await friend(env,'space-a'),b=await friend(env,'space-b'),sa=new Store(env.DB,a),sb=new Store(env.DB,b);
 const ga=(await sa.read()).meta.generation,gb=(await sb.read()).meta.generation;
 await sa.saveSong({...song('原曲'),generation:ga});const ba=backupOf(await sa.read()),bb={...structuredClone(ba),band:{id:b.id,wish_mode:'text'}};
 await sb.restore(bb,gb);const id=ba.songs[0].id,rawB=await sb.read(),staleA=await sa.read();
 await sb.saveSong({...song('B 改名'),generation:rawB.meta.generation,revision:1},id);
 await sa.saveSong({...song('A 改名'),generation:ga,revision:1},id);
 assert.equal((await sb.read()).songs[0].name,'B 改名');
 await assert.rejects(sa.write(staleA,[]),e=>e.status===409);
 const beforeB=await sb.read();await sa.restore(ba,ga);assert.deepEqual(await sb.read(),beforeB);
 assert.equal(JSON.parse((await env.DB.prepare('SELECT payload FROM restore_backup WHERE band_id=?').bind(a.id).first()).payload).songs[0].name,'A 改名');
 const current=await sa.read();await sa.delete('songs',id,{generation:current.meta.generation,revision:1});assert.deepEqual(await sb.read(),beforeB);
});

test('text wishes preserve free-form names and emoji through edits, Excel, restore and moving',async()=>{
 const env=envOf(),band=await friend(env,'text-band'),store=new Store(env.DB,band),generation=(await store.read()).meta.generation;
 const data={...song(),initiator:'🎸小明',supporters:'阿白、🥁小林\n🎤猫',generation};
 const id=await store.saveWish(data),backup=backupOf(await store.read());assert.equal(backup.wishlist[0].supporters,data.supporters);
 await store.saveWish({...data,supporters:'',revision:1},id);await store.restore(backup,generation);
 const raw=await store.read(),state=stateOf(raw);assert.equal(state.wishlist[0].supporters,data.supporters);
 const xml=strFromU8(unzipSync(makeExcel({kind:'wishlist',songs:state.wishlist,members:state.members,scope:'全部'}).bytes)['xl/worksheets/sheet1.xml']);
 assert.ok(xml.includes(data.initiator));assert.ok(xml.includes(data.supporters));
 await assert.rejects(store.saveWish({...data,generation:raw.meta.generation,supporters:['ko']}),/需要填写文字/);
 await store.moveWishToSongs(id,{generation:raw.meta.generation,revision:1});const moved=await store.read();assert.equal(moved.wishlist.length,0);assert.equal(moved.songs[0].status,'大饼');
});

test('reset and disable revoke sessions; platform key rotation does not lose band password verifiers',async()=>{
 const env=envOf(),band=await friend(env,'reset-band'),data=application(band.slug);
 const cookie=await signIn(env,data);
 await manageBand(env,band.id,{action:'reset-key',auth_version:1,password:'new-band-key-26.'});
 assert.equal((await call(env,'/api/state',{cookie})).status,401);assert.equal((await call(env,'/api/login',{data})).status,401);
 data.password='new-band-key-26.';const next=await signIn(env,data);
 const rotated={...env,PLATFORM_PASSWORD:'changed-platform-key-26.'};await signIn(rotated,data);
 await manageBand(env,band.id,{action:'settings',auth_version:2,status:'disabled',name:'已停用',contact_name:'',contact_info:''});
 assert.equal((await call(env,'/api/state',{cookie:next})).status,401);assert.equal((await call(env,'/api/login',{data})).status,401);
 await manageBand(env,band.id,{action:'settings',auth_version:3,status:'active',name:'重新启用',contact_name:'',contact_info:''});await signIn(env,data);
});

test('rejected applications remain closed, unconsented submissions fail and application bursts are limited',async()=>{
 const env=envOf(),data=application('rejected-band');
 assert.equal((await call(env,'/api/apply',{data:{...data,consent:false}})).status,400);
 const {token}=await (await call(env,'/api/apply',{data})).json();
 const row=await env.DB.prepare('SELECT * FROM bands WHERE slug=?').bind(data.slug).first();
 await manageBand(env,row.id,{action:'reject',auth_version:1,review_note:'请补充资料'});
 assert.equal((await call(env,'/api/login',{data})).status,401);
 assert.equal((await (await call(env,'/api/application',{data:{token}})).json()).status,'rejected');
 await call(env,'/api/apply',{data:application('third-band')});
 assert.equal((await call(env,'/api/apply',{data:application('fourth-band')})).status,429);
});

test('simple and long keys work for applications, resets and platform login',async()=>{
 const env=envOf();
 for(const [index,password] of ['1','猫','🎸','x'.repeat(250)].entries()) {
  const data={...application('simple-'+index),password};
  const {token}=await createBand(env,data);
  const band=await env.DB.prepare('SELECT * FROM bands WHERE slug=?').bind(data.slug).first();
  await manageBand(env,band.id,{action:'approve',auth_version:1});
  const cookie=await signIn(env,data);assert.equal((await call(env,'/api/state',{cookie})).status,200);
  await manageBand(env,band.id,{action:'reset-key',auth_version:2,password:'2'});
  await signIn(env,{slug:data.slug,password:'2'});
  assert.equal((await call(env,'/api/state',{cookie})).status,401);
  assert.equal((await (await call(env,'/api/application',{data:{token}})).json()).status,'active');
 }
 await assert.rejects(createBand(env,{...application('empty-key'),password:''}),/请填写 Key/);
 const admin=await signIn(env,{kind:'platform',password:env.PLATFORM_PASSWORD});
 const rotated={...env,PLATFORM_PASSWORD:'short-key'};
 assert.equal((await call(rotated,'/api/admin/bands',{cookie:admin})).status,401);
 await signIn(rotated,{kind:'platform',password:rotated.PLATFORM_PASSWORD});
 assert.equal((await call(rotated,'/api/login',{data:{kind:'platform',password:env.PLATFORM_PASSWORD}})).status,401);
});

async function deletionFixture() {
 const env=envOf(),band=await friend(env,'delete-target'),other=await friend(env,'keep-band');
 const store=new Store(env.DB,band),keep=new Store(env.DB,other),generation=(await store.read()).meta.generation;
 const id=await store.saveSong({...song('要删除的曲目'),generation});
 await store.savePerformance({...event(id),generation});
 await store.saveWish({...song(),initiator:'小明',supporters:'小林',generation});
 await store.restore(backupOf(await store.read()),generation);
 await keep.saveSong({...song('其他乐队的曲目'),generation:(await keep.read()).meta.generation});
 return {env,band,store,keep};
}

test('only platform admin can delete a band; confirmation protects all data and other bands survive',async()=>{
 const {env,band,store,keep}=await deletionFixture(),before=await store.read(),otherBefore=await keep.read();
 const member=await signIn(env,application(band.slug)),admin=await signIn(env,{kind:'platform',password:env.PLATFORM_PASSWORD});
 const path='/api/admin/bands/'+band.id,data={action:'delete',auth_version:1,confirm_name:band.name};
 assert.equal((await call(env,path,{cookie:member,data})).status,403);
 assert.equal((await call(env,path,{cookie:admin,data:{...data,confirm_name:'wrong'}})).status,400);
 assert.deepEqual(await store.read(),before);
 assert.equal((await call(env,path,{cookie:admin,data})).status,200);
 for(const table of ['songs','performances','setlist_items','wishlist','restore_backup','app_meta'])
  assert.equal((await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE band_id=?`).bind(band.id).first()).n,0,table);
 assert.equal(await env.DB.prepare('SELECT * FROM bands WHERE id=?').bind(band.id).first(),null);
 assert.deepEqual(await keep.read(),otherBefore);
 assert.equal((await call(env,'/api/state',{cookie:member})).status,401);
 assert.equal((await call(env,path,{cookie:admin,data})).status,404);
 const replacement=await friend(env,band.slug);assert.notEqual(replacement.id,band.id);
 assert.equal((await call(env,'/api/state',{cookie:member})).status,401);
});

test('deletion rolls back on failure and stale settings cannot partially delete a band',async()=>{
 const {env,band,store}=await deletionFixture(),before=await store.read();
 env.DB.sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON bands BEGIN SELECT RAISE(ABORT,'test deletion failure'); END");
 await assert.rejects(manageBand(env,band.id,{action:'delete',auth_version:1,confirm_name:band.name}),/test deletion failure/);
 assert.deepEqual(await store.read(),before);
 assert.ok(await env.DB.prepare('SELECT payload FROM restore_backup WHERE band_id=?').bind(band.id).first());
 env.DB.sqlite.exec('DROP TRIGGER fail_delete');
 const batch=env.DB.batch.bind(env.DB);
 env.DB.batch=async statements=>{
  env.DB.sqlite.prepare('UPDATE bands SET auth_version=auth_version+1 WHERE id=?').run(band.id);
  env.DB.batch=batch;return batch(statements);
 };
 await assert.rejects(manageBand(env,band.id,{action:'delete',auth_version:1,confirm_name:band.name}),e=>e.status===409);
 assert.deepEqual(await store.read(),before);
 assert.ok(await env.DB.prepare('SELECT payload FROM restore_backup WHERE band_id=?').bind(band.id).first());
});
