"""SQLite storage and the band's three business entities. No external packages."""
import json
import sqlite3
import threading
from contextlib import closing
from datetime import date, datetime
from pathlib import Path
from uuid import uuid4

APP_ID = 0x534F4E47
SCHEMA_VERSION = 1
SONG_STATUSES = ('可演', '大饼', '取消')
EVENT_STATUSES = ('计划中', '已完成', '已取消')


class ValidationError(ValueError):
    pass


class Conflict(ValidationError):
    pass


def now():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def text(value, label, required=False, limit=500):
    if not isinstance(value, str):
        raise ValidationError(f'{label}需要填写文字')
    value = value.strip()
    if required and not value:
        raise ValidationError(f'请填写{label}')
    if len(value) > limit or any(ord(c) < 32 and c not in '\n\t\r' for c in value):
        raise ValidationError(f'{label}过长或包含不支持的字符')
    return value


def languages(value):
    if not isinstance(value, list) or not value or len(value) > 20:
        raise ValidationError('请填写至少一种语言（纯音乐可填写“纯音乐”）')
    return list(dict.fromkeys(text(v, '语言', True, 40) for v in value))


def song_fields(data):
    status = data.get('status', '可演')
    if status not in SONG_STATUSES:
        raise ValidationError('曲目状态无效')
    return dict(name=text(data.get('name'), '曲目名称', True, 200),
                version=text(data.get('version', ''), '版本', limit=200) or '原版',
                languages=languages(data.get('languages')), status=status)


