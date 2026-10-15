import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../src/worker.js';
import {Store} from '../src/store.js';
import {database,song,event} from './helpers.js';
const origin='https://band.example';
const secrets={PLATFORM_PASSWORD:'test-platform-key-26.',AUTH_SECRET:'test-private-pepper-26.',ADMIN_PASSWORD:'test-shared-26.',VIEWER_PASSWORD:'test-shared-26.'};
function environment() {
  return {...secrets,DB:database(),ASSETS:{async fetch(request) {
    const name=new URL(request.url).pathname.slice(1);
    try {return new Response(await readFile(new URL('../static/'+name,import.meta.url)));}
    catch {return new Response('missing',{status:404});}
  }}};
}
function call(env,path,{data,cookie,headers={},method}={}) {
  return worker.fetch(new Request(origin+path,{method:method || (data===undefined?'GET':'POST'),headers:{...(data===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-App-Token':'setroom-web'}),...(cookie?{Cookie:cookie}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
}
async function signIn(env,role='admin') {
  const response=await call(env,'/api/login',{data:{role,password:role==='admin'?env.ADMIN_PASSWORD:env.VIEWER_PASSWORD}});
  assert.equal(response.status,200); return response.headers.get('Set-Cookie').split(';')[0];
}
test('authentication fails closed; signed sessions resist tampering and password rotation', async () => {
  const env=environment();
  assert.equal((await call({...env,PLATFORM_PASSWORD:undefined},'/')).status,503);
  assert.equal((await call(env,'/')).headers.get('Location'),'/login');
  assert.equal((await call(env,'/api/state')).status,401);
  for(const path of ['/index.html','/login.html','/../src/worker.js']) assert.notEqual((await call(env,path)).status,200);
  for(const password of ['','wrong']) assert.equal((await call(env,'/api/login',{data:{role:'admin',password}})).status,401);
  const cookie=await signIn(env);
  const page=await call(env,'/',{cookie}); assert.equal(page.status,200);
  assert.match(await page.text(),/role-admin/);
  assert.equal((await call(env,'/api/state',{cookie:cookie+'x'})).status,401);
  assert.equal((await call({...env,ADMIN_PASSWORD:'rotated-abcdefghijklmnopqrstuvwxyz'},'/api/state',{cookie})).status,401);
  assert.equal((await call(env,'/api/logout',{cookie,data:{}})).headers.get('Set-Cookie').includes('Max-Age=0'),true);
  assert.equal((await call(env,'/api/logout',{cookie,data:{},headers:{Origin:'https://other.example'}})).status,403);
});
test('member login has admin rights including editing, backup and restore', async () => {
  const env=environment(), store=new Store(env.DB), generation=(await store.read()).meta.generation;
  const first=await store.saveSong({...song('第一首'),generation}), second=await store.saveSong({...song('第二首'),generation});
  const show=await store.savePerformance({...event(first),generation});
  const cookie=await signIn(env,'viewer');
  assert.equal((await call(env,'/api/state',{cookie})).status,200);
  const exported=await (await call(env,'/api/export/songs',{cookie,data:{generation,ids:[second,first]}})).json();
  assert.deepEqual(exported.songs.map(s=>s.id),[second,first]);
  assert.equal((await call(env,'/api/export/performances/'+show,{cookie,data:{generation}})).status,200);
  assert.equal((await call(env,'/api/songs/'+first,{cookie,data:{...song('成员更正'),generation,revision:1}})).status,200);
  const saved=await (await call(env,'/api/backup',{cookie,data:{}})).json();
  assert.equal((await call(env,'/api/restore',{cookie,data:saved,headers:{'X-Data-Generation':generation}})).status,200);
  assert.equal((await call(env,'/api/backup/previous',{cookie,data:{}})).status,200);
  const current=await (await call(env,'/api/state',{cookie})).json();
  assert.equal((await call(env,'/api/performances/'+show+'/delete',{cookie,data:{generation:current.generation,revision:1}})).status,200);
  assert.equal((await call(env,'/api/songs/'+first+'/delete',{cookie,data:{generation:current.generation,revision:2}})).status,200);
});
test('admin API validates payload, handles restore and exported filenames', async () => {
  const env=environment(), cookie=await signIn(env), generation=(await (await call(env,'/api/state',{cookie})).json()).generation;
  assert.equal((await call(env,'/api/songs',{cookie,data:{...song(),generation},headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await call(env,'/api/songs',{cookie,data:[]})).status,400);
  const created=await call(env,'/api/songs',{cookie,data:{...song(),generation}}); assert.equal(created.status,200);
  const backup=await call(env,'/api/backup',{cookie,data:{}});
  assert.match(backup.headers.get('Content-Disposition'),/\.json$/);
  const restored=await call(env,'/api/restore',{cookie,data:await backup.json(),headers:{'X-Data-Generation':generation}});
  assert.equal(restored.status,200);
  assert.equal((await call(env,'/api/backup/previous',{cookie,data:{}})).status,200);
});

test('wishlist API supports all member edits and rejects anonymous mutations',async()=>{
 const env=environment(),admin=await signIn(env),viewer=await signIn(env,'viewer');
 const state=await (await call(env,'/api/state',{cookie:admin})).json();
 const data={name:'愿望API',version:'原版',languages:['全语种'],initiator:'wei',supporters:['ko','mu'],generation:state.generation};
 const created=await call(env,'/api/wishlist',{cookie:admin,data});assert.equal(created.status,200);
 const {id}=await created.json();
 for(const path of ['/api/wishlist','/api/wishlist/'+id,'/api/wishlist/'+id+'/delete'])assert.equal((await call(env,path,{data:{...data,revision:1}})).status,401);
 const exported=await (await call(env,'/api/export/wishlist',{cookie:viewer,data:{generation:state.generation,ids:[id]}})).json();
 assert.equal(exported.kind,'wishlist');assert.equal(exported.songs[0].initiator,'wei');assert.equal(exported.members[3].label,'🎹伟');
 assert.equal((await call(env,'/api/wishlist/'+id,{cookie:viewer,data:{...data,revision:1,supporters:[]}})).status,200);
 assert.equal((await call(env,'/api/wishlist/'+id+'/delete',{cookie:viewer,data:{...data,revision:2}})).status,200);
});

test('all logged-in members can move wishes; anonymous and repeated requests fail',async()=>{
 const env=environment(),admin=await signIn(env),viewer=await signIn(env,'viewer');
 const {generation}=await (await call(env,'/api/state',{cookie:admin})).json();
 const data={name:'待排愿望',version:'原版',languages:['全语种'],initiator:'mu',supporters:[],generation};
 const {id}=await (await call(env,'/api/wishlist',{cookie:admin,data})).json();
 const path='/api/wishlist/'+id+'/move-to-songs',payload={generation,revision:1};
 assert.equal((await call(env,path,{data:payload})).status,401);
 const moved=await call(env,path,{cookie:viewer,data:payload});assert.equal(moved.status,200);
 const state=await (await call(env,'/api/state',{cookie:viewer})).json();
 assert.equal(state.wishlist.length,0);assert.equal(state.songs[0].status,'大饼');
 assert.equal((await call(env,path,{cookie:admin,data:payload})).status,409);
});

test('shared login needs no identity selection and accepts the shorter configured password',async()=>{
 const env=environment();
 const response=await call(env,'/api/login',{data:{password:env.ADMIN_PASSWORD}});assert.equal(response.status,200);
 const cookie=response.headers.get('Set-Cookie').split(';')[0];
 assert.match(await (await call(env,'/',{cookie})).text(),/role-admin/);
 const page=await (await call(env,'/login')).text();assert.doesNotMatch(page,/name="role"/);
 assert.equal((await call(env,'/api/login',{data:{role:'unknown',password:env.ADMIN_PASSWORD}})).status,401);
});
