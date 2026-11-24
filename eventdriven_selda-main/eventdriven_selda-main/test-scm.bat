@echo off
title DJ's ERP - Procurement Connection Test
echo ========================================================
echo Testing connection to Accounting host (192.168.1.221)...
echo ========================================================
echo.
echo [1/3] Testing MySQL Database Connection (Port 3306)...
powershell -Command "Test-NetConnection 192.168.1.221 -Port 3306"
echo.
echo [2/3] Testing Accounting Hub Connection (Port 3000)...
powershell -Command "Test-NetConnection 192.168.1.221 -Port 3000"
echo.
echo [3/3] Testing Accounting Health API...
curl.exe http://192.168.1.221:3000/api/v1/health
echo.
echo ========================================================
echo Done. If tests passed, your Procurement app is ready!
echo ========================================================
pause
