#!/bin/zsh
set -e
TASK_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$TASK_DIR"
# Prefer a supported local Python; system Python on macOS may be too old.
TK_PYTHON="${TK_PYTHON:-}"
if [[ -z "$TK_PYTHON" && -x .venv/bin/python ]]; then
  TK_PYTHON="$TASK_DIR/.venv/bin/python"
fi
if [[ -z "$TK_PYTHON" ]]; then
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; assert (3, 10) <= sys.version_info[:2] < (3, 14)' 2>/dev/null; then
      TK_PYTHON="$(command -v "$candidate")"
      break
    fi
  done
fi
if [[ -z "$TK_PYTHON" ]]; then
  echo '需要 Python 3.10–3.13。可从 https://www.python.org/downloads/ 安装 Python 3.12 后再运行。'
  read -r '?按回车退出…'
  exit 1
fi
if [[ ! -x .venv/bin/python ]]; then
  echo '首次运行：正在创建本机识别环境…'
  "$TK_PYTHON" -m venv .venv
fi
if ! .venv/bin/python -c 'import faster_whisper' 2>/dev/null; then
  echo '首次运行：正在安装 Whisper 识别依赖…'
  .venv/bin/python -m pip install -r server/requirements.txt
fi
exec .venv/bin/python server/server.py --warmup "$@"
