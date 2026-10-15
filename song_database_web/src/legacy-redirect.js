const destination = 'https://krb.xiuhuizhang1004.workers.dev';
export default {
  fetch(request) {
    const url = new URL(request.url);
    // An already-open old tab must not keep writing to the trial database.
    if (url.pathname.startsWith('/api/')) return Response.json({error:'曲库已迁移，请刷新页面并在新网址登录。',url:destination},{status:410,headers:{'Cache-Control':'no-store'}});
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
    return new Response(null,{status:302,headers:{Location:destination+url.pathname+url.search,'Cache-Control':'no-store'}});
  },
};
