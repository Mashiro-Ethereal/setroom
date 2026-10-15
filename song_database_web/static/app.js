'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const E = escapeHTML;
const token = $('meta[name="app-token"]').content;
const readonly = $('meta[name="user-role"]').content === 'viewer';
const editor = $('#editor');
let state = {songs: [], performances: [], wishlist: [], members: [], generation: ''};
let view = ['songs', 'history', 'wishlist'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'upcoming';
let detailId = null;
let dirty = false;
let stopped = false;
let draft = null;
let dialogKind = null;
let toastTimer;
const filters = {wishlist:{q:'',language:''},songs: {q:'', language:'', status:'', played:false}, upcoming:{q:'', language:'', year:'', cancelled:false}, history:{q:'', language:'', year:''}};
const wishSort = {key:'',direction:'asc'};
const songSort = {key:'', direction:'asc'};
const songCollator = new Intl.Collator('zh-CN', {numeric:true, sensitivity:'base'});

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const tags = values => values.map(v => `<span class="language">${E(v)}</span>`).join('');
const badge = status => `<span class="badge ${['大饼','待确认'].includes(status)?'warn':['取消','已取消'].includes(status)?'cancel':''}">${E(status)}</span>`;
const displayStatus = event => event.status === '计划中' && event.date < today() ? '待确认' : event.status;
const eventById = id => state.performances.find(e => e.id === id);
const songById = id => state.songs.find(s => s.id === id);
const languagesFromText = value => [...new Set(value.split(/[,，、;；\n]/).map(s => s.trim()).filter(Boolean))];
const options = (values, selected, empty) => `<option value="">${E(empty)}</option>` + values.map(v => `<option value="${E(v)}" ${v === selected ? 'selected' : ''}>${E(v)}</option>`).join('');

const languageOptions = ['仅日语','全语种'];
const languageCategory = values => values.some(v=>['中文','英文','英语','全语种'].includes(v))?'全语种':'仅日语';
function languageSelect(values, attrs='name="languages"') {
  return `<select ${attrs} required>${languageOptions.map(value=>`<option value="${value}" ${value===languageCategory(values)?'selected':''}>${value}</option>`).join('')}</select>`;
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const el = $('#toast');
  el.textContent = message;
  el.className = `show${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => el.className = '', error ? 7000 : 3500);
}

async function request(path, data, {download = false, raw = false} = {}) {
  const headers = {'X-App-Token': token,'X-Band-ID':$('meta[name="band-id"]').content};
  const init = {headers};
  if (data !== undefined) {
    init.method = 'POST';
    headers['Content-Type'] = 'application/json';
    headers['X-Data-Generation'] = state.generation;
    init.body = raw ? data : JSON.stringify(data);
  }
  let response;
  try { response = await fetch(path, init); }
  catch { throw new Error('暂时无法连接云端。请检查网络后重试，未保存的内容仍保留在当前页面。'); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || '操作失败，请重试');
  }
  if (download && path.startsWith('/api/export/')) {
    const payload = await response.json();
    const {downloadExcel} = await import('/excel.js');
    downloadExcel(payload);
    return;
  }
  if (download) {
    const blob = await response.blob();
    const name = response.headers.get('Content-Disposition')?.split("UTF-8''")[1];
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name ? decodeURIComponent(name) : '导出文件';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return;
  }
  return response.json();
}

function run(task) { return Promise.resolve().then(task).catch(e => toast(e.message, true)); }

async function refresh() {
  state = await request('/api/state');
  render();
}

function confirmAction(title, message, label = '确认', danger = false) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = message;
  $('#confirm-ok').textContent = label;
  $('#confirm-ok').className = `button ${danger ? 'danger' : 'primary'}`;
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), {once:true}));
}

async function closeEditor(force = false) {
  if (!force && dirty && !await confirmAction('放弃尚未保存的修改？', '已保存的数据不会受到影响。', '放弃修改', true)) return false;
  dirty = false;
  draft = null;
  dialogKind = null;
  editor.close();
  return true;
}

function shellHeader(title, english, subtitle, buttons) {
  return `<div class="page-heading"><div><p class="eyebrow">${english}</p><h1>${title}</h1><p class="subtext">${subtitle}</p></div><div class="actions">${buttons}</div></div>`;
}

function emptyState(title, description, action = '') {
  return `<div class="empty"><div class="empty-icon">♫</div><h2>${title}</h2><p>${description}</p>${action}</div>`;
}

function visibleSongs() {
  const f = filters.songs;
  const songs = state.songs.filter(s => (!f.q || `${s.name} ${s.version}`.toLowerCase().includes(f.q.toLowerCase())) &&
    (!f.language || s.languages.includes(f.language)) && (!f.status || s.status === f.status) && (!f.played || s.played_count > 0));
  if (!songSort.key) return songs;
  const {key, direction} = songSort;
  return songs.sort((a,b) => {
    // Undated songs stay at the end in either date direction.
    if (key === 'last_played' && (!a.last_played || !b.last_played)) {
      if (Boolean(a.last_played) !== Boolean(b.last_played)) return a.last_played ? -1 : 1;
    }
    const comparison = key === 'played_count' ? a[key] - b[key] : songCollator.compare(a[key] || '', b[key] || '');
    return comparison * (direction === 'asc' ? 1 : -1) ||
      songCollator.compare(a.name, b.name) || songCollator.compare(a.version, b.version);
  });
}

function songSortHeader(key, label, sorting = songSort, action = 'sort-songs') {
  const active = sorting.key === key;
  const ascending = !active || sorting.direction === 'desc';
  return `<th scope="col"${active ? ` aria-sort="${sorting.direction === 'asc' ? 'ascending' : 'descending'}"` : ''}><button class="sort-button${active?' active':''}" data-action="${action}" data-key="${key}" aria-label="${label}：按 ${ascending?'A–Z':'Z–A'} 排序">${label}<span aria-hidden="true">${active ? (sorting.direction === 'asc' ? 'A–Z ↑' : 'Z–A ↓') : '↕'}</span></button></th>`;
}

function experienceSortHeader() {
  const active = ['played_count','last_played'].includes(songSort.key);
  const selected = active ? `${songSort.key}:${songSort.direction}` : '';
  const choices = [['','选择排序'],['played_count:desc','演出数量：多 → 少'],['played_count:asc','演出数量：少 → 多'],['last_played:desc','最近演出：新 → 旧'],['last_played:asc','最近演出：旧 → 新']];
  return `<th scope="col"${active ? ` aria-sort="${songSort.direction === 'asc' ? 'ascending' : 'descending'}"` : ''}><div class="experience-sort"><label for="experience-sort">演出经历</label><select id="experience-sort" aria-label="演出经历排序">${choices.map(([value,label])=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`).join('')}</select></div></th>`;
}

function renderSongSort(focusSelector) {
  $('#results').innerHTML = songTable(visibleSongs());
  $(focusSelector)?.focus({preventScroll:true});
}

function songTable(songs) {
  if (!songs.length) return emptyState(state.songs.length ? '没有符合条件的曲目' : '把第一首歌放进曲库', state.songs.length ? '试试其他名称、语言或状态。' : '从演过的歌，到准备中的大饼，都在这里慢慢积累。', state.songs.length ? '<button class="button" data-action="reset-filters">清除筛选</button>' : '<button class="button primary" data-action="new-song">＋ 新增曲目</button>');
  return `<div class="table-wrap"><table><thead><tr>${songSortHeader('name','曲目名称')}${songSortHeader('version','版本')}<th>语言</th><th>状态</th>${experienceSortHeader()}<th></th></tr></thead><tbody>${songs.map(s => `<tr><td><button class="song-title" data-action="edit-song" data-id="${s.id}">${E(s.name)}</button></td><td class="muted">${E(s.version)}</td><td>${tags(s.languages)}</td><td>${badge(s.status)}</td><td class="muted">${s.played_count ? `${s.played_count} 场 <span class="tiny">· 最近 ${E(s.last_played)}</span>` : '<span class="tiny">尚未演出</span>'}</td><td><div class="row-actions"><button class="icon-button" data-action="edit-song" data-id="${s.id}">编辑</button></div></td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>显示 ${songs.length} / ${state.songs.length} 首曲目</span><span>同一首歌，不同版本分别管理</span></div>`;
}

function renderSongs() {
  const f = filters.songs;
  const langs = languageOptions;
  return shellHeader('曲库', 'THE REPERTOIRE', '每一个版本，都有自己的舞台。', '<button class="button" data-action="export-all">导出全部 Excel</button><button class="button primary" data-action="new-song">＋ 新增曲目</button>') +
    `<div class="filters"><div class="search"><input id="search" aria-label="搜索曲目" placeholder="搜索曲目名称、版本…" value="${E(f.q)}"></div><select data-filter="language" aria-label="筛选语言">${options(langs, f.language, '全部分类')}</select><select data-filter="status" aria-label="筛选状态">${options(['可演','大饼','取消'], f.status, '全部状态')}</select><label class="check"><input type="checkbox" data-filter="played" ${f.played?'checked':''}>只看已演过</label><button class="button small" data-action="export-filtered">导出筛选结果</button></div><div id="results">${songTable(visibleSongs())}</div>`;
}

const memberLabel = id => state.band?.wish_mode==='text' ? id : state.members.find(m=>m.id===id)?.label || id;
const textWishes = () => state.band?.wish_mode==='text';
const supportLabels = value => typeof value==='string' ? (value?[value]:[]) : value.map(memberLabel);
const wishById = id => state.wishlist.find(w=>w.id===id);
function visibleWishes() {
  const f=filters.wishlist;
  const rows=state.wishlist.filter(w=>(!f.q || `${w.name} ${w.version}`.toLowerCase().includes(f.q.toLowerCase())) && (!f.language || w.languages.includes(f.language)));
  return wishSort.key ? rows.sort((a,b)=>songCollator.compare(a[wishSort.key],b[wishSort.key])*(wishSort.direction==='asc'?1:-1) || songCollator.compare(a.name,b.name)) : rows;
}
function wishTable(rows) {
  if(!rows.length)return emptyState(state.wishlist.length?'没有符合条件的愿望':'下一首想排什么？',state.wishlist.length?'试试其他名称或语言。':'把想排的歌放在这里，记下发起人和支持的伙伴。',state.wishlist.length?'<button class="button" data-action="reset-filters">清除筛选</button>':readonly?'':'<button class="button primary" data-action="new-wish">＋ 新增愿望</button>');
  return `<div class="table-wrap"><table><thead><tr>${songSortHeader('name','曲目名称',wishSort,'sort-wishes')}${songSortHeader('version','版本',wishSort,'sort-wishes')}<th>语言</th><th>发起人</th><th>我也想排</th>${readonly?'':'<th></th><th>加入曲库</th>'}</tr></thead><tbody>${rows.map(w=>`<tr><td>${readonly?`<strong>${E(w.name)}</strong>`:`<button class="song-title" data-action="edit-wish" data-id="${w.id}">${E(w.name)}</button>`}</td><td class="muted">${E(w.version)}</td><td>${tags(w.languages)}</td><td>${tags([memberLabel(w.initiator)])}</td><td>${w.supporters.length?tags(supportLabels(w.supporters)):'<span class="muted">—</span>'}</td>${readonly?'':`<td><button class="icon-button" data-action="edit-wish" data-id="${w.id}">编辑</button></td><td><button class="button small" data-action="move-wish" data-id="${w.id}">加入曲库</button></td>`}</tr>`).join('')}</tbody></table></div><div class="table-footer">显示 ${rows.length} / ${state.wishlist.length} 首愿望</div>`;
}
function renderWishes() {
  const f=filters.wishlist,langs=languageOptions;
  return shellHeader('愿望单','ON OUR WISHLIST','想排的歌，和想一起排的伙伴。',`<button class="button" data-action="export-wishes">导出全部 Excel</button>${readonly?'':'<button class="button primary" data-action="new-wish">＋ 新增愿望</button>'}`)+`<div class="filters"><div class="search"><input id="search" aria-label="搜索愿望" placeholder="搜索曲目名称、版本…" value="${E(f.q)}"></div><select data-filter="language" aria-label="筛选语言">${options(langs,f.language,'全部分类')}</select><button class="button small" data-action="export-wishes-filtered">导出筛选结果</button></div><div id="results">${wishTable(visibleWishes())}</div>`;
}
function openWish(id) {
  if(readonly)return;
  const wish=id && wishById(id);
  draft=wish?structuredClone(wish):{name:'',version:'原版',languages:[],initiator:'',supporters:textWishes()?'':[]};
  draft.generation=state.generation;dialogKind='wish';dirty=false;editor.className='narrow';
  $('#editor-content').innerHTML=`<form id="wish-form">${editorHeader(wish?'编辑愿望':'新增愿望',textWishes()?'发起人和“我也想排”自由填写，支持 emoji。':'发起人单选，“我也想排”可以选择多位成员。')}<div class="editor-body"><div class="form-error" role="alert"></div><div class="form-grid"><label class="field full">曲目名称<input name="name" required maxlength="200" value="${E(draft.name)}" autofocus></label><label class="field">版本<input name="version" maxlength="200" value="${E(draft.version)}"></label><label class="field">语言${languageSelect(draft.languages)}</label>${textWishes()?`<label class="field full">发起人<input name="initiator" required maxlength="200" value="${E(draft.initiator)}" placeholder="例如：🎸小明"></label><label class="field full">我也想排<textarea name="supporters" maxlength="1000" placeholder="例如：阿白、🥁小林">${E(draft.supporters)}</textarea></label>`:`<label class="field full">发起人<select name="initiator" required><option value="">请选择成员</option>${state.members.map(m=>`<option value="${m.id}" ${draft.initiator===m.id?'selected':''}>${E(m.label)}</option>`).join('')}</select></label><fieldset class="member-choices"><legend>我也想排</legend>${state.members.map(m=>`<label class="member-choice"><input type="checkbox" name="supporters" value="${m.id}" ${draft.supporters.includes(m.id)?'checked':''}>${E(m.label)}</label>`).join('')}</fieldset>`}</div></div><div class="editor-footer"><div>${wish?`<button type="button" class="button small danger" data-action="delete-wish" data-id="${wish.id}">删除愿望</button>`:''}</div><div class="actions"><button type="button" class="button" data-action="close-editor">取消</button><button type="submit" class="button primary">保存愿望</button></div></div></form>`;
  editor.showModal();
}

function visibleEvents() {
  const f = filters[view];
  return state.performances.filter(e => (view === 'history' ? e.status === '已完成' : e.status === (f.cancelled ? '已取消' : '计划中')) &&
    (!f.q || `${e.name} ${e.organizer} ${e.venue}`.toLowerCase().includes(f.q.toLowerCase())) &&
    (!f.language || e.languages.includes(f.language)) && (!f.year || e.date.startsWith(f.year)))
    .sort((a,b) => view === 'history' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
}

function eventTable(events) {
  if (!events.length) {
    const f = filters[view];
    const filtered = f.q || f.language || f.year || f.cancelled;
    return emptyState(filtered ? '没有符合条件的演出' : view === 'history' ? '把登台的日子留在这里' : '下一场演出，从这里开始', filtered ? '调整筛选条件后再看看。' : view === 'history' ? '完成演出后自动收录，也可以补录过去的演出。' : '填写演出信息，从曲库挑选歌单，为下一次登台做好准备。', filtered ? '<button class="button" data-action="reset-filters">清除筛选</button>' : `<button class="button primary" data-action="${view==='history'?'new-history':'new-event'}">＋ ${view==='history'?'补录历史演出':'新建演出'}</button>`);
  }
  return `<div class="table-wrap"><table><thead><tr><th>演出日期</th><th>演出名字</th><th>地点 / 主办方</th><th>语言</th><th>歌单</th><th>状态</th><th></th></tr></thead><tbody>${events.map(e => `<tr><td class="nowrap">${E(e.date)}</td><td><button class="event-title" data-action="detail" data-id="${e.id}">${E(e.name)}</button></td><td><div>${E(e.venue || '地点待定')}</div><div class="muted tiny">${E(e.organizer || '主办方待定')}</div></td><td>${tags(e.languages)}</td><td class="muted">${e.items.length} 首</td><td>${badge(displayStatus(e))}</td><td><button class="icon-button" data-action="detail" data-id="${e.id}">查看 ↗</button></td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>共 ${events.length} 场演出</span>${view==='upcoming'?'<span>演出结束后，确认实际歌单即可归档</span>':''}</div>`;
}

function renderEvents() {
  const history = view === 'history';
  const planned = state.performances.filter(e => e.status === '计划中');
  const completed = state.performances.filter(e => e.status === '已完成');
  const next = planned.find(e => e.date >= today());
  const f = filters[view];
  const relevant = state.performances.filter(e => history ? e.status === '已完成' : e.status !== '已完成');
  const langs = languageOptions;
  const years = [...new Set(relevant.map(e => e.date.slice(0,4)))].sort().reverse();
  let content = shellHeader(history ? '历史记录' : '未来演出', history ? 'ON THE RECORD' : 'UP NEXT', history ? '走过的舞台，唱过的每一首。' : '安排下一次登台，让每首歌找到位置。', `<button class="button primary" data-action="${history?'new-history':'new-event'}">＋ ${history?'补录历史演出':'新建演出'}</button>`);
  if (!history) {
    content += `<div class="stats"><div class="stat"><div><span class="stat-label">筹备中的演出</span><strong>${planned.length}</strong></div><span class="stat-symbol">▦</span></div><div class="stat"><div><span class="stat-label">可演曲目</span><strong>${state.songs.filter(s=>s.status==='可演').length}</strong></div><span class="stat-symbol">♫</span></div><div class="stat"><div><span class="stat-label">已完成演出</span><strong>${completed.length}</strong></div><span class="stat-symbol">◷</span></div></div>`;
    if (next) content += `<div class="next-show"><div><p class="eyebrow">NEXT ON STAGE / 下一场</p><h2>${E(next.name)}</h2><p>${E(next.venue || '地点待定')}　·　${E(next.organizer || '主办方待定')}　·　${next.items.length} 首曲目</p></div><div class="next-date">${E(next.date.slice(5).replace('-',' / '))}<small>${E(next.date.slice(0,4))}</small></div><button class="button" data-action="detail" data-id="${next.id}">查看演出 ↗</button></div>`;
  }
  content += `<div class="section-heading"><h2>${history?'演出档案':'演出安排'}</h2><span>${history?'按演出日期倒序':'按演出日期排序'}</span></div><div class="filters"><div class="search"><input id="search" aria-label="搜索演出" placeholder="搜索演出、主办方、地点…" value="${E(f.q)}"></div><select data-filter="language" aria-label="筛选语言">${options(langs,f.language,'全部分类')}</select><select data-filter="year" aria-label="筛选年份">${options(years,f.year,'全部年份')}</select>${!history?`<label class="check"><input type="checkbox" data-filter="cancelled" ${f.cancelled?'checked':''}>查看已取消</label>`:''}</div><div id="results">${eventTable(visibleEvents())}</div>`;
  return content;
}

function renderDetail(event) {
  const history = event.status === '已完成';
  const warnings = !history ? event.items.filter(i => i.current_status !== '可演') : [];
  return `<button class="back-button" data-action="back">← 返回${history?'历史记录':'演出安排'}</button>` + shellHeader(E(event.name), history ? 'PERFORMANCE ARCHIVE' : 'PERFORMANCE DETAILS', `${E(event.date)}　${badge(displayStatus(event))}`, `<button class="button" data-action="export-event" data-id="${event.id}">导出 Excel</button><button class="button" data-action="copy-event" data-id="${event.id}">复制为新演出</button><button class="button primary" data-action="edit-event" data-id="${event.id}">${history?'更正记录':'编辑演出'}</button>`) +
    `<div class="detail-card"><dl class="detail-meta">${[['演出日期',E(event.date)],['主办方',E(event.organizer || '待定')],['地点',E(event.venue || '待定')],['语言',tags(event.languages)],['歌单曲目',`${event.items.length} 首`],['最后保存',E(event.updated_at.slice(0,16).replace('T',' '))]].map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></div>` +
    (warnings.length ? `<div class="notice">歌单中有 ${warnings.length} 首曲目处于“大饼”或“取消”状态，请在演出前核对。</div>` : '') +
    `<div class="section-heading"><h2>${history?'实际演出歌单':'演出歌单'}</h2><span>${event.items.length} 首</span></div>` +
    (event.items.length ? `<div class="table-wrap"><table><thead><tr><th>顺序</th><th>曲目名称</th><th>版本</th><th>语言</th><th>本场备注</th>${history?'':'<th>曲目状态</th>'}</tr></thead><tbody>${event.items.map((i,n)=>`<tr><td class="muted">${String(n+1).padStart(2,'0')}</td><td><strong>${E(i.song.name)}</strong></td><td class="muted">${E(i.song.version)}</td><td>${tags(i.song.languages)}</td><td class="detail-note muted">${E(i.note || '—')}</td>${history?'':`<td>${badge(i.current_status)}</td>`}</tr>`).join('')}</tbody></table></div>` : emptyState('歌单还在等待第一首歌', '点击“编辑演出”，从曲库添加曲目。')) +
    (history ? '<p class="history-note">显示演出归档时的曲目信息。之后修改曲库不会改变这份记录。</p>' : '') +
    `<div class="section-heading actions"><button class="button small danger" data-action="delete-event" data-id="${event.id}">删除${history?'历史记录':'演出'}</button>${event.status==='计划中'?`<button class="button primary" data-action="complete-event" data-id="${event.id}">核对歌单并完成演出</button>`:''}</div>`;
}

function render() {
  $('#upcoming-count').textContent = state.performances.filter(e=>e.status==='计划中').length;
  $('#songs-count').textContent = state.songs.length;
  $('#wishlist-count').textContent = state.wishlist.length;
  $('#history-count').textContent = state.performances.filter(e=>e.status==='已完成').length;
  $$('nav button').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false');});
  $('#breadcrumb').textContent = `工作空间 / ${{upcoming:'未来演出',songs:'曲库',history:'历史记录',wishlist:'愿望单'}[view]}${detailId?' / 演出详情':''}`;
  const event = detailId && eventById(detailId);
  if (!event) detailId = null;
  $('#content').innerHTML = event ? renderDetail(event) : view === 'songs' ? renderSongs() : view === 'wishlist' ? renderWishes() : renderEvents();
}

function editorHeader(title, subtitle) {
  return `<div class="editor-header"><div><h2 id="editor-title">${title}</h2><p>${subtitle}</p></div><button type="button" class="icon-button" data-action="close-editor" aria-label="关闭编辑窗口">✕</button></div>`;
}

function openSong(id) {
  if (readonly) return;
  const song = id && songById(id);
  draft = song ? structuredClone(song) : {name:'',version:'原版',languages:[],status:'可演'};
  draft.generation = state.generation;
  dialogKind = 'song'; dirty = false;
  editor.className = 'narrow';
  $('#editor-content').innerHTML = `<form id="song-form">${editorHeader(song?'编辑曲目':'新增曲目','同一首歌的不同版本，请分别添加。')}<div class="editor-body"><div class="form-error" role="alert"></div><div class="form-grid"><label class="field full">曲目名称 <input name="name" required maxlength="200" placeholder="例如：晴天" value="${E(draft.name)}" autofocus></label><label class="field">版本<input name="version" maxlength="200" placeholder="原版 / Acoustic 版" value="${E(draft.version)}"></label><label class="field">状态<select name="status">${['可演','大饼','取消'].map(s=>`<option ${s===draft.status?'selected':''}>${s}</option>`).join('')}</select></label><label class="field full">语言${languageSelect(draft.languages)}</label></div></div><div class="editor-footer"><div>${song?`<button type="button" class="button small danger" data-action="delete-song" data-id="${song.id}">删除曲目</button>`:''}</div><div class="actions"><button type="button" class="button" data-action="close-editor">取消</button><button class="button primary" type="submit">保存曲目</button></div></div></form>`;
  editor.showModal();
}

function openEvent(id, {history=false, copy=false, complete=false} = {}) {
  if (readonly) return;
  const original = id && eventById(id);
  draft = original ? structuredClone(original) : {name:'',date:history?today():'',organizer:'',venue:'',languages:[],status:history?'已完成':'计划中',items:[]};
  if (copy) {
    delete draft.id; delete draft.revision;
    draft.name += '（副本）'; draft.date = ''; draft.status = '计划中';
    draft.items = draft.items.filter(i=>songById(i.song_id)?.status!=='取消').map(i=>({song_id:i.song_id,note:i.note,song:structuredClone(songById(i.song_id))}));
  }
  draft.generation = state.generation;
  dialogKind = 'event'; dirty = copy;
  editor.className = '';
  const archived = draft.status === '已完成';
  const title = copy ? '复制为新演出' : complete ? '核对实际歌单' : original ? archived?'更正历史记录':'编辑演出' : history?'补录历史演出':'新建演出';
  $('#editor-content').innerHTML = `<form id="event-form">${editorHeader(title,archived?'保存实际演出的信息、顺序与备注。':'先安排演出信息，再从曲库编排歌单。')}<div class="editor-body"><div class="form-error" role="alert"></div>${copy?'<div class="notice info">已复制可用曲目及备注。请填写新日期；已取消曲目未加入新歌单。</div>':''}${complete?'<div class="notice">请移除临时取消的曲目，调整实际顺序。确认后点击“完成并归档”。</div>':''}<div class="form-grid"><label class="field">演出名字<input name="name" required maxlength="200" placeholder="例如：秋日专场" value="${E(draft.name)}" autofocus></label><label class="field">演出日期<input type="date" name="date" required value="${E(draft.date)}" ${archived?'max="'+today()+'"':''}></label><label class="field">主办方<input name="organizer" maxlength="500" placeholder="可先留空，之后补充" value="${E(draft.organizer)}"></label><label class="field">地点<input name="venue" maxlength="500" placeholder="场地名称 / 地址" value="${E(draft.venue)}"></label><label class="field">语言${languageSelect(draft.languages)}</label><label class="field">演出状态<select name="status" ${archived?'disabled':''}>${(archived?['已完成']:['计划中','已取消']).map(s=>`<option ${s===draft.status?'selected':''}>${s}</option>`).join('')}</select></label></div><div class="composer"><section><h3>从曲库选曲</h3><div class="search"><input id="picker-search" aria-label="搜索歌单候选曲目" placeholder="搜索名称、版本…"></div><label class="check"><input id="picker-all" type="checkbox" ${archived?'checked':''}>${archived?'显示全部曲目':'包含大饼'}</label><div id="picker-list" class="picker-list"></div></section><section><h3>${archived||complete?'实际演出歌单':'演出歌单'}<span class="count-label" id="setlist-count"></span></h3><div id="setlist"></div></section></div></div><div class="editor-footer"><span class="muted tiny">${archived?'历史更正只影响本场记录':'保存后可随时继续调整'}</span><div class="actions"><button type="button" class="button" data-action="close-editor">取消</button><button type="submit" class="button ${complete?'':'primary'}" value="save">${archived?'保存历史记录':'保存演出'}</button>${!archived&&draft.status==='计划中'?'<button type="submit" class="button '+(complete?'primary':'')+'" value="complete">完成并归档</button>':''}</div></div></form>`;
  renderPicker(); renderSetlist();
  editor.showModal();
}

function renderPicker() {
  const q = $('#picker-search').value.toLowerCase();
  const all = $('#picker-all').checked;
  const archived = draft.status === '已完成';
  const songs = state.songs.filter(s => (s.status === '可演' || all && (archived || s.status === '大饼')) && `${s.name} ${s.version}`.toLowerCase().includes(q));
  $('#picker-list').innerHTML = songs.length ? songs.map(s=>`<div class="picker-row"><div><strong>${E(s.name)}</strong><p>${E(s.version)} · ${E(s.languages.join(' / '))} ${s.status!=='可演'?badge(s.status):''}</p></div><button type="button" data-action="add-item" data-id="${s.id}" aria-label="添加 ${E(s.name)} ${E(s.version)}">＋</button></div>`).join('') : '<div class="setlist-empty">没有可选曲目。<br>请先在曲库中添加，或调整筛选。</div>';
}

function renderSetlist() {
  $('#setlist-count').textContent = `${draft.items.length} 首`;
  $('#setlist').innerHTML = draft.items.length ? draft.items.map((item,i)=>{
    const song = item.snapshot || item.song || songById(item.song_id);
    const current = songById(item.song_id);
    return `<div class="setlist-row"><span class="order-number">${String(i+1).padStart(2,'0')}</span><div class="setlist-main"><strong>${E(song.name)}</strong><p>${E(song.version)} · ${E(song.languages.join(' / '))} ${draft.status!=='已完成'&&current.status!=='可演'?badge(current.status):''}</p>${draft.status==='已完成'&&item.snapshot?`<details><summary class="tiny muted">更正本场曲目文字</summary><div class="snapshot-fields"><input data-snapshot="name" data-index="${i}" aria-label="历史曲目名称 ${i+1}" required maxlength="200" value="${E(song.name)}"><input data-snapshot="version" data-index="${i}" aria-label="历史曲目版本 ${i+1}" required maxlength="200" value="${E(song.version)}">${languageSelect(song.languages,`data-snapshot="languages" data-index="${i}" aria-label="历史曲目语言 ${i+1}"`)}</div></details>`:''}<textarea data-note="${i}" aria-label="第 ${i+1} 首本场备注" maxlength="2000" placeholder="本场备注，如：返场、前奏缩短">${E(item.note)}</textarea></div><div class="setlist-controls"><button type="button" class="icon-button" data-action="move-up" data-index="${i}" ${i===0?'disabled':''} aria-label="上移第 ${i+1} 首">↑</button><button type="button" class="icon-button" data-action="move-down" data-index="${i}" ${i===draft.items.length-1?'disabled':''} aria-label="下移第 ${i+1} 首">↓</button><button type="button" class="icon-button" data-action="remove-item" data-index="${i}" aria-label="移除第 ${i+1} 首">×</button></div></div>`;
  }).join('') : '<div class="setlist-empty">从曲库添加第一首歌。<br>用上下按钮调整顺序，每首歌都可以填写备注。</div>';
}

async function saveForm(event) {
  event.preventDefault();
  const form = event.target;
  const box = $('.form-error', form);
  box.textContent = '';
  const data = new FormData(form);
  const payload = {...draft, name:data.get('name'), languages:languagesFromText(data.get('languages'))};
  const kind = dialogKind;
  if (kind === 'wish') {
    payload.version = data.get('version'); payload.initiator = data.get('initiator'); payload.supporters = textWishes()?data.get('supporters'):data.getAll('supporters');
  } else if (kind === 'song') {
    payload.version = data.get('version'); payload.status = data.get('status');
  } else {
    Object.assign(payload, {date:data.get('date'),organizer:data.get('organizer'),venue:data.get('venue'),status:data.get('status') || '已完成'});
    if (event.submitter?.value === 'complete') {
      if (!await confirmAction('确认实际歌单并归档？', '当前歌单将保存为实际演出记录。之后修改曲库不会改变本场历史。', '完成并归档')) return;
      payload.status = '已完成';
    }
  }
  const buttons = $$('button',form);
  buttons.forEach(b=>b.disabled=true);
  try {
    const result = await request(`/api/${kind==='wish'?'wishlist':kind==='song'?'songs':'performances'}${draft.id?'/'+draft.id:''}`, payload);
    await closeEditor(true);
    if (kind==='event') { detailId=result.id; view=payload.status==='已完成'?'history':'upcoming'; location.hash=view; }
    await refresh(); toast('已保存');
  } catch(e) {
    box.textContent = e.message;
    box.scrollIntoView({block:'nearest'});
  } finally { buttons.forEach(b=>b.disabled=false); if(editor.open && dialogKind==='event') renderSetlist(); }
}

function openBackup() {
  if (readonly) return;
  dialogKind = 'backup'; dirty = false; editor.className='narrow';
  $('#editor-content').innerHTML = `${editorHeader('备份与恢复','备份包含当前乐队的全部曲目、演出、历史歌单和愿望单。')}<div class="editor-body"><section class="backup-section"><h3>保存完整备份</h3><p>下载网页版 JSON 备份，建议另存到移动硬盘或云盘。Excel 用于分享歌单，数据库备份用于恢复全部内容。</p><button class="button primary" data-action="download-backup">下载备份</button></section><section class="backup-section"><h3>从备份恢复</h3><p>恢复会替换当前乐队的数据。应用会在数据库中保留最近一次恢复前的备份。</p><input class="file-input" id="restore-file" type="file" accept=".json,application/json" aria-label="选择数据库备份"><button class="button danger" data-action="restore">恢复所选备份</button><button class="button" data-action="previous-backup">下载最近一次恢复前的备份</button></section><p class="muted tiny">数据保存在云端。旧版 JSON 备份不包含愿望单，恢复时会保留现有愿望。网页版使用 JSON 备份；本地版的 SQLite 备份需要转换后导入。</p></div><div class="editor-footer"><span></span><button class="button" data-action="close-editor">完成</button></div>`;
  editor.showModal();
}

async function action(name, el) {
  const id = el.dataset.id;
  if (readonly && ['move-wish','new-wish','edit-wish','delete-wish','new-song','edit-song','new-event','new-history','edit-event','copy-event','complete-event','delete-song','delete-event','restore','download-backup','previous-backup'].includes(name)) return;
  if(name==='move-wish') {
    const record=wishById(id), payload={generation:state.generation,revision:record.revision};
    el.disabled=true;
    try {
      if(!await confirmAction('加入曲库？',`“${record.name}”（${record.version}）将以“大饼”状态加入曲库，并从愿望单移除。`,'加入曲库'))return;
      await request(`/api/wishlist/${id}/move-to-songs`,payload);
      await refresh();toast('已加入曲库，状态为“大饼”');
    } finally {el.disabled=false;}
    return;
  }
  if(name==='new-wish')return openWish();
  if(name==='edit-wish')return openWish(id);
  if(name==='sort-wishes') {
    const key=el.dataset.key;
    wishSort.direction=wishSort.key===key && wishSort.direction==='asc'?'desc':'asc';wishSort.key=key;
    $('#results').innerHTML=wishTable(visibleWishes());
    $(`[data-action="sort-wishes"][data-key="${key}"]`)?.focus({preventScroll:true});return;
  }
  if(name==='delete-wish') {
    const record=wishById(id);
    if(!await confirmAction('删除愿望？',`“${record.name}”及其发起人、支持名单将被删除。`,'删除',true))return;
    await request(`/api/wishlist/${id}/delete`,{generation:draft.generation,revision:draft.revision});
    await closeEditor(true);await refresh();toast('已删除');return;
  }
  if(name==='export-wishes' || name==='export-wishes-filtered') {
    el.disabled=true;
    try {await request('/api/export/wishlist',{generation:state.generation,ids:name==='export-wishes'?null:visibleWishes().map(w=>w.id)},{download:true});toast('愿望单已导出，请查看浏览器下载');}
    finally {el.disabled=false;}return;
  }
  if (name==='sort-songs') {
    const key = el.dataset.key;
    songSort.direction = songSort.key === key && songSort.direction === 'asc' ? 'desc' : 'asc';
    songSort.key = key;
    renderSongSort(`[data-action="sort-songs"][data-key="${key}"]`);
    return;
  }
  if (name==='new-song') return openSong();
  if (name==='edit-song') return openSong(id);
  if (name==='new-event') return openEvent();
  if (name==='new-history') return openEvent(null,{history:true});
  if (name==='edit-event') return openEvent(id);
  if (name==='copy-event') return openEvent(id,{copy:true});
  if (name==='complete-event') return openEvent(id,{complete:true});
  if (name==='close-editor') return closeEditor();
  if (name==='detail') { detailId=id; render(); window.scrollTo(0,0); return; }
  if (name==='back') { detailId=null; render(); return; }
  if (name==='reset-filters') {
    Object.keys(filters[view]).forEach(k=>filters[view][k]=typeof filters[view][k]==='boolean'?false:'');
    render(); return;
  }
  if (['add-item','move-up','move-down','remove-item'].includes(name)) {
    const i = Number(el.dataset.index);
    if (name==='add-item') draft.items.push({song_id:id,note:'',song:structuredClone(songById(id))});
    else if(name==='remove-item') draft.items.splice(i,1);
    else { const j = i + (name==='move-up'?-1:1); if(j<0||j>=draft.items.length)return; [draft.items[i],draft.items[j]]=[draft.items[j],draft.items[i]]; }
    dirty=true; renderSetlist(); return;
  }
  if (name==='delete-song' || name==='delete-event') {
    const record = name==='delete-song'?songById(id):eventById(id);
    const noun = name==='delete-song'?'曲目':'演出记录';
    if(!await confirmAction(`删除${noun}？`,`“${record.name}”将被删除。${name==='delete-event'?'本场歌单也会删除，曲库中的曲目会保留。':'已被演出引用的曲目不能删除，可改为取消。'}`,'删除',true))return;
    await request(`/api/${name==='delete-song'?'songs':'performances'}/${id}/delete`, {generation:state.generation,revision:record.revision});
    if(editor.open)await closeEditor(true); detailId=null; await refresh(); toast('已删除'); return;
  }
  if (name==='export-all' || name==='export-filtered') {
    el.disabled=true;
    try { await request('/api/export/songs',{generation:state.generation,ids:name==='export-all'?null:visibleSongs().map(s=>s.id)},{download:true}); toast('Excel 已导出，请查看浏览器下载'); }
    finally {el.disabled=false;} return;
  }
  if (name==='export-event') {
    await request(`/api/export/performances/${id}`,{generation:state.generation},{download:true}); toast('演出歌单已导出，请查看浏览器下载'); return;
  }
  if (name==='previous-backup') {
    await request('/api/backup/previous',{}, {download:true}); toast('备份已下载'); return;
  }
  if (name==='download-backup') {
    await request('/api/backup',{}, {download:true}); toast('备份已下载'); return;
  }
  if (name==='restore') {
    const file = $('#restore-file').files[0];
    if(!file)throw new Error('请先选择网页版 JSON 备份文件');
    if(file.size>2*1024*1024)throw new Error('备份文件不能超过 2 MB');
    if(!await confirmAction('用备份替换当前数据？',`即将恢复“${file.name}”。云端会保留最近一次恢复前的数据。`,'恢复备份',true))return;
    el.disabled=true;
    try { await request('/api/restore',file,{raw:true}); await closeEditor(true); detailId=null; await refresh(); toast('恢复成功，恢复前的数据已自动备份'); }
    finally {el.disabled=false;} return;
  }
}

document.addEventListener('click',event=>{
  const target = event.target.closest('[data-action]');
  if(target)run(()=>action(target.dataset.action,target));
});
document.addEventListener('submit',event=>{if(['song-form','event-form','wish-form'].includes(event.target.id)){event.preventDefault();run(()=>saveForm(event));}});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='search') { filters[view].q=el.value; $('#results').innerHTML=view==='songs'?songTable(visibleSongs()):view==='wishlist'?wishTable(visibleWishes()):eventTable(visibleEvents()); }
  if(el.id==='picker-search')renderPicker();
  if(editor.contains(el) && dialogKind!=='backup' && !['picker-search','picker-all'].includes(el.id))dirty=true;
  if(el.dataset.note!==undefined)draft.items[Number(el.dataset.note)].note=el.value;
  if(el.dataset.snapshot)draft.items[Number(el.dataset.index)].snapshot[el.dataset.snapshot]=el.dataset.snapshot==='languages'?languagesFromText(el.value):el.value;
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='experience-sort') {
    const [key, direction] = el.value.split(':');
    songSort.key = key;
    songSort.direction = direction || 'asc';
    renderSongSort('#experience-sort');
  }
  if(el.dataset.filter) {filters[view][el.dataset.filter]=el.type==='checkbox'?el.checked:el.value;render();}
  if(el.id==='picker-all')renderPicker();
});
editor.addEventListener('cancel',event=>{event.preventDefault();run(()=>closeEditor());});
$$('nav button').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;detailId=null;location.hash=view;render();}));
$('.brand').addEventListener('click',event=>{if(stopped){event.preventDefault();return;}view='upcoming';detailId=null;render();});
$('#platform-link').hidden=$('meta[name="platform-admin"]').content!=='yes';
$('#backup-open').addEventListener('click',openBackup);
$('#quit').addEventListener('click',()=>run(async()=>{
  if(dirty && !await closeEditor())return;
  await request('/api/logout',{});
  stopped=true; dirty=false; location.replace('/login');
}));
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('hashchange',()=>{if(!detailId&&!stopped){view=['songs','history','wishlist'].includes(location.hash.slice(1))?location.hash.slice(1):'upcoming';render();}});
window.addEventListener('focus',()=>{if(!editor.open&&!stopped)run(refresh);});
refresh().catch(e=>{ $('#content').innerHTML=emptyState('暂时无法连接',E(e.message),'<a class="button" href="/login" target="_blank" rel="noopener">重新登录</a><button class="button" data-action="retry">重试连接</button>'); toast(e.message,true); });
document.addEventListener('click',e=>{if(e.target.closest('[data-action="retry"]'))run(refresh);});
