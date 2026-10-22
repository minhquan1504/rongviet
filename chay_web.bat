@echo off
title Dino4VN Web Server
cd /d "%~dp0"

:: Xoa file trung lap chay-web.bat neu con ton tai
if exist "chay-web.bat" del /f /q "chay-web.bat" >nul 2>&1

echo ========================================================
echo   DANG KHOI DONG SERVER DINO4VN - STEAM LOGIN
echo   Dia chi web: http://localhost:3000
echo ========================================================
echo.

:: Giai phong cong 3000 neu co tien trinh cu chay ngam
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1

:: Tu dong mo trinh duyet vao localhost:3000 sau 1 giay
start "" http://localhost:3000

:: Chay web server
node server.js

pause
