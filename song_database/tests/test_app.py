import http.client
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from contextlib import closing
from datetime import date, timedelta
from io import BytesIO
from xml.etree import ElementTree as ET
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from store import Store, ValidationError, Conflict
from excel import export_performance, export_songs, NS
from app import Application


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'data')

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def song(self, **changes):
        payload = dict(name='晴天', version='原版', languages=['国语'], status='可演', generation=self.store.generation)
        payload.update(changes)
        return self.store.save_song(payload)

    def event(self, ids, **changes):
        payload = dict(name='秋日专场', date=date.today().isoformat(), organizer='音乐社', venue='小剧场', languages=['国语','英语'],
                       status='计划中', items=[{'song_id':i,'note':''} for i in ids], generation=self.store.generation)
        payload.update(changes)
        return self.store.save_performance(payload)

    def find_event(self, identifier):
        return next(e for e in self.store.state()['performances'] if e['id']==identifier)

    def save_event(self, event):
        return self.store.save_performance({**event,'generation':self.store.generation},event['id'])

    def test_versions_order_snapshots_and_reopen(self):
        first = self.song()
        acoustic = self.song(version='Acoustic 版')
        event_id = self.event([acoustic,first])
        event = self.find_event(event_id)
        event['items'][0]['note']='前奏缩短\n返场'
        event['status']='已完成'
        self.save_event(event)
        current = next(s for s in self.store.state()['songs'] if s['id']==acoustic)
        self.store.save_song({**current,'name':'改名后的歌','version':'新版本','languages':['英语'],'status':'取消','generation':self.store.generation},acoustic)
        archived = self.find_event(event_id)
        self.assertEqual([i['song_id'] for i in archived['items']],[acoustic,first])
        self.assertEqual(archived['items'][0]['song']['name'],'晴天')
        self.assertEqual(archived['items'][0]['song']['version'],'Acoustic 版')
        self.assertEqual(archived['items'][0]['note'],'前奏缩短\n返场')
        before = self.store.state()
        self.store.close(); self.store=Store(Path(self.temp.name)/'data')
        self.assertEqual(before['songs'], self.store.state()['songs'])
        self.assertEqual(before['performances'], self.store.state()['performances'])

    def test_stale_revision_and_restore_generation(self):
        song = self.song()
        old = self.store.state()['songs'][0]
        self.store.save_song({**old,'name':'新版','generation':self.store.generation},song)
        with self.assertRaises(Conflict):
            self.store.save_song({**old,'name':'旧窗口','generation':self.store.generation},song)
        with self.assertRaises(Conflict):
            self.store.save_song({**old,'generation':'old-generation'})

    def test_failed_event_save_is_atomic(self):
        s = self.song()
        event = self.find_event(self.event([s]))
        before = self.store.state()
        event['name']='不能落盘'
        event['items'].append({'song_id':'missing','note':''})
        with self.assertRaises(ValidationError): self.save_event(event)
        self.assertEqual(before,self.store.state())

    def test_cancelled_song_history_and_referenced_delete(self):
        cancelled = self.song(status='取消')
        with self.assertRaises(ValidationError): self.event([cancelled])
        self.event([cancelled], status='已完成')
        s = self.store.state()['songs'][0]
        self.assertEqual(s['played_count'],1)
        with self.assertRaises(ValidationError): self.store.delete('songs',cancelled,{**s,'generation':self.store.generation})
        free = self.song(name='误录')
        self.store.delete('songs',free,{'revision':1,'generation':self.store.generation})

    def test_plan_uses_latest_metadata_history_corrections_are_local(self):
        s = self.song()
        event = self.find_event(self.event([s]))
        song = self.store.state()['songs'][0]
        self.store.save_song({**song,'name':'演出前改名','generation':self.store.generation},s)
        event['status']='已完成'; self.save_event(event)
        event = self.find_event(event['id'])
        self.assertEqual(event['items'][0]['song']['name'],'演出前改名')
        event['items'][0]['snapshot']['name']='历史更正名'
        self.save_event(event)
        self.assertEqual(self.find_event(event['id'])['items'][0]['song']['name'],'历史更正名')
        self.assertEqual(self.store.state()['songs'][0]['name'],'演出前改名')

    def test_completion_validation_and_played_count_per_show(self):
        s = self.song()
        with self.assertRaises(ValidationError): self.event([],status='已完成')
        with self.assertRaises(ValidationError): self.event([s],status='已完成',date=(date.today()+timedelta(days=1)).isoformat())
        self.event([s],status='已取消')
        self.assertEqual(self.store.state()['songs'][0]['played_count'],0)
        self.event([s,s],status='已完成')
        self.assertEqual(self.store.state()['songs'][0]['played_count'],1)

    def test_backup_restore_and_invalid_file_preserve_current_data(self):
        s = self.song()
        self.event([s],status='已完成')
        expected = self.store.state()
        backup = Path(self.temp.name)/'backup.sqlite3'
        self.store.backup(backup)
        self.song(name='恢复前新增')
        current = self.store.state()
        invalid = Path(self.temp.name)/'invalid.sqlite3'; invalid.write_bytes(b'not a database')
        with self.assertRaises(ValidationError): self.store.restore(invalid)
        self.assertEqual(current,self.store.state())
        preserved = self.store.restore(backup)
        self.assertEqual(expected['songs'],self.store.state()['songs'])
        self.assertEqual(expected['performances'],self.store.state()['performances'])
        self.assertNotEqual(expected['generation'],self.store.generation)
        with closing(sqlite3.connect(self.store.directory/'backups'/preserved)) as previous:
            self.assertEqual(previous.execute('SELECT COUNT(*) FROM songs').fetchone()[0],2)

    def test_xlsx_types_escaping_order_and_panes(self):
        s = self.song(name='=HYPERLINK("https://example.test")',version='A & B <原版>')
        self.event([s],status='已完成')
        event = self.store.state()['performances'][0]
        with ZipFile(BytesIO(export_performance(event))) as archive:
            self.assertIsNone(archive.testzip())
            roots = {n:ET.fromstring(archive.read(n)) for n in archive.namelist() if n.endswith('.xml')}
            sheet = roots['xl/worksheets/sheet2.xml']
            self.assertEqual(sheet.find(f'.//{{{NS}}}pane').get('ySplit'),'5')
            self.assertFalse(sheet.findall(f'.//{{{NS}}}f'))
            texts = [e.text for e in sheet.findall(f'.//{{{NS}}}t')]
            self.assertIn('=HYPERLINK("https://example.test")',texts)
            self.assertIn('A & B <原版>',texts)
            self.assertNotIn('曲目状态',texts)
            date_cell = roots['xl/worksheets/sheet1.xml'].find(f'.//{{{NS}}}c[@r="B6"]')
            self.assertEqual(date_cell.get('s'),'5')
            self.assertIsNotNone(date_cell.find(f'{{{NS}}}v'))
        with ZipFile(BytesIO(export_songs([]))) as archive:
            ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = Application(self.temp.name)
        self.thread = threading.Thread(target=self.app.serve_forever)
        self.thread.start()

    def tearDown(self):
        self.app.shutdown(); self.thread.join()
        self.app.server_close(); self.app.store.close(); self.temp.cleanup()

    def request(self, method, path, data=None, authorized=True, extra=None):
        conn = http.client.HTTPConnection('127.0.0.1',self.app.server_port,timeout=5)
        headers = {'Content-Type':'application/json'}
        if authorized: headers['X-App-Token']=self.app.token
        headers.update(extra or {})
        conn.request(method,path,data if isinstance(data,bytes) else json.dumps(data) if data is not None else None,headers)
        response = conn.getresponse(); body=response.read(); status=response.status
        conn.close(); return status,body

    def test_http_roundtrip_and_local_access_boundaries(self):
        status, page = self.request('GET','/')
        self.assertEqual(status,200); self.assertIn(self.app.token.encode(),page)
        self.assertEqual(self.request('GET','/api/state',authorized=False)[0],403)
        self.assertEqual(self.request('GET','/api/state',extra={'Host':'evil.example'})[0],403)
        self.assertEqual(self.request('POST','/api/songs',{},extra={'Origin':'https://evil.example'})[0],403)
        payload={'generation':self.app.store.generation,'name':'夜空','version':'Live','languages':['日语'],'status':'大饼'}
        self.assertEqual(self.request('POST','/api/songs',payload)[0],200)
        status, body = self.request('GET','/api/state')
        self.assertEqual(json.loads(body)['songs'][0]['name'],'夜空')
        status, body = self.request('POST','/api/export/songs',{'generation':self.app.store.generation})
        self.assertEqual(status,200); self.assertEqual(body[:2],b'PK')
        self.assertEqual(self.request('GET','/../store.py')[0],404)

    def test_shutdown_ends_server_loop(self):
        self.assertEqual(self.request('POST','/api/shutdown',{})[0],200)
        self.thread.join(timeout=3)
        self.assertFalse(self.thread.is_alive())

    def test_http_backup_restore_and_filtered_export(self):
        payload={'generation':self.app.store.generation,'name':'备份中的歌','version':'原版','languages':['国语'],'status':'可演'}
        status, body = self.request('POST','/api/songs',payload)
        song_id=json.loads(body)['id']
        self.assertEqual(status,200)
        status, backup = self.request('POST','/api/backup',{})
        self.assertEqual(status,200); self.assertTrue(backup.startswith(b'SQLite format 3'))
        status, body = self.request('POST','/api/export/songs',{'generation':self.app.store.generation,'ids':[]})
        self.assertEqual(status,200)
        with ZipFile(BytesIO(body)) as archive:
            root=ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
            self.assertNotIn('备份中的歌',[v.text for v in root.findall(f'.//{{{NS}}}t')])
        self.request('POST',f'/api/songs/{song_id}',{**payload,'name':'修改后的歌','revision':1})
        generation=self.app.store.generation
        self.assertEqual(self.request('POST','/api/restore',b'invalid',extra={'X-Data-Generation':generation})[0],400)
        status, body = self.request('POST','/api/restore',backup,extra={'X-Data-Generation':generation})
        self.assertEqual(status,200); self.assertIn('preserved',json.loads(body))
        self.assertEqual(self.app.store.state()['songs'][0]['name'],'备份中的歌')
        self.assertNotEqual(self.app.store.generation,generation)


if __name__ == '__main__':
    unittest.main()
