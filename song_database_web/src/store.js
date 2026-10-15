export const MEMBERS = Object.freeze([{id:'ko',label:'🎸ko'},{id:'mu',label:'🎸mu'},{id:'cat',label:'🎤🐱'},{id:'wei',label:'🎹伟'},{id:'qian',label:'🥁钱'}]);
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const uid = () => crypto.randomUUID().replaceAll('-', '');
export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const now = () => new Date().toISOString();
const conflict = () => new AppError('数据已在其他窗口更新，请刷新后重试；当前修改尚未保存。', 409);
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('请求格式无效');
  return value;
}
export function text(value, label, required = false, limit = 500) {
  if (typeof value !== 'string') throw new AppError(`${label}需要填写文字`);
  value = value.trim();
  if (required && !value) throw new AppError(`请填写${label}`);
  if ([...value].length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new AppError(`${label}过长或包含不支持的字符`);
  return value;
}
export const LANGUAGE_OPTIONS = ['仅日语','全语种'];
function languages(value) {
  if (!Array.isArray(value) || value.length !== 1 || !LANGUAGE_OPTIONS.includes(value[0])) throw new AppError('语言请选择“仅日语”或“全语种”');
  return [...value];
}
export function convertLegacyLanguages(value) {
  if (!Array.isArray(value) || !value.length || value.some(v=>!['日语','中文','英语','英文','未注明',...LANGUAGE_OPTIONS].includes(v))) throw new AppError('旧备份中有无法识别的语言，请先核对');
  return [value.some(v=>['中文','英语','英文','全语种'].includes(v)) ? '全语种' : '仅日语'];
}

function songFields(data) {
  object(data);
  const status = data.status ?? '可演';
  if (!['可演','大饼','取消'].includes(status)) throw new AppError('曲目状态无效');
  return {name:text(data.name,'曲目名称',true,200),version:text(data.version ?? '', '版本',false,200) || '原版',languages:languages(data.languages),status};
}
function wishFields(data, mode = 'members') {
  object(data);
  if (mode === 'text') return {name:text(data.name,'曲目名称',true,200),version:text(data.version ?? '','版本',false,200) || '原版',languages:languages(data.languages),initiator:text(data.initiator,'发起人',true,200),supporters:text(data.supporters ?? '','我也想排',false,1000)};
  const ids = MEMBERS.map(m=>m.id);
  if (!ids.includes(data.initiator)) throw new AppError('请选择发起人');
  if (!Array.isArray(data.supporters) || data.supporters.length > 5 || data.supporters.some(id=>!ids.includes(id))) throw new AppError('我也想排只能选择固定的五位成员');
  return {name:text(data.name,'曲目名称',true,200),version:text(data.version ?? '', '版本',false,200) || '原版',languages:languages(data.languages),initiator:data.initiator,supporters:ids.filter(id=>data.supporters.includes(id))};
}
function date(value) {
  const raw = text(value, '演出日期', true, 10);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw.startsWith('0000') || !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== raw) throw new AppError('请选择有效的演出日期');
  return raw;
}
function eventFields(data) {
  object(data);
  const day = date(data.date), status = data.status ?? '计划中';
  if (!['计划中','已完成','已取消'].includes(status)) throw new AppError('演出状态无效');
  if (status === '已完成' && day > today()) throw new AppError('未来日期的演出暂时不能归档，请先核对日期');
  return {date:day,name:text(data.name,'演出名字',true,200),organizer:text(data.organizer ?? '', '主办方'),venue:text(data.venue ?? '', '地点'),languages:languages(data.languages),status};
}
function snapshotFields(data) {
  object(data);
  return {name:text(data.name,'历史曲目名称',true,200),version:text(data.version,'历史版本',true,200),languages:languages(data.languages)};
}
const decode = row => {
  const {band_id,...result} = row;
  for (const key of ['languages','snapshot','supporters']) if (result[key] != null) result[key] = JSON.parse(result[key]);
  return result;
};
export function stateOf(raw) {
  const songs = raw.songs.map(s => ({...s,played_count:0,last_played:null}));
  const performances = raw.performances.map(e => ({...e,items:[]}));
  const bySong = new Map(songs.map(s => [s.id,s])), byEvent = new Map(performances.map(e => [e.id,e]));
  const counted = new Set();
  for (const row of raw.items) {
    const song = bySong.get(row.song_id), event = byEvent.get(row.performance_id);
    const display = row.snapshot || {name:song.name,version:song.version,languages:song.languages};
    event.items.push({...row,song:display,current_status:song.status});
    const key = `${event.id}:${song.id}`;
    if (event.status === '已完成' && !counted.has(key)) {
      counted.add(key); song.played_count++;
      song.last_played = !song.last_played || event.date > song.last_played ? event.date : song.last_played;
    }
  }
  return {songs,performances,wishlist:raw.wishlist,members:raw.band.wish_mode === 'members' ? MEMBERS : [],band:raw.band,generation:raw.meta.generation};
}
const tables = {
  wishlist:['id','name','version','languages','initiator','supporters','revision','created_at','updated_at'],
  songs:['id','name','version','languages','status','revision','created_at','updated_at'],
  performances:['id','date','name','organizer','venue','languages','status','completed_at','revision','created_at','updated_at'],
  setlist_items:['id','performance_id','song_id','position','note','snapshot'],
};
export function backupOf(raw) {
  return {format:'setroom-web',version:4,band:{id:raw.band.id,wish_mode:raw.band.wish_mode},exported_at:now(),songs:raw.songs,performances:raw.performances,items:raw.items,wishlist:raw.wishlist};
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new AppError('备份中的记录标识无效');
  return value;
}
function metadata(row) {
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new AppError('备份中的记录版本无效');
  const timestamp = value => {
    if (typeof value !== 'string' || value.length > 50 || !Number.isFinite(Date.parse(value))) throw new AppError('备份中的保存时间无效');
    return value;
  };
  return {id:identifier(row.id),revision:row.revision,created_at:timestamp(row.created_at),updated_at:timestamp(row.updated_at)};
}
export const KRB = Object.freeze({id:'krb',slug:'krb',name:'KRB',wish_mode:'members'});
export function validateBackup(data, band = KRB) {
  object(data);
  if (data.format !== 'setroom-web' || ![1,2,3,4].includes(data.version)) throw new AppError('请选择网页版导出的 JSON 备份');
  if (data.version === 4 ? data.band?.id !== band.id || data.band?.wish_mode !== band.wish_mode : band.id !== 'krb') throw new AppError('备份不属于当前乐队或愿望单填写方式不一致');
  for (const key of ['songs','performances','items']) if (!Array.isArray(data[key])) throw new AppError('备份缺少完整记录');
  const converted = row => data.version < 3 ? {...row,languages:convertLegacyLanguages(object(row).languages)} : row;
  const songs = data.songs.map(s => ({...songFields(converted(s)),...metadata(s)}));
  const performances = data.performances.map(e => ({...eventFields(converted(e)),...metadata(e),completed_at:e.completed_at == null ? null : text(e.completed_at,'归档时间',true,50)}));
  const bySong = new Map(songs.map(s => [s.id,s])), byEvent = new Map(performances.map(e => [e.id,e]));
  if (bySong.size !== songs.length || byEvent.size !== performances.length) throw new AppError('备份中存在重复的记录标识');
  const seen = new Set(), positions = new Map();
  const items = data.items.map(row => {
    object(row);
    const id = identifier(row.id), performance_id = identifier(row.performance_id), song_id = identifier(row.song_id);
    const event = byEvent.get(performance_id);
    if (!event || !bySong.has(song_id)) throw new AppError('备份中的歌单关联不完整');
    if (seen.has(id)) throw new AppError('备份中存在重复的歌单条目');
    seen.add(id);
    const nums = positions.get(performance_id) || [];
    if (!Number.isSafeInteger(row.position) || row.position < 0 || nums.includes(row.position)) throw new AppError('备份中的歌单顺序无效');
    nums.push(row.position); positions.set(performance_id,nums);
    if (event.status !== '已完成' && row.snapshot != null) throw new AppError('规划歌单包含无效的归档信息');
    const snapshot = event.status === '已完成' ? snapshotFields(converted(object(row.snapshot))) : null;
    return {id,performance_id,song_id,position:row.position,note:text(row.note,'本场备注',false,2000),snapshot};
  });
  for (const event of performances) {
    const nums = (positions.get(event.id) || []).sort((a,b)=>a-b);
    if (nums.length > 500 || nums.some((v,i)=>v !== i) || (event.status === '已完成' && !nums.length)) throw new AppError('备份中的歌单数量或顺序无效');
    if (event.status === '已完成' && !Number.isFinite(Date.parse(event.completed_at))) throw new AppError('历史记录缺少有效的归档时间');
  }
  let wishlist = null; // Version 1 predates wishes; restoring it keeps existing wishes.
  if (data.version >= 2) {
    if (!Array.isArray(data.wishlist)) throw new AppError('备份缺少愿望单');
    wishlist = data.wishlist.map(w=>({...wishFields(converted(w),band.wish_mode),...metadata(w)}));
    if (new Set(wishlist.map(w=>w.id)).size !== wishlist.length) throw new AppError('备份中存在重复的愿望标识');
  }
  return {songs,performances,items,wishlist};
}
export class Store {
  constructor(db, band = KRB) { this.db = db; this.band = {id:band.id,slug:band.slug,name:band.name,wish_mode:band.wish_mode}; }
  statement(sql, ...args) { return this.db.prepare(sql).bind(...args); }
  async read() {
    const [meta,songs,events,items,wishlist] = await this.db.batch([
      this.statement('SELECT * FROM app_meta WHERE id=1 AND band_id=?',this.band.id),
      this.statement('SELECT * FROM songs WHERE band_id=? ORDER BY created_at DESC,id',this.band.id),
      this.statement('SELECT * FROM performances WHERE band_id=? ORDER BY date,created_at,id',this.band.id),
      this.statement('SELECT * FROM setlist_items WHERE band_id=? ORDER BY position,id',this.band.id),
      this.statement('SELECT * FROM wishlist WHERE band_id=? ORDER BY created_at DESC,id',this.band.id),
    ]);
    if (!meta.results[0]) throw new AppError('数据库尚未初始化',503);
    return {band:this.band,meta:decode(meta.results[0]),songs:songs.results.map(decode),performances:events.results.map(decode),items:items.results.map(decode),wishlist:wishlist.results.map(decode)};
  }
  check(raw,data) { if (data.generation !== raw.meta.generation) throw conflict(); }
  existing(raw,kind,id,data) {
    const row = raw[kind].find(r => r.id === id);
    if (!row || row.revision !== data.revision) throw conflict();
    return row;
  }
  insert(table, rows) {
    const columns = [...tables[table],'band_id'];
    rows = rows.map(row=>({...row,band_id:this.band.id}));
    // One JSON parameter avoids D1's parameter/query limits for long setlists.
    return this.statement(`INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.map(k => k==='supporters' ? `json_quote(json_extract(value,'$.${k}'))` : `json_extract(value,'$.${k}')`).join(',')} FROM json_each(?)`, JSON.stringify(rows));
  }
  async write(raw, statements, generation = raw.meta.generation) {
    try {
      await this.db.batch([this.statement('UPDATE app_meta SET revision=?,generation=? WHERE id=1 AND band_id=?',raw.meta.revision+1,generation,this.band.id),...statements]);
    } catch (e) {
      if (String(e).includes('SETROOM_CONFLICT')) throw conflict();
      throw e;
    }
  }
  async saveSong(data, id) {
    object(data);
    const fields = songFields(data), raw = await this.read(); this.check(raw,data);
    const old = id ? this.existing(raw,'songs',id,data) : null;
    id ||= uid(); const stamp = now();
    const statement = old ? this.statement('UPDATE songs SET name=?,version=?,languages=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND band_id=?',fields.name,fields.version,JSON.stringify(fields.languages),fields.status,stamp,id,this.band.id)
      : this.insert('songs',[{id,...fields,revision:1,created_at:stamp,updated_at:stamp}]);
    await this.write(raw,[statement]); return id;
  }
  async saveWish(data,id) {
    const fields = wishFields(data,this.band.wish_mode), raw = await this.read(); this.check(raw,data);
    const old = id ? this.existing(raw,'wishlist',id,data) : null;
    id ||= uid(); const stamp = now();
    const statement = old ? this.statement('UPDATE wishlist SET name=?,version=?,languages=?,initiator=?,supporters=?,revision=revision+1,updated_at=? WHERE id=? AND band_id=?',fields.name,fields.version,JSON.stringify(fields.languages),fields.initiator,JSON.stringify(fields.supporters),stamp,id,this.band.id)
      : this.insert('wishlist',[{id,...fields,revision:1,created_at:stamp,updated_at:stamp}]);
    await this.write(raw,[statement]); return id;
  }
  async moveWishToSongs(id,data) {
    const raw = await this.read(); this.check(raw,data);
    const wish = this.existing(raw,'wishlist',id,data);
    const songId = uid(), stamp = now();
    await this.write(raw,[
      this.insert('songs',[{id:songId,name:wish.name,version:wish.version,languages:wish.languages,status:'大饼',revision:1,created_at:stamp,updated_at:stamp}]),
      this.statement('DELETE FROM wishlist WHERE id=? AND band_id=?',id,this.band.id),
    ]);
    return songId;
  }
  async savePerformance(data,id) {
    const fields = eventFields(data), raw = await this.read(); this.check(raw,data);
    if (!Array.isArray(data.items) || data.items.length > 500) throw new AppError('单场歌单最多支持 500 条曲目');
    if (fields.status === '已完成' && !data.items.length) throw new AppError('请先确认实际演出的歌单，再完成归档');
    const old = id ? this.existing(raw,'performances',id,data) : null;
    if (old?.status === '已完成' && fields.status !== '已完成') throw new AppError('历史演出请使用“更正记录”；需要安排新演出时请复制');
    const previous = new Map(raw.items.filter(i => i.performance_id === id).map(i=>[i.id,i]));
    const bySong = new Map(raw.songs.map(s=>[s.id,s]));
    const seen = new Set(); id ||= uid();
    const prepared = data.items.map((item,position) => {
      object(item);
      const song = bySong.get(item.song_id), prior = previous.get(item.id);
      if (!song) throw new AppError('歌单中的曲目已不存在，请重新选择');
      const same = prior && prior.song_id === song.id;
      if (fields.status === '计划中' && song.status === '取消' && !same) throw new AppError(`“${song.name}”已取消，请选择其他曲目或先修改曲目状态`);
      const itemId = same ? prior.id : uid();
      if (seen.has(itemId)) throw new AppError('歌单条目标识重复');
      seen.add(itemId);
      let snapshot = null;
      if (fields.status === '已完成') snapshot = old?.status === '已完成' && same ? snapshotFields(item.snapshot ?? prior.snapshot) : snapshotFields(song);
      return {id:itemId,performance_id:id,song_id:song.id,position,note:text(item.note ?? '','本场备注',false,2000),snapshot};
    });
    const stamp = now(), completed = old?.completed_at || (fields.status === '已完成' ? stamp : null);
    const statements = old ? [this.statement('UPDATE performances SET date=?,name=?,organizer=?,venue=?,languages=?,status=?,completed_at=?,revision=revision+1,updated_at=? WHERE id=? AND band_id=?',fields.date,fields.name,fields.organizer,fields.venue,JSON.stringify(fields.languages),fields.status,completed,stamp,id,this.band.id),this.statement('DELETE FROM setlist_items WHERE performance_id=? AND band_id=?',id,this.band.id)]
      : [this.insert('performances',[{id,...fields,completed_at:completed,revision:1,created_at:stamp,updated_at:stamp}])];
    if (prepared.length) statements.push(this.insert('setlist_items',prepared));
    await this.write(raw,statements); return id;
  }
  async delete(kind,id,data) {
    const raw = await this.read(); this.check(raw,data); this.existing(raw,kind,id,data);
    if (kind === 'songs' && raw.items.some(i => i.song_id === id)) throw new AppError('这首曲目已被演出引用，请改为“取消”，以保留演出记录');
    if (!['songs','performances','wishlist'].includes(kind)) throw new AppError('记录类型无效');
    await this.write(raw,[this.statement(`DELETE FROM ${kind} WHERE id=? AND band_id=?`,id,this.band.id)]);
  }
  async restore(data,generation) {
    const imported = validateBackup(data,this.band), raw = await this.read(); this.check(raw,{generation});
    await this.write(raw,[
      this.statement('INSERT INTO restore_backup (id,created_at,payload,band_id) VALUES (1,?,?,?) ON CONFLICT(band_id,id) DO UPDATE SET created_at=excluded.created_at,payload=excluded.payload',now(),JSON.stringify(backupOf(raw)),this.band.id),
      this.statement('DELETE FROM setlist_items WHERE band_id=?',this.band.id),this.statement('DELETE FROM performances WHERE band_id=?',this.band.id),this.statement('DELETE FROM songs WHERE band_id=?',this.band.id),
      this.insert('songs',imported.songs),this.insert('performances',imported.performances),this.insert('setlist_items',imported.items),
      ...(imported.wishlist === null ? [] : [this.statement('DELETE FROM wishlist WHERE band_id=?',this.band.id),this.insert('wishlist',imported.wishlist)]),
    ],uid());
  }
}
