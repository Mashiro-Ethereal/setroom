'use strict';
const loginParams=new URLSearchParams(location.search), platformLogin=loginParams.get('admin')==='1';
const loginForm=document.querySelector('#login-form');
if(platformLogin) {
  loginForm.elements.kind.value='platform'; loginForm.elements.slug.disabled=true;
  document.querySelector('#band-field').hidden=true;
  document.querySelector('#login-title').textContent='网站管理后台';
  document.querySelector('#login-description').textContent='审核申请，管理各个乐队的工作空间。';
  document.querySelector('#login-note').textContent='使用独立的网站管理员 Key 登录。';
  document.querySelector('#login-switch').href='/login';document.querySelector('#login-switch').textContent='返回乐队登录';
} else if(loginParams.has('band')) loginForm.elements.slug.value=loginParams.get('band');
loginForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=event.target.querySelector('button'),error=document.querySelector('#login-error');
  button.disabled=true;error.textContent='';
  try {
    const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':'setroom-web'},body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});
    const result=await response.json();if(!response.ok)throw new Error(result.error || '登录未完成');
    location.replace(result.redirect);
  } catch(e) {error.textContent=e.message==='Failed to fetch'?'暂时无法连接，请检查网络后重试。':e.message;}
  finally {button.disabled=false;}
});
