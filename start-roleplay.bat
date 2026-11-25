@echo off
chcp 65001 >nul
title RolePlay Studio Host Server (Port 5173)
cd /d "%~dp0"

echo ============================================================================
echo Starting RolePlay Studio Host Server (npm run host)...
echo Local URL:   http://localhost:5173
echo Network URL: Accessible on your local Wi-Fi / LAN (0.0.0.0:5173)
echo ============================================================================
echo.

start "" "http://localhost:5173"
call npm run host
pause
