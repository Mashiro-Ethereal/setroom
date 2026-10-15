import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const band=randomBytes(24).toString('base64url'),platform=randomBytes(24).toString('base64url'),auth=randomBytes(32).toString('base64url');
await writeFile(new URL('../.dev.vars',import.meta.url),`ADMIN_PASSWORD=${band}\nPLATFORM_PASSWORD=${platform}\nAUTH_SECRET=${auth}\n`,{flag:'wx',mode:0o600});
await writeFile(new URL('../.access.txt',import.meta.url),`本地 KRB 登录：http://127.0.0.1:8787/login?band=krb\n乐队 Key：${band}\n`,{flag:'wx',mode:0o600});
await writeFile(new URL('../.platform-access.txt',import.meta.url),`本地网站管理：http://127.0.0.1:8787/login?admin=1\n网站管理员 Key：${platform}\n请只由网站管理员保存。\n`,{flag:'wx',mode:0o600});
console.log('已生成本地 Key：.access.txt 和 .platform-access.txt。不会覆盖已有 .dev.vars。');
