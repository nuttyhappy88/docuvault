@echo off
title Install DocuVault server
cd /d "%~dp0"
echo.
echo  === Install DocuVault server on this computer ===
echo.
echo  Step 1 of 4: Node.js
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE (
  echo  Installing Node.js LTS. Windows may ask for permission - click Yes.
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
)
if not defined NODE (
  echo  Could not install Node.js automatically. Install the LTS version from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
"%NODE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo  Your Node.js is too old. Install the current LTS from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
echo  Node.js is ready.
echo.
echo  Step 2 of 4: start DocuVault when Windows starts
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\DocuVault Server.lnk');$s.TargetPath='%~dp0Start DocuVault Server (Windows).bat';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save()"
echo  Done. DocuVault will start (minimized) whenever someone signs in to this computer.
echo.
echo  Step 3 of 4: backup folder (optional)
echo  If Google Drive for desktop is installed, give a folder inside it, e.g.  G:\My Drive\DocuVault Backups
set "BK="
set /p BK=  Backup folder (press Enter to keep the default): 
if defined BK "%NODE%" tools\set-backup-folder.mjs "%BK%"
echo.
echo  Step 4 of 4: secure web address with Cloudflare Tunnel (optional)
set "TOKEN="
set /p TOKEN=  Paste your Cloudflare Tunnel token (press Enter to skip): 
if not defined TOKEN goto start
net session >nul 2>&1
if errorlevel 1 (
  echo  To set up the tunnel, close this window, right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)
winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
set "CF=cloudflared"
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
"%CF%" service install %TOKEN%
echo  Tunnel installed. It starts with Windows.
:start
echo.
echo  Starting DocuVault now...
start "" "%~dp0Start DocuVault Server (Windows).bat"
echo  All done. You can close this window.
pause
