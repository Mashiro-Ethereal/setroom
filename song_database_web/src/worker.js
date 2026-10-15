import { AppError, Store, stateOf, backupOf, object } from './store.js';
import { requireConfigured, login, session, logoutCookie } from './auth.js';
import { publicBand,rateLimit,createBand,applicationStatus,adminBands,manageBand } from './bands.js';

const security = {
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function reply(data,status=200,headers={}) {
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...security,...headers}});
}
function redirect(path) { return new Response(null,{status:303,headers:{...security,Location:path}}); }
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new AppError('请求格式应为 JSON',415);
  const max = 2 * 1024 * 1024;
  if (Number(request.headers.get('Content-Length')) > max) throw new AppError('文件不能超过 2 MB',413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('请求内容为空');
  const chunks = []; let size = 0;
  while (true) {
    const {value,done} = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new AppError('文件不能超过 2 MB',413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  try { return object(JSON.parse(new TextDecoder().decode(bytes))); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError('无法读取 JSON 文件'); }
}
const assets = new Set(['/app.js','/style.css','/favicon.svg','/login.js','/portal.js','/admin.js','/excel.js','/excel-styles.js','/vendor/fflate.js']);

export default {
  async fetch(request,env) {
    const url = new URL(request.url), path = url.pathname;
    try {
      if (!['GET','POST'].includes(request.method)) return reply({error:'请求方法无效'},405);
      if (request.method === 'POST' && (request.headers.get('Origin') !== url.origin || request.headers.get('X-App-Token') !== 'setroom-web')) throw new AppError('请求来源无效',403);
      if (request.method === 'GET' && assets.has(path)) {
        const response = await env.ASSETS.fetch(request);
        return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...security}});
      }
      requireConfigured(env);
      if (!env.DB) throw new AppError('数据库尚未绑定',503);
      const htmlPage = async (file, replacements={}) => {
        const response=await env.ASSETS.fetch(new Request(new URL(file,url)));
        let html=await response.text();
        for(const [key,value] of Object.entries(replacements)) html=html.replaceAll(key,String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
        return new Response(html,{headers:{...security,'Content-Type':'text/html; charset=utf-8'}});
      };
      if (request.method==='GET' && ['/apply','/application'].includes(path)) return htmlPage('/portal.html');
      if (request.method==='POST' && path==='/api/apply') {
        await rateLimit(env,request,'apply',3,3600);
        return reply(await createBand(env,await body(request)));
      }
      if (request.method==='POST' && path==='/api/application') {
        await rateLimit(env,request,'progress',60,900);
        return reply(await applicationStatus(env,await body(request)));
      }
      const user = await session(request,env);
      if (request.method === 'GET' && path === '/login') {
        const wantsPlatform=url.searchParams.get('admin')==='1', requestedSlug=url.searchParams.get('band');
        if(user && wantsPlatform && user.role==='platform') return redirect('/admin');
        if(user && !wantsPlatform && user.role==='admin' && (!requestedSlug || requestedSlug===user.band.slug)) return redirect(`/b/${user.band.slug}`);
        if(user && !wantsPlatform && user.role==='platform' && !requestedSlug) return redirect('/admin');
        const response = await env.ASSETS.fetch(new Request(new URL('/login.html',url)));
        return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...security}});
      }
      if (request.method === 'POST' && path === '/api/login') {
        await rateLimit(env,request,'login',30,900);
        const result=await login(env,await body(request));
        return reply({ok:true,redirect:result.redirect},200,{'Set-Cookie':result.cookie});
      }
      if (!user) {
        if (request.method === 'GET' && (path === '/' || path==='/admin' || /^\/b\/[a-z0-9-]+$/.test(path))) return redirect('/login'+(path==='/admin'?'?admin=1':path.startsWith('/b/')?'?band='+encodeURIComponent(path.slice(3)):''));
        throw new AppError('登录已过期，请在新标签页打开本网站并重新登录，再回到这里保存。',401);
      }
      if (request.method === 'POST' && path === '/api/logout') return reply({ok:true},200,{'Set-Cookie':logoutCookie()});
      if (path==='/admin' || path.startsWith('/api/admin/')) {
        if(user.role!=='platform') throw new AppError('此入口仅限网站管理员',403);
        if(path==='/admin' && request.method==='GET') return htmlPage('/admin.html');
        if(path==='/api/admin/bands' && request.method==='GET') return reply(await adminBands(env));
        if(path==='/api/admin/bands' && request.method==='POST') return reply(await createBand(env,await body(request),true));
        const management=path.match(/^\/api\/admin\/bands\/([a-zA-Z0-9_-]+)$/);
        if(management && request.method==='POST') return reply(await manageBand(env,management[1],await body(request)));
        throw new AppError('管理操作不存在',404);
      }
      const bandPage=path.match(/^\/b\/([a-z0-9-]+)$/);
      let band=user.band;
      const requested=request.headers.get('X-Band-ID');
      if (bandPage) band=await env.DB.prepare('SELECT * FROM bands WHERE slug=?').bind(bandPage[1]).first();
      else if (user.role==='platform' && requested) band=await env.DB.prepare('SELECT * FROM bands WHERE id=?').bind(requested).first();
      if (path==='/' && user.role==='platform') return redirect('/admin');
      if(!band || !['active','disabled'].includes(band.status)) throw new AppError('请选择已开通的乐队空间',403);
      if(user.role!=='platform' && (band.id!==user.band_id || requested && requested!==user.band_id)) throw new AppError('无法访问其他乐队的数据',403);
      if ((path==='/' || bandPage) && request.method==='GET') {
        return htmlPage('/index.html',{'__APP_TOKEN__':'setroom-web','__USER_ROLE__':'admin','__BAND_ID__':band.id,'__BAND_NAME__':band.name,'__PLATFORM__':user.role==='platform'?'yes':'no'});
      }
      const store = new Store(env.DB,publicBand(band));
      if (path === '/api/state' && request.method === 'GET') return reply(stateOf(await store.read()));
      if (request.method !== 'POST') throw new AppError('页面不存在',404);
      const data = await body(request);
      if (path === '/api/export/wishlist' || path === '/api/export/songs' || /^\/api\/export\/performances\/[a-zA-Z0-9_-]+$/.test(path)) {
        const raw = await store.read(); store.check(raw,data); const state = stateOf(raw);
        if (path === '/api/export/wishlist' || path === '/api/export/songs') {
          const wishes = path === '/api/export/wishlist';
          let songs = wishes ? state.wishlist : state.songs;
          if (data.ids != null) {
            if (!Array.isArray(data.ids) || !data.ids.every(id=>typeof id==='string') || new Set(data.ids).size !== data.ids.length) throw new AppError('导出范围无效');
            const byId = new Map(songs.map(s=>[s.id,s])); songs = data.ids.map(id=>byId.get(id));
            if (songs.some(s=>!s)) throw new AppError('曲库已更新，请刷新后重新导出',409);
          }
          return reply({kind:wishes?'wishlist':'songs',songs,members:state.members,scope:data.ids == null ? '全部曲目' : '当前筛选结果'});
        }
        const event = state.performances.find(e=>e.id === path.split('/').at(-1));
        if (!event) throw new AppError('演出不存在，请刷新页面',409);
        return reply({kind:'performance',event});
      }
      if (!['admin','platform'].includes(user.role)) throw new AppError('成员账号只能查看和导出，修改数据需要管理员登录。',403);
      if (path === '/api/backup') {
        const payload = backupOf(await store.read());
        return reply(payload,200,{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent('乐队曲库备份_'+payload.exported_at.slice(0,10)+'.json')}`});
      }
      if (path === '/api/backup/previous') {
        const saved = await env.DB.prepare('SELECT payload FROM restore_backup WHERE id=1 AND band_id=?').bind(band.id).first();
        if (!saved) throw new AppError('还没有恢复前的备份');
        return reply(JSON.parse(saved.payload),200,{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent('恢复前备份.json')}`});
      }
      if (path === '/api/restore') { await store.restore(data,request.headers.get('X-Data-Generation')); return reply({ok:true}); }
      const move = path.match(/^\/api\/wishlist\/([a-zA-Z0-9_-]+)\/move-to-songs$/);
      if (move) return reply({id:await store.moveWishToSongs(move[1],data)});
      const match = path.match(/^\/api\/(songs|performances|wishlist)(?:\/([a-zA-Z0-9_-]+)(\/delete)?)?$/);
      if (match) {
        const [,kind,id,deletion] = match;
        if (deletion) { await store.delete(kind,id,data); return reply({ok:true}); }
        return reply({id:kind === 'wishlist' ? await store.saveWish(data,id) : kind === 'songs' ? await store.saveSong(data,id) : await store.savePerformance(data,id)});
      }
      throw new AppError('操作不存在',404);
    } catch (error) {
      if (error instanceof AppError) return reply({error:error.message},error.status);
      console.error('Setroom request failed:',path,error.message);
      return reply({error:'操作未完成，请稍后重试；若首次部署，请检查数据库迁移是否完成。'},500);
    }
  },
};
