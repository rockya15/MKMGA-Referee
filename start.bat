@echo off
echo Starting MKMGA Referee System...

REM Kill any process using port 3000
echo Cleaning up port 3000...
powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host 'Killed process on port 3000' } else { Write-Host 'Port 3000 is clear' }"

REM Start Node.js server
echo Launching Node.js server...
start cmd /k "cd server && npm start"

REM Start Python sidecar
echo Launching Python sidecar...
start cmd /k "cd sidecar && python main.py"

REM Start React client (host view)
echo Launching React client...
start cmd /k "cd client && npm run dev -- --host"

REM Start Cloudflare Tunnel (exposes server to internet)
echo Launching Cloudflare Tunnel...
start cmd /k "cd server && cloudflared tunnel --url http://localhost:3000"

echo.
echo All services started in separate windows.
echo.
echo Player join URL will appear in the Cloudflare Tunnel window.
echo Host view:  http://localhost:5173/?view=host
echo Host controls: http://localhost:5173/?view=host-controls
echo.
pause