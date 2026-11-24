@echo off
title Switch to Local Mode
echo Setting configuration to LOCAL (Laragon / localhost)...
copy /y .env.local .env
if exist "..\..\.env" copy /y .env.local ..\..\.env
echo.
echo ========================================================
echo Naka-set na sa LOCAL MODE!
echo.
echo Setup natin ang database at account mo (admin@djs.local)...
node setup-local-account.js
echo ========================================================
echo.
echo Pwede mo na i-start ang app!
echo.
pause
