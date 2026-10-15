'use strict';
const root=document.querySelector('#portal-content');
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function post(path,data) {
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':'setroom-web'},body:JSON.stringify(data)});
 const result=await response.json();if(!response.ok)throw new Error(result.error || '操作未完成');return result;
}
async function progress() {
 const token=location.hash.slice(1);
 root.innerHTML='<h1>申请进度</h1><p role="status">正在查询…</p>';
 try {
  const data=await post('/api/application',{token});
  const status={pending:'待审核',active:'已批准',rejected:'未通过',disabled:'已停用'};
  root.innerHTML=`<h1>${E(data.name)}</h1><p class="badge">${status[data.status]}</p><p>乐队标识：<strong>${E(data.slug)}</strong></p>${data.review_note?`<p class="notice">审核说明：${E(data.review_note)}</p>`:''}<p>${data.status==='pending'?'管理员审核后，本页会显示结果。请保存下面的私密链接；申请时设置的 Key 请自行保管。':data.status==='active'?'空间已开通，使用申请时设置的 Key 登录即可。':data.status==='rejected'?'可联系管理员了解情况，或返回申请页重新提交并使用新的乐队标识。':'请联系网站管理员。'}</p><label class="field">私密进度链接<input id="progress-link" readonly value="${E(location.href)}"></label><div class="actions"><button class="button" id="copy-link">复制链接</button><button class="button" id="refresh-status">刷新进度</button>${data.status==='active'?`<a class="button primary" href="/login?band=${encodeURIComponent(data.slug)}">进入乐队</a>`:''}</div><p id="portal-message" role="status"></p>`;
  document.querySelector('#refresh-status').onclick=progress;
  document.querySelector('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);document.querySelector('#portal-message').textContent='已复制，请保存。';}catch{document.querySelector('#progress-link').select();document.querySelector('#portal-message').textContent='请复制选中的链接并保存。';}};
 } catch(e) {root.innerHTML=`<h1>无法查询申请</h1><p role="alert">${E(e.message)}</p><button class="button" id="retry">重试</button>`;document.querySelector('#retry').onclick=progress;}
}
function application() {
 root.innerHTML=`<h1>申请创建乐队</h1><p class="subtext">填写资料，管理员批准后即可使用独立的曲库、演出和愿望单。</p><form id="application-form"><div class="form-grid"><label class="field full">乐队名称<input name="name" required maxlength="100" autocomplete="organization"></label><label class="field full">乐队标识<input name="slug" required minlength="3" maxlength="40" pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" autocapitalize="none" spellcheck="false" placeholder="例如：your-band"><small>3–40 位小写字母、数字或中间的短横线，用于登录。</small></label><label class="field">联系人<input name="contact_name" required maxlength="100" autocomplete="name"></label><label class="field">联系方式<input name="contact_info" required maxlength="200" placeholder="微信 / 邮箱等"></label><label class="field full">设置乐队 Key<input name="password" type="password" required autocomplete="new-password"><small>Key 自由设置，支持简单文字、数字或 emoji；请自行保存。</small></label><label class="field full">再次输入 Key<input name="confirm_password" type="password" required autocomplete="new-password"></label></div><label class="honeypot" aria-hidden="true">网站<input name="website" tabindex="-1" autocomplete="off"></label><label class="check consent"><input name="consent" type="checkbox" required>我了解网站管理员可以查看和管理本乐队数据，联系方式仅供管理员审核和联系。</label><p class="muted tiny">愿望单的“发起人”和“我也想排”由成员自由填写文字，支持 emoji。</p><p class="form-error" id="application-error" role="alert"></p><button class="button primary" type="submit">提交申请</button></form>`;
 document.querySelector('#application-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('button'),error=document.querySelector('#application-error');error.textContent='';
  const data=Object.fromEntries(new FormData(form));if(data.password!==data.confirm_password){error.textContent='两次输入的 Key 不一致';return;}
  delete data.confirm_password;data.consent=form.elements.consent.checked;button.disabled=true;
  try {const result=await post('/api/apply',data);form.reset();location.replace('/application#'+result.token);}
  catch(e){error.textContent=e.message;button.disabled=false;}
 };
}
if(location.pathname==='/application') progress();else application();
