-- Convert all modules to the two agreed language categories. Unspecified means Japanese-only.
UPDATE songs SET languages=CASE WHEN EXISTS (SELECT 1 FROM json_each(languages) WHERE value IN ('中文','英语','英文','全语种')) THEN '["全语种"]' ELSE '["仅日语"]' END,revision=revision+1;
UPDATE performances SET languages=CASE WHEN EXISTS (SELECT 1 FROM json_each(languages) WHERE value IN ('中文','英语','英文','全语种')) THEN '["全语种"]' ELSE '["仅日语"]' END,revision=revision+1;
UPDATE wishlist SET languages=CASE WHEN EXISTS (SELECT 1 FROM json_each(languages) WHERE value IN ('中文','英语','英文','全语种')) THEN '["全语种"]' ELSE '["仅日语"]' END,revision=revision+1;
UPDATE setlist_items SET snapshot=json_set(snapshot,'$.languages',json(CASE WHEN EXISTS (SELECT 1 FROM json_each(snapshot,'$.languages') WHERE value IN ('中文','英语','英文','全语种')) THEN '["全语种"]' ELSE '["仅日语"]' END)) WHERE snapshot IS NOT NULL;
UPDATE app_meta SET generation=lower(hex(randomblob(16))),revision=revision+1 WHERE id=1;
