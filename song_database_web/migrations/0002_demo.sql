-- Independent sample records for the cloud trial; no local repertoire data.
INSERT INTO songs VALUES
 ('demo-song-1','示例 · 星光','原版','["中文"]','可演',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('demo-song-2','示例 · 启程','Acoustic','["日语","英语"]','大饼',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z'),
 ('demo-song-3','示例 · 余音','乐队版','["中文"]','可演',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
INSERT INTO performances VALUES
 ('demo-past','2026-09-01','示例 · 初秋演出','示例主办方','示例 Livehouse','["中文"]','已完成','2026-09-01T15:00:00Z',1,'2026-09-01T15:00:00Z','2026-09-01T15:00:00Z'),
 ('demo-future','2026-10-10','示例 · 下一次登台','示例主办方','待定','["中文","日语"]','计划中',NULL,1,'2026-09-01T15:00:00Z','2026-09-01T15:00:00Z');
INSERT INTO setlist_items VALUES
 ('demo-item-1','demo-past','demo-song-1',0,'开场','{"name":"示例 · 星光","version":"原版","languages":["中文"]}'),
 ('demo-item-2','demo-past','demo-song-3',1,'返场','{"name":"示例 · 余音","version":"乐队版","languages":["中文"]}'),
 ('demo-item-3','demo-future','demo-song-1',0,'正常速度',NULL),
 ('demo-item-4','demo-future','demo-song-2',1,'排练后确认',NULL);
UPDATE app_meta SET revision=revision+1 WHERE id=1;
