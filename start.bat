@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_EXE=D:\tools\node-v22.23.5-win-x64\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
echo Starting Course Compass (Zero-GPU Cloud Mode) at http://127.0.0.1:8090/
echo Close this window or press Ctrl+C to stop.
"%NODE_EXE%" _serve.mjs
pause
