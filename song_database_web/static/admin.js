'use strict';
const $=s=>document.querySelector(s), E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={pending:'待审核',active:'已开通',rejected:'未通过',disabled:'已停用'};
let bands=[];
async function api(path,data) {
 const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-App-Token':'setroom-web'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const result=await response.json();if(!response.ok)throw new Error(result.error || '操作未完成');return result;
}
async function refresh() {
 try {
  bands=(await api('/api/admin/bands')).bands;
  $('#admin-list').innerHTML=bands.map(b=>`<article class="band-card"><div class="actions"><span class="badge ${b.status==='pending'?'warn':''}">${labels[b.status]}</span><span class="muted tiny">${E(b.slug)}</span></div><h2>${E(b.name)}</h2><p class="muted">${b.song_count} 首曲目 · ${b.performance_count} 场演出 · ${b.wish_count} 首愿望</p><p>联系人：${E(b.contact_name || '—')}<br>联系方式：${E(b.contact_info || '—')}</p><p class="muted tiny">愿望单：${b.wish_mode==='members'?'成员选择':'自由填写'}<br>创建于 ${E(b.created_at.slice(0,10))}</p>${b.review_note?`<p class="notice">${E(b.review_note)}</p>`:''}<div class="actions">${['active','disabled'].includes(b.status)?`<a class="button primary" href="/b/${E(b.slug)}" target="_blank" rel="noopener">管理曲库与演出</a><button class="button" data-id="${b.id}" data-action="settings">设置</button>`:''}${b.status==='pending'?`<button class="button primary" data-id="${b.id}" data-action="approve">批准</button><button class="button" data-id="${b.id}" data-action="reject">拒绝</button>`:''}<button class="button" data-id="${b.id}" data-action="reset-key">重置 Key</button><button class="button danger" data-id="${b.id}" data-action="delete">删除乐队</button></div></article>`).join('') || '<p>暂无乐队。</p>';
 } catch(e){$('#admin-message').textContent=e.message;}
}
const field=(name,label,value='',extra='')=>`<label class="field full">${label}<input name="${name}" value="${E(value)}" ${extra}></label>`;
function edit(action,band) {
 const title=action==='create'?'创建乐队':action==='settings'?'乐队设置':action==='reset-key'?'重置乐队 Key':action==='approve'?'批准申请':action==='delete'?'删除乐队':'拒绝申请';
 let fields='';
 if(action==='delete') fields=`<p class="notice">将永久删除乐队“${E(band.name)}”（${E(band.slug)}）及其全部歌曲、演出、歌单、愿望单和站内恢复前备份。所有成员将无法登录，申请进度链接失效。此操作无法在网站内撤销；如需保留资料，请先导出备份。</p>${field('confirm_name','请输入完整乐队名称确认删除','','required autocomplete="off"')} `;
 if(action==='create' || action==='settings') {
  fields+=field('name','乐队名称',band?.name,'required maxlength="100"');
  if(action==='create')fields+=field('slug','乐队标识','','required minlength="3" maxlength="40" pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" placeholder="your-band"');
  fields+=field('contact_name','联系人',band?.contact_name,`${action==='create'?'required':''} maxlength="100"`)+field('contact_info','联系方式',band?.contact_info,`${action==='create'?'required':''} maxlength="200"`);
  if(action==='settings')fields+=`<label class="field full">空间状态<select name="status"><option value="active" ${band.status==='active'?'selected':''}>已开通</option><option value="disabled" ${band.status==='disabled'?'selected':''}>已停用</option></select></label><p class="muted">停用后成员无法登录，数据保留，你仍可管理。保存设置会使现有乐队登录失效。</p>`;
 }
 if(action==='create' || action==='reset-key') fields+=field('password','新的乐队 Key','','type="password" required autocomplete="new-password"')+field('confirm_password','再次输入 Key','','type="password" required autocomplete="new-password"')+'<p class="muted">请自行保存并私下交给该乐队；后台无法查看原 Key。重置后旧 Key 和旧登录立即失效。</p>';
 if(['approve','reject'].includes(action))fields+=`<label class="field full">审核说明<textarea name="review_note" maxlength="500" placeholder="申请人可在进度页看到此说明"></textarea></label><p>${action==='approve'?'批准后创建独立空间，申请人可用自己设置的 Key 登录。':'拒绝后不会开通空间；申请人可联系你或使用新标识重新申请。'}</p>`;
 $('#admin-editor-content').innerHTML=`<form id="manage-form"><div class="editor-header"><h2 id="admin-editor-title">${title}${band?' · '+E(band.name):''}</h2></div><div class="editor-body"><div class="form-grid">${fields}</div><p class="form-error" id="manage-error" role="alert"></p></div><div class="editor-footer"><span></span><div class="actions"><button type="button" class="button" id="manage-cancel">取消</button><button class="button ${action==='delete'?'danger':'primary'}" type="submit">${title}</button></div></div></form>`;
 $('#admin-editor').className='narrow';$('#admin-editor').showModal();$('#manage-cancel').onclick=()=>$('#admin-editor').close();
 $('#manage-form').onsubmit=async event=>{
  event.preventDefault();const data=Object.fromEntries(new FormData(event.target)),button=event.target.querySelector('[type="submit"]');
  if(data.password!==data.confirm_password){$('#manage-error').textContent='两次输入的 Key 不一致';return;}
  delete data.confirm_password;button.disabled=true;
  try {await api('/api/admin/bands'+(band?'/'+band.id:''),{...data,action,auth_version:band?.auth_version});event.target.reset();$('#admin-editor').close();$('#admin-message').textContent=title+'已完成';await refresh();}
  catch(e){$('#manage-error').textContent=e.message;}finally{button.disabled=false;}
 };
}
$('#admin-list').onclick=event=>{const button=event.target.closest('[data-action]');if(button)edit(button.dataset.action,bands.find(b=>b.id===button.dataset.id));};
$('#admin-create').onclick=()=>edit('create');$('#admin-refresh').onclick=refresh;
$('#admin-logout').onclick=async()=>{try{await api('/api/logout',{});location.replace('/login?admin=1');}catch(e){$('#admin-message').textContent=e.message;}};
refresh();
