@echo off
echo Starting MKMGA Referee System...

REM Start Node.js server
start cmd /k "cd server && npm start"

REM Start Python sidecar
start cmd /k "cd sidecar && python main.py"

REM Start React client (host view)
start cmd /k "cd client && npm run dev -- --host"

echo All services started.
pause