@echo off
rem DJ's ERP: start this laptop as the Accounting host (double-click).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-host.ps1
pause
