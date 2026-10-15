#!/bin/zsh
cd -- "${0:A:h}" || exit 1
# Finder's PATH can differ from Terminal's. Prefer an installed Python with Tk.
for song_python in /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
  if [[ -x "$song_python" ]] && "$song_python" -c 'import sys, tkinter; assert sys.version_info >= (3, 10)' 2>/dev/null; then
    exec "$song_python" launch.py "$@"
  fi
done
osascript -e 'display alert "需要 Python 3.10 或更新版本" message "请从 python.org 安装包含 Tk 的 macOS Python，然后重新双击启动曲库。" as critical'
exit 1
