@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  py -3 -m venv .venv
  if errorlevel 1 goto failure
)
.venv\Scripts\python.exe -c "import faster_whisper" 2>nul
if errorlevel 1 (
  .venv\Scripts\python.exe -m pip install -r server\requirements.txt
  if errorlevel 1 goto failure
)
.venv\Scripts\python.exe server\server.py --warmup %*
pause
exit /b
:failure
echo 请安装 Python 3.10–3.13 后重试：https://www.python.org/downloads/
pause
