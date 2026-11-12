@echo off
title DocuVault server
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul
if %errorlevel%==0 goto run
if exist "%ProgramFiles%\nodejs\node.exe" (set "NODE=%ProgramFiles%\nodejs\node.exe" & goto run)
echo Node.js is not installed. Run "Install DocuVault Server (Windows).bat" first.
pause
exit /b 1
:run
"%NODE%" --no-warnings server\server.mjs
echo.
echo DocuVault server stopped.
pause
