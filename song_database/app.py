"""Loopback-only HTTP application. Run launch.py for the desktop control window."""
import argparse
import fcntl
import json
import mimetypes
from pathlib import Path
import secrets
import signal
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, quote
from datetime import date

from store import Store, ValidationError, Conflict
from excel import export_performance, export_songs, safe_filename

ROOT = Path(__file__).resolve().parent


class Application(ThreadingHTTPServer):
    # Request threads finish before the store is closed at shutdown.
    daemon_threads = False

    def __init__(self, directory, port=0):
        self.store = Store(directory)
        self.token = secrets.token_urlsafe(32)
        try:
            super().__init__(('127.0.0.1', port), Handler)
        except OSError:
            self.store.close()
            raise
        self.origin = f'http://127.0.0.1:{self.server_port}'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, status, data, content_type='application/json; charset=utf-8', filename=None):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header('Content-Disposition', f"attachment; filename*=UTF-8''{quote(filename)}")
        self.end_headers()
        self.wfile.write(data)

    def guard(self, api=False):
        if self.headers.get('Host') != self.server.origin.removeprefix('http://'):
            self.respond(403, {'error': '仅允许从本机应用地址访问'})
            return False
        origin = self.headers.get('Origin')
        if origin and origin != self.server.origin:
            self.respond(403, {'error': '请求来源无效'})
            return False
        if api and not secrets.compare_digest(self.headers.get('X-App-Token', ''), self.server.token):
            self.respond(403, {'error': '应用已重启，请重新打开页面'})
            return False
        return True

    def body(self, raw=False):
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise ValidationError('请求大小无效') from None
        if not 0 < length <= 20 * 1024 * 1024:
            raise ValidationError('请求为空或文件超过 20 MB')
        data = self.rfile.read(length)
        if raw:
            return data
        try:
            value = json.loads(data)
        except (ValueError, UnicodeError):
            raise ValidationError('请求内容无效') from None
        if not isinstance(value, dict):
            raise ValidationError('请求内容需要是对象')
        return value

    def do_GET(self):
        path = urlparse(self.path).path
        if not self.guard(api=path.startswith('/api/')):
            return
        try:
            if path == '/api/state':
                with self.server.store.lock:
                    return self.respond(200, self.server.store.state())
            if path == '/':
                html = (ROOT / 'static/index.html').read_text('utf-8').replace('__APP_TOKEN__', self.server.token)
                return self.respond(200, html.encode('utf-8'), 'text/html; charset=utf-8')
            files = {'/app.js': 'app.js', '/style.css': 'style.css', '/favicon.svg': 'favicon.svg'}
            if path in files:
                file = ROOT / 'static' / files[path]
                return self.respond(200, file.read_bytes(), mimetypes.guess_type(str(file))[0] + '; charset=utf-8')
            self.respond(404, {'error': '页面不存在'})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        if not self.guard(api=True):
            return
        path = urlparse(self.path).path
        store = self.server.store
        try:
            if path == '/api/shutdown':
                self.respond(200, {'ok': True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            with store.lock:
                if path == '/api/backup':
                    with tempfile.TemporaryDirectory() as temp:
                        destination = Path(temp) / 'backup.sqlite3'
                        store.backup(destination)
                        return self.respond(200, destination.read_bytes(), 'application/octet-stream', f'乐队曲库备份_{date.today().isoformat()}.sqlite3')
                if path == '/api/restore':
                    if self.headers.get('X-Data-Generation') != store.generation:
                        raise Conflict('数据已更新，请刷新后重新选择备份')
                    with tempfile.TemporaryDirectory() as temp:
                        source = Path(temp) / 'restore.sqlite3'
                        source.write_bytes(self.body(raw=True))
                        preserved = store.restore(source)
                    return self.respond(200, {'ok': True, 'preserved': preserved})
                data = self.body()
                if path == '/api/export/songs':
                    state = store.state()
                    store.check_generation(data)
                    selected = data.get('ids')
                    if selected is not None and (not isinstance(selected, list) or not all(isinstance(s, str) for s in selected)):
                        raise ValidationError('导出范围无效')
                    selected_ids = set(selected or [])
                    songs = [s for s in state['songs'] if selected is None or s['id'] in selected_ids]
                    if selected is not None and len(songs) != len(selected_ids):
                        raise Conflict('曲库已更新，请刷新后重新导出')
                    return self.respond(200, export_songs(songs, '当前筛选结果' if selected is not None else '全部曲目'),
                                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', f'乐队曲库_{date.today().isoformat()}.xlsx')
                parts = path.strip('/').split('/')
                if len(parts) == 4 and parts[:3] == ['api', 'export', 'performances']:
                    store.check_generation(data)
                    event = next((e for e in store.state()['performances'] if e['id'] == parts[3]), None)
                    if event is None:
                        raise ValidationError('演出不存在，请刷新页面')
                    return self.respond(200, export_performance(event), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                        safe_filename(f'{event["date"]}_{event["name"]}_歌单') + '.xlsx')
                if len(parts) in (2, 3, 4) and parts[0] == 'api' and parts[1] in ('songs', 'performances'):
                    kind = parts[1]
                    identifier = parts[2] if len(parts) >= 3 else None
                    if len(parts) == 4 and parts[3] == 'delete':
                        store.delete(kind, identifier, data)
                        return self.respond(200, {'ok': True})
                    if len(parts) <= 3:
                        method = store.save_song if kind == 'songs' else store.save_performance
                        identifier = method(data, identifier)
                        return self.respond(200, {'id': identifier})
                self.respond(404, {'error': '操作不存在'})
        except Conflict as exc:
            self.respond(409, {'error': str(exc)})
        except ValidationError as exc:
            self.respond(400, {'error': str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            self.respond(500, {'error': '操作未完成，请查看启动窗口中的错误信息后重试'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True)
    # Prevent two launchers from running services against the same database.
    lockfile = (args.data_dir / '.running').open('a+')
    try:
        fcntl.flock(lockfile.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lockfile.seek(0)
        print(json.dumps({'url': lockfile.read().strip(), 'existing': True}), flush=True)
        return
    server = Application(args.data_dir, args.port)
    lockfile.seek(0)
    lockfile.truncate()
    lockfile.write(server.origin)
    lockfile.flush()
    print(json.dumps({'url': server.origin, 'existing': False}), flush=True)

    def stop(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.store.close()
        lockfile.seek(0)
        lockfile.truncate()
        lockfile.close()


if __name__ == '__main__':
    main()