def event_fields(data):
    raw_date = text(data.get('date'), '演出日期', True, 10)
    try:
        parsed = date.fromisoformat(raw_date)
    except ValueError:
        raise ValidationError('请选择有效的演出日期') from None
    if raw_date != parsed.isoformat():
        raise ValidationError('日期格式应为 YYYY-MM-DD')
    status = data.get('status', '计划中')
    if status not in EVENT_STATUSES:
        raise ValidationError('演出状态无效')
    if status == '已完成' and parsed > date.today():
        raise ValidationError('未来日期的演出暂时不能归档，请先核对日期')
    return dict(date=raw_date, name=text(data.get('name'), '演出名字', True, 200),
                organizer=text(data.get('organizer', ''), '主办方'),
                venue=text(data.get('venue', ''), '地点'),
                languages=languages(data.get('languages')), status=status)


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'songs.sqlite3'
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        if self.db.execute('PRAGMA user_version').fetchone()[0] not in (0, SCHEMA_VERSION):
            raise ValidationError('数据库版本不兼容，请使用创建它的应用版本')
        self.db.executescript(f'''
            PRAGMA application_id={APP_ID};
            PRAGMA user_version={SCHEMA_VERSION};
            CREATE TABLE IF NOT EXISTS songs (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
                languages TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('可演','大饼','取消')),
                revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS performances (
                id TEXT PRIMARY KEY, date TEXT NOT NULL, name TEXT NOT NULL,
                organizer TEXT NOT NULL, venue TEXT NOT NULL, languages TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('计划中','已完成','已取消')),
                completed_at TEXT, revision INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS setlist_items (
                id TEXT PRIMARY KEY, performance_id TEXT NOT NULL REFERENCES performances(id) ON DELETE CASCADE,
                song_id TEXT NOT NULL REFERENCES songs(id), position INTEGER NOT NULL,
                note TEXT NOT NULL, snapshot TEXT,
                UNIQUE(performance_id, position)
            );
            CREATE INDEX IF NOT EXISTS setlist_song ON setlist_items(song_id);
        ''')
        # A random generation changes after a restore, invalidating open editors.
        self.generation = uuid4().hex

    def close(self):
        self.db.close()

    @staticmethod
    def decode(row):
        result = dict(row)
        for field in ('languages', 'snapshot'):
            if field in result and result[field] is not None:
                result[field] = json.loads(result[field])
        return result

    def state(self):
        songs = [self.decode(r) for r in self.db.execute('SELECT * FROM songs ORDER BY created_at DESC, id')]
        by_id = {s['id']: s for s in songs}
        events = [self.decode(r) for r in self.db.execute('SELECT * FROM performances ORDER BY date, created_at')]
        by_event = {e['id']: e for e in events}
        for s in songs:
            s['played_count'] = 0
            s['last_played'] = None
        for e in events:
            e['items'] = []
        counted = set()
        for row in self.db.execute('SELECT * FROM setlist_items ORDER BY position'):
            item = self.decode(row)
            event = by_event[item['performance_id']]
            song = by_id[item['song_id']]
            item['song'] = item['snapshot'] or {k: song[k] for k in ('name', 'version', 'languages')}
            item['current_status'] = song['status']
            event['items'].append(item)
            key = (event['id'], song['id'])
            if event['status'] == '已完成' and key not in counted:
                counted.add(key)
                song['played_count'] += 1
                song['last_played'] = max(song['last_played'] or '', event['date'])
        return dict(songs=songs, performances=events, generation=self.generation)

    def check_generation(self, data):
        if data.get('generation') != self.generation:
            raise Conflict('数据已恢复或应用已重启，请刷新页面后再编辑')

    def existing(self, table, identifier, data):
        row = self.db.execute(f'SELECT * FROM {table} WHERE id=?', (identifier,)).fetchone()
        if row is None:
            raise Conflict('这条记录已经不存在，请刷新页面')
        if data.get('revision') != row['revision']:
            raise Conflict('这条记录已在其他窗口更新，请刷新后重新编辑；当前修改尚未保存')
        return self.decode(row)

    def save_song(self, data, identifier=None):
        self.check_generation(data)
        fields = song_fields(data)
        with self.db:
            if identifier:
                self.existing('songs', identifier, data)
                self.db.execute('UPDATE songs SET name=?,version=?,languages=?,status=?,revision=revision+1,updated_at=? WHERE id=?',
                                (fields['name'], fields['version'], json.dumps(fields['languages'], ensure_ascii=False), fields['status'], now(), identifier))
            else:
                identifier = uuid4().hex
                self.db.execute('INSERT INTO songs VALUES (?,?,?,?,?,1,?,?)',
                                (identifier, fields['name'], fields['version'], json.dumps(fields['languages'], ensure_ascii=False), fields['status'], now(), now()))
        return identifier

    def save_performance(self, data, identifier=None):
        self.check_generation(data)
        fields = event_fields(data)
        items = data.get('items')
        if not isinstance(items, list) or len(items) > 500:
            raise ValidationError('歌单格式无效，单场最多支持 500 条曲目')
        if fields['status'] == '已完成' and not items:
            raise ValidationError('请先确认实际演出的歌单，再完成归档')
        with self.db:
            old = self.existing('performances', identifier, data) if identifier else None
            if old and old['status'] == '已完成' and fields['status'] != '已完成':
                raise ValidationError('历史演出请使用“更正记录”；需要安排新演出时请复制')
            previous = {r['id']: self.decode(r) for r in self.db.execute('SELECT * FROM setlist_items WHERE performance_id=?', (identifier,))}
            prepared = []
            seen_ids = set()
            for i, item in enumerate(items):
                if not isinstance(item, dict):
                    raise ValidationError('歌单条目格式无效')
                song_row = self.db.execute('SELECT * FROM songs WHERE id=?', (item.get('song_id'),)).fetchone()
                if song_row is None:
                    raise ValidationError('歌单中的曲目已不存在，请重新选择')
                song = self.decode(song_row)
                prior = previous.get(item.get('id'))
                same = prior and prior['song_id'] == song['id']
                if fields['status'] == '计划中' and song['status'] == '取消' and not same:
                    raise ValidationError(f'“{song["name"]}”已取消，请选择其他曲目或先修改曲目状态')
                item_id = prior['id'] if same else uuid4().hex
                if item_id in seen_ids:
                    raise ValidationError('歌单条目标识重复')
                seen_ids.add(item_id)
                snapshot = None
                if fields['status'] == '已完成':
                    if old and old['status'] == '已完成' and same:
                        snapshot = item.get('snapshot', prior['snapshot'])
                        if not isinstance(snapshot, dict):
                            raise ValidationError('历史曲目信息无效')
                        snapshot = dict(name=text(snapshot.get('name'), '历史曲目名称', True, 200),
                                        version=text(snapshot.get('version'), '历史版本', True, 200),
                                        languages=languages(snapshot.get('languages')))
                    else:
                        snapshot = {k: song[k] for k in ('name', 'version', 'languages')}
                prepared.append((item_id, song['id'], i, text(item.get('note', ''), '本场备注', limit=2000),
                                 json.dumps(snapshot, ensure_ascii=False) if snapshot else None))
            identifier = identifier or uuid4().hex
            completed = (old and old['completed_at']) or (now() if fields['status'] == '已完成' else None)
            args = (fields['date'], fields['name'], fields['organizer'], fields['venue'], json.dumps(fields['languages'], ensure_ascii=False), fields['status'], completed)
            if old:
                self.db.execute('UPDATE performances SET date=?,name=?,organizer=?,venue=?,languages=?,status=?,completed_at=?,revision=revision+1,updated_at=? WHERE id=?', args + (now(), identifier))
                self.db.execute('DELETE FROM setlist_items WHERE performance_id=?', (identifier,))
            else:
                self.db.execute('INSERT INTO performances VALUES (?,?,?,?,?,?,?,?,1,?,?)', (identifier,) + args + (now(), now()))
            self.db.executemany('INSERT INTO setlist_items VALUES (?,?,?,?,?,?)',
                                [(row[0], identifier, *row[1:]) for row in prepared])
        return identifier

    def delete(self, kind, identifier, data):
        self.check_generation(data)
        table = 'songs' if kind == 'songs' else 'performances'
        with self.db:
            self.existing(table, identifier, data)
            if table == 'songs' and self.db.execute('SELECT 1 FROM setlist_items WHERE song_id=?', (identifier,)).fetchone():
                raise ValidationError('这首曲目已被演出引用，请将状态改为“取消”，以保留演出记录')
            self.db.execute(f'DELETE FROM {table} WHERE id=?', (identifier,))

    def backup(self, destination):
        with closing(sqlite3.connect(destination)) as target:
            self.db.backup(target)

    def restore(self, source):
        """Validate in a separate connection; preserve the current DB before replacing it."""
        try:
            with closing(sqlite3.connect(f'file:{Path(source).resolve()}?mode=ro', uri=True)) as candidate:
                candidate.row_factory = sqlite3.Row
                if candidate.execute('PRAGMA application_id').fetchone()[0] != APP_ID or candidate.execute('PRAGMA user_version').fetchone()[0] != SCHEMA_VERSION:
                    raise ValidationError('请选择本应用导出的数据库备份（.sqlite3），Excel 文件不能用于恢复')
                if candidate.execute('PRAGMA quick_check').fetchone()[0] != 'ok' or candidate.execute('PRAGMA foreign_key_check').fetchall():
                    raise ValidationError('备份文件已损坏或记录关联不完整')
                expected = {r['name']: r['sql'] for r in self.db.execute("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")}
                actual = {r['name']: r['sql'] for r in candidate.execute("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")}
                if expected != actual:
                    raise ValidationError('备份结构不匹配，无法恢复')
                for row in candidate.execute('SELECT * FROM songs'):
                    song_fields(self.decode(row))
                for row in candidate.execute('SELECT * FROM performances'):
                    event_fields(self.decode(row))
                for row in candidate.execute('SELECT i.*,p.status FROM setlist_items i JOIN performances p ON p.id=i.performance_id'):
                    item = self.decode(row)
                    text(item['note'], '本场备注', limit=2000)
                    if item['status'] == '已完成':
                        snap = item['snapshot']
                        if not isinstance(snap, dict):
                            raise ValidationError('历史歌单缺少归档信息')
                        song_fields({**snap, 'status': '可演'})
                    elif item['snapshot'] is not None:
                        raise ValidationError('规划歌单包含无效归档信息')
                backups = self.directory / 'backups'
                backups.mkdir(exist_ok=True)
                preserved = backups / f'恢复前_{datetime.now():%Y%m%d_%H%M%S_%f}.sqlite3'
                self.backup(preserved)
                candidate.backup(self.db)
                self.generation = uuid4().hex
                return preserved.name
        except (sqlite3.DatabaseError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise ValidationError('备份无法读取，请选择本应用导出的完整数据库备份') from exc
