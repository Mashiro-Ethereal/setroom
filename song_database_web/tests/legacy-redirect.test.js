import test from 'node:test';
import assert from 'node:assert/strict';
import redirect from '../src/legacy-redirect.js';
test('old website redirects navigation while rejecting stale API reads and writes',async()=>{
 const origin='https://band-library-test.xiuhuizhang1004.workers.dev';
 for(const method of ['GET','HEAD']){
  const r=redirect.fetch(new Request(origin+'/login?next=songs',{method}));
  assert.equal(r.status,302);assert.equal(r.headers.get('Location'),'https://krb.xiuhuizhang1004.workers.dev/login?next=songs');
 }
 for(const method of ['GET','POST']){
  const r=redirect.fetch(new Request(origin+'/api/songs',{method}));
  assert.equal(r.status,410);assert.match((await r.json()).error,/刷新页面/);assert.equal(r.headers.get('Location'),null);
 }
});
