@echo off
rem DJ's ERP: live view of which teammates are connected to this host (double-click). Ctrl+C to stop.
title DJ's ERP - connection monitor
cd /d "%~dp0"
node scripts\lan-monitor.js
pause
