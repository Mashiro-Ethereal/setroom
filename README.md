# Setroom · 乐队曲库

管理乐队曲库、演出歌单与历史记录，并导出 Excel 分享给乐手。

仓库包含两个独立版本：

| 版本 | 适用场景 | 技术 |
| --- | --- | --- |
| [云端版](song_database_web/README.md) | 多个乐队通过网页协作管理 | Cloudflare Workers + D1、原生 JavaScript |
| [本地版](song_database/使用说明.md) | 一个人在 Mac 上管理，按需启动和退出 | Python 标准库 + SQLite、Tk 启动窗口 |

两个版本的数据独立，不会自动同步。仓库仅包含源码、测试、说明与虚构示例数据，不包含实际曲库、演出记录、登录 Key 或数据库备份。

## 云端版功能

- **未来演出**：管理日期、名称、主办方、地点、语言与有序歌单。
- **曲库**：统一管理名称、版本、语言及“可演 / 大饼 / 取消”状态，支持搜索、筛选与排序。
- **愿望单**：填写发起人与“我也想排”，可移入曲库并默认设为“大饼”。
- **历史记录**：手动确认完成后归档，保留本场歌曲资料快照，后续修改曲库不会改写历史。
- **多乐队**：申请创建、管理员审核、独立数据空间、Key 重置、停用和删除。
- **导出与备份**：Excel 分享歌单，JSON 备份和恢复当前乐队。

云端版的语言选项为“仅日语 / 全语种”。默认 KRB 乐队保留固定成员选项，新建乐队的愿望单成员信息采用纯文本，支持 emoji。

## 本机运行云端版

需要 Node.js 22.13 或更新版本。

```sh
cd song_database_web
cp wrangler.example.jsonc wrangler.jsonc
npm ci
node scripts/setup-local.mjs
npm run db:local
npm run dev -- --port 8787 --ip 127.0.0.1
```

打开 `http://127.0.0.1:8787`。本地默认乐队标识为 `krb`；生成的乐队 Key 在 `.access.txt`，网站管理员 Key 在 `.platform-access.txt`。这些文件不会提交到 Git。初始化迁移会创建少量虚构示例数据。

`setup-local.mjs` 仅首次运行，会拒绝覆盖已有密钥文件。停止开发服务时按 Control+C。

部署到自己的 Cloudflare 账号、运行测试及更多细节见 [云端版说明](song_database_web/README.md)。日常操作见 [使用指南](song_database_web/使用指南.md)，分享给乐队成员可用 [简短使用说明](song_database_web/给朋友的使用说明.md)。

## 运行本地版

macOS 安装 Python 3.10 或更新版本及 Tk 后，双击 `song_database/启动曲库.command`。无需安装 Python 第三方依赖。首次启动会创建空数据库。

也可以仅启动本地网页服务：

```sh
cd song_database
python3 app.py
```

具体启动、退出、备份及测试方式见 [本地版使用说明](song_database/使用说明.md)。

## 密钥与数据

部署时自行设置乐队 Key、网站管理员 Key 和独立随机的 `AUTH_SECRET`。`AUTH_SECRET` 用于会话和乐队密码校验，需私密备份，不能随意更换。

实际数据存放在本地 SQLite 或 Cloudflare D1；GitHub 仓库只管理代码。请通过应用的备份功能另行保存数据。
