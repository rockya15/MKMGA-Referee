@echo off
echo Stopping MKMGA Referee System...

REM Kill Node.js processes (server + client dev server)
echo Stopping Node.js processes...
taskkill /F /IM node.exe 2>nul

REM Kill Python processes (sidecar)
echo Stopping Python processes...
taskkill /F /IM python.exe 2>nul

REM Kill cloudflared processes (tunnel)
echo Stopping Cloudflare Tunnel...
taskkill /F /IM cloudflared.exe 2>nul

echo.
echo All services stopped.
pause
