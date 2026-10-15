"""Native macOS control window for the local web service."""
import argparse
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import messagebox
import webbrowser

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True)
    root = tk.Tk()
    root.title('乐队曲库 · 启动窗口')
    root.geometry('480x330')
    root.resizable(False, False)
    root.configure(bg='#f0f2e9')
    root.option_add('*Font', ('Helvetica', 13))
    frame = tk.Frame(root, bg='#f0f2e9', padx=32, pady=27)
    frame.pack(fill='both', expand=True)
    tk.Label(frame, text='SETROOM', bg='#f0f2e9', fg='#294b3c', font=('Helvetica', 22, 'bold')).pack(anchor='w')
    tk.Label(frame, text='乐队曲库', bg='#f0f2e9', fg='#78836e', font=('Helvetica', 12)).pack(anchor='w', pady=(5, 18))
    status = tk.StringVar(value='正在启动本地服务…')
    tk.Label(frame, textvariable=status, bg='#f0f2e9', fg='#294b3c', wraplength=410, justify='left').pack(anchor='w')
    tk.Label(frame, text='管理完成后，点击“退出应用”或关闭此窗口。\n服务会停止，已保存的数据会保留。', bg='#f0f2e9', fg='#78836e', justify='left', font=('Helvetica', 11)).pack(anchor='w', pady=(14, 17))
    url = ''
    process = None
    opened = False
    ready = queue.Queue()
    log = (args.data_dir / 'app.log').open('a', encoding='utf-8')

    def cleanup():
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    def quit_app():
        if process and process.poll() is None and opened:
            if not messagebox.askokcancel('退出乐队曲库', '将停止本地服务。请确认浏览器中的修改已经保存。', parent=root):
                return
        cleanup()
        root.destroy()

    def open_page():
        if url:
            webbrowser.open(url)

    buttons = tk.Frame(frame, bg='#f0f2e9')
    buttons.pack(fill='x')
    open_button = tk.Button(buttons, text='打开管理页面', command=open_page, state='disabled', padx=14, pady=7)
    open_button.pack(side='left')
    tk.Button(buttons, text='退出应用', command=quit_app, padx=14, pady=7).pack(side='right')
    root.protocol('WM_DELETE_WINDOW', quit_app)

    def read_startup():
        try:
            ready.put(json.loads(process.stdout.readline()))
        except (ValueError, OSError):
            ready.put({'error': '服务未能启动。详细错误保存在 data/app.log。'})

    def poll():
        nonlocal url, opened
        if not opened:
            try:
                result = ready.get_nowait()
            except queue.Empty:
                root.after(100, poll)
                return
            if 'error' in result:
                status.set(result['error'])
                return
            url = result.get('url', '')
            if not url.startswith('http://127.0.0.1:'):
                status.set('另一个窗口正在启动，请稍后再打开。')
                return
            opened = True
            status.set('服务已启动，仅在本机运行。\n' + url)
            open_button.configure(state='normal')
            if not args.no_browser:
                open_page()
            if result.get('existing'):
                # The first launcher owns the existing server; this one must not stop it.
                root.destroy()
                return
        if process.poll() is not None:
            if process.returncode:
                status.set('服务意外停止，请查看 data/app.log 后重新启动。')
                open_button.configure(state='disabled')
            else:
                root.destroy()
            return
        root.after(1000, poll)

    try:
        process = subprocess.Popen([sys.executable, str(ROOT / 'app.py'), '--data-dir', str(args.data_dir)],
                                   stdout=subprocess.PIPE, stderr=log, text=True, cwd=ROOT)
        threading.Thread(target=read_startup, daemon=True).start()
        root.after(100, poll)
        root.mainloop()
    finally:
        cleanup()
        log.close()


if __name__ == '__main__':
    main()
