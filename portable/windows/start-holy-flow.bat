@echo off
setlocal

set "PORT=%~1"
if "%PORT%"=="" set "PORT=4173"

set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-HolyFlow.ps1" -Root "%SCRIPT_DIR%" -Port %PORT%

endlocal
