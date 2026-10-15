import { AppError } from './store.js';
const encoder = new TextEncoder(), cookieName = '__Host-setroom', lifetime = 12 * 60 * 60;
const configured = secret => typeof secret === 'string' && secret.length > 0;
const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unbase64 = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const key = secret => crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
export async function digest(value) { return base64(await crypto.subtle.digest('SHA-256',encoder.encode(value))); }
export function requireConfigured(env) {
  if (!configured(env.PLATFORM_PASSWORD) || !configured(env.AUTH_SECRET) || env.AUTH_SECRET.length < 12) throw new AppError('网站管理员尚未设置登录口令，请完成部署配置。',503);
}
async function sameSecret(a,b) {
  if (!configured(a) || typeof b !== 'string' || !b.length) return false;
  const mac=await crypto.subtle.sign('HMAC',await key(a),encoder.encode('setroom-login'));
  return crypto.subtle.verify('HMAC',await key(b),mac,encoder.encode('setroom-login'));
}
export async function hashPassword(password,env,salt=crypto.getRandomValues(new Uint8Array(16))) {
  if (!configured(password)) throw new AppError('请填写 Key');
  // A server-side pepper protects password verifiers if a database backup is exposed.
  const peppered=await crypto.subtle.sign('HMAC',await key(env.AUTH_SECRET),encoder.encode(password));
  const material=await crypto.subtle.importKey('raw',peppered,'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},material,256);
  return `pbkdf2:100000:${base64(salt)}:${base64(bits)}`;
}
async function verifyPassword(password,hash,env) {
  try {
    const [algorithm,iterations,salt]=hash.split(':');
    if (algorithm!=='pbkdf2' || iterations!=='100000') return false;
    return sameSecret(hash,await hashPassword(password,env,unbase64(salt)));
  } catch { return false; }
}
function sessionSecret(env,band) { return band ? `${env.AUTH_SECRET}:${band.password_hash || env.ADMIN_PASSWORD}` : `${env.AUTH_SECRET}:${env.PLATFORM_PASSWORD}`; }
export async function login(env,data) {
  requireConfigured(env);
  if (data.role !== undefined && !['admin','viewer'].includes(data.role)) throw new AppError('口令不正确',401);
  let band=null;
  if (data.kind === 'platform') {
    if (!await sameSecret(env.PLATFORM_PASSWORD,data.password)) throw new AppError('口令不正确',401);
  } else {
    const slug=typeof data.slug==='string'?data.slug.trim().toLowerCase():'krb';
    band=await env.DB.prepare('SELECT * FROM bands WHERE slug=?').bind(slug).first();
    const valid=band?.status==='active' && (band.password_hash ? await verifyPassword(data.password,band.password_hash,env) : band.id==='krb' && await sameSecret(env.ADMIN_PASSWORD,data.password));
    if (!valid) throw new AppError('乐队标识或 Key 不正确，或乐队尚未获批 / 已停用',401);
  }
  const identity=band?{role:'admin',band_id:band.id,auth_version:band.auth_version}:{role:'platform'};
  const payload=base64(encoder.encode(JSON.stringify({...identity,expires:Math.floor(Date.now()/1000)+lifetime,nonce:crypto.randomUUID()})));
  const mac=base64(await crypto.subtle.sign('HMAC',await key(sessionSecret(env,band)),encoder.encode(`setroom-v2:${payload}`)));
  return {cookie:`${cookieName}=${payload}.${mac}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${lifetime}`,redirect:band?`/b/${band.slug}`:'/admin'};
}
export async function session(request,env) {
  const cookie=(request.headers.get('Cookie') || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if (!cookie || cookie.length > 1000) return null;
  try {
    const [payload,mac,...rest]=cookie.split('.');
    if (rest.length) return null;
    const data=JSON.parse(new TextDecoder().decode(unbase64(payload)));
    if (!Number.isSafeInteger(data.expires) || data.expires<=Date.now()/1000) return null;
    let band=null;
    if (data.role!=='platform') {
      if (data.role!=='admin' || typeof data.band_id!=='string') return null;
      band=await env.DB.prepare('SELECT * FROM bands WHERE id=?').bind(data.band_id).first();
      if (!band || band.status!=='active' || band.auth_version!==data.auth_version) return null;
    }
    const valid=await crypto.subtle.verify('HMAC',await key(sessionSecret(env,band)),unbase64(mac),encoder.encode(`setroom-v2:${payload}`));
    return valid?{...data,band}:null;
  } catch { return null; }
}
export const logoutCookie = () => `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
