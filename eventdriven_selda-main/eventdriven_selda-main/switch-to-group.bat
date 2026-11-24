@echo off
title Switch to Group ERP Mode
echo Setting configuration to GROUP ERP (Host: 192.168.1.221)...
copy /y .env.group .env
if exist "..\..\.env" copy /y .env.group ..\..\.env
echo.
echo ========================================================
echo Naka-set na sa GROUP ERP MODE!
echo Handa na kumonekta sa laptop ng Accounting Host (192.168.1.221).
echo ========================================================
echo.
pause
