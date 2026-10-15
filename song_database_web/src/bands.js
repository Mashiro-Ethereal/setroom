import {AppError,text,uid} from './store.js';
import {digest,hashPassword} from './auth.js';
const stamp=()=>new Date().toISOString();
export const publicBand=band=>({id:band.id,slug:band.slug,name:band.name,wish_mode:band.wish_mode,status:band.status});
export async function rateLimit(env,request,kind,limit,seconds) {
  const now=Math.floor(Date.now()/1000), window=Math.floor(now/seconds);
  const ip=request.headers.get('CF-Connecting-IP') || 'local';
  const bucket=`${kind}:${window}:${await digest(ip)}`;
  const result=await env.DB.batch([
    env.DB.prepare('DELETE FROM request_limits WHERE expires<?').bind(now),
    env.DB.prepare('INSERT INTO request_limits VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket,(window+1)*seconds),
  ]);
  if(result[1].results[0].hits>limit) throw new AppError('操作过于频繁，请稍后再试',429);
}
function fields(data) {
  const slug=text(data.slug,'乐队标识',true,40).toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) || ['admin','api','login','apply','application','platform','new'].includes(slug)) throw new AppError('乐队标识需为 3 至 40 位小写字母、数字或中间的短横线');
  return {slug,name:text(data.name,'乐队名称',true,100),contact_name:text(data.contact_name,'联系人',true,100),contact_info:text(data.contact_info,'联系方式',true,200)};
}
export async function createBand(env,data,approved=false) {
  const f=fields(data);
  if(!approved && (data.consent!==true || data.website)) throw new AppError('请确认网站管理员可以查看和管理本乐队数据');
  const hash=await hashPassword(data.password,env), id=uid(), token=uid()+uid(), created=stamp();
  const statements=[env.DB.prepare("INSERT INTO bands (id,slug,name,status,wish_mode,password_hash,contact_name,contact_info,progress_token,created_at,reviewed_at) VALUES (?,?,?,?,'text',?,?,?,?,?,?)").bind(id,f.slug,f.name,approved?'active':'pending',hash,f.contact_name,f.contact_info,await digest(token),created,approved?created:null)];
  if(approved) statements.push(env.DB.prepare('INSERT INTO app_meta (id,band_id,generation,revision) VALUES (1,?,?,0)').bind(id,uid()));
  try { await env.DB.batch(statements); }
  catch(error) { if(String(error).includes('UNIQUE constraint failed: bands.slug')) throw new AppError('这个乐队标识已被使用或已提交申请，请更换标识或使用原申请进度链接',409); throw error; }
  return approved?{id,slug:f.slug}:{token};
}
export async function applicationStatus(env,data) {
  if(typeof data.token!=='string' || !/^[a-f0-9]{64}$/.test(data.token)) throw new AppError('申请进度链接无效',404);
  const row=await env.DB.prepare('SELECT name,slug,status,review_note,created_at FROM bands WHERE progress_token=?').bind(await digest(data.token)).first();
  if(!row) throw new AppError('申请进度链接无效',404);
  return row;
}
export async function adminBands(env) {
  const result=await env.DB.prepare(`SELECT id,slug,name,status,wish_mode,contact_name,contact_info,review_note,created_at,reviewed_at,auth_version,
    (SELECT count(*) FROM songs WHERE band_id=bands.id) AS song_count,
    (SELECT count(*) FROM performances WHERE band_id=bands.id) AS performance_count,
    (SELECT count(*) FROM wishlist WHERE band_id=bands.id) AS wish_count
    FROM bands ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC,id`).all();
  return {bands:result.results};
}
export async function manageBand(env,id,data) {
  const band=await env.DB.prepare('SELECT * FROM bands WHERE id=?').bind(id).first();
  if(!band) throw new AppError('乐队不存在',404);
  if(data.auth_version!==band.auth_version) throw new AppError('乐队设置已更新，请刷新后重试',409);
  let result;
  if(data.action==='delete') {
    if(data.confirm_name!==band.name) throw new AppError('请输入完整乐队名称以确认删除');
    // Guard every statement: a concurrent settings change must leave all data intact.
    const statements=['setlist_items','performances','songs','wishlist','restore_backup','app_meta'].map(table=>
      env.DB.prepare(`DELETE FROM ${table} WHERE band_id=? AND EXISTS (SELECT 1 FROM bands WHERE id=? AND auth_version=?)`).bind(id,id,band.auth_version));
    statements.push(env.DB.prepare('DELETE FROM bands WHERE id=? AND auth_version=? RETURNING id').bind(id,band.auth_version));
    result=(await env.DB.batch(statements)).at(-1);
  } else if(data.action==='approve' || data.action==='reject') {
    if(band.status!=='pending') throw new AppError('该申请已处理，请刷新列表',409);
    const status=data.action==='approve'?'active':'rejected';
    const statements=[env.DB.prepare("UPDATE bands SET status=?,review_note=?,reviewed_at=?,auth_version=auth_version+1 WHERE id=? AND status='pending' AND auth_version=? RETURNING id").bind(status,text(data.review_note ?? '','审核说明',false,500),stamp(),id,band.auth_version)];
    if(status==='active') statements.push(env.DB.prepare("INSERT INTO app_meta (id,band_id,generation,revision) SELECT 1,id,?,0 FROM bands WHERE id=? AND status='active' ON CONFLICT(band_id,id) DO NOTHING").bind(uid(),id));
    result=(await env.DB.batch(statements))[0];
  } else if(data.action==='reset-key') {
    const hash=await hashPassword(data.password,env);
    result=await env.DB.prepare('UPDATE bands SET password_hash=?,auth_version=auth_version+1 WHERE id=? AND auth_version=? RETURNING id').bind(hash,id,band.auth_version).all();
  } else if(data.action==='settings') {
    if(!['active','disabled'].includes(band.status) || !['active','disabled'].includes(data.status)) throw new AppError('请先处理乐队申请');
    result=await env.DB.prepare('UPDATE bands SET name=?,contact_name=?,contact_info=?,status=?,auth_version=auth_version+1 WHERE id=? AND auth_version=? RETURNING id').bind(text(data.name,'乐队名称',true,100),text(data.contact_name ?? '','联系人',false,100),text(data.contact_info ?? '','联系方式',false,200),data.status,id,band.auth_version).all();
  } else throw new AppError('管理操作不存在',404);
  if(!result.results.length) throw new AppError('乐队设置已更新，请刷新后重试',409);
  return {ok:true};
}
