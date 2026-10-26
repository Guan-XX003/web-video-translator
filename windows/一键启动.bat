@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
if not exist "runtime\python.exe" (
  echo 请先完整解压 ZIP，勿在压缩包预览中运行。
  pause
  exit /b 1
)
"runtime\python.exe" -X utf8 "windows\launcher.py"
if errorlevel 1 (
  echo.
  echo 如提示缺少 DLL，请运行包内 support\vc_redist.x64.exe 后重试。
  pause
)
endlocal
