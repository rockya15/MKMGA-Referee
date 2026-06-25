# User Commands

This file documents the main commands used to run MKMGA Referee, what each one does, and when to use it.

## Quick Start (Recommended for Local Development)

Run each command in a separate terminal window.

### 1) Start the backend server

```powershell
Set-Location "server"
npm start
```

What it does:
- Changes your current directory to the server project.
- Runs the `start` script from `server/package.json`, which executes `node src/index.js`.
- Starts the Express + Socket.io backend on port `3000`.
- Serves the production frontend build from `client/dist` (if it exists).
- Handles game state, timers, betting logic, and websocket events.

When to use it:
- Always required if you want the game to function.
- Required for host controls, player state sync, and all real-time game behavior.

### 2) Start the frontend dev server (hot reload)

```powershell
Set-Location "client"
npm run dev
```

What it does:
- Changes directory to the Vite React client.
- Starts Vite dev server, usually on port `5173`.
- Enables fast refresh/hot module replacement while editing UI code.
- Proxies/socket-connects to the backend for live data.

When to use it:
- Use during UI/frontend development.
- Best for iterative changes to React components and styles.

### 3) Start the sidecar service (optional but used for race workflows)

```powershell
Set-Location "sidecar"
python main.py
```

What it does:
- Runs the Python sidecar process.
- Provides auxiliary automation/race integration logic used by the system.
- Communicates with the backend server.

When to use it:
- Use when testing full end-to-end behavior that depends on sidecar integration.
- Can be skipped for many UI-only tasks.

## Build and Serve (Production-Style Local Run)

Use this mode when you want to run the compiled frontend instead of Vite dev mode.

### 1) Build the client

```powershell
Set-Location "client"
npm run build
```

What it does:
- Generates optimized production assets in `client/dist`.
- Bundles and minifies JavaScript/CSS for deployment-style behavior.

Important:
- This command only builds files. It does **not** start a web server.

### 2) Start the server to serve built files

```powershell
Set-Location "server"
npm start
```

What it does:
- Starts backend and serves built frontend from `client/dist`.
- Site becomes reachable at `http://localhost:3000`.

## One-Click Local Startup (Windows Batch)

```powershell
.\start.bat
```

What it does:
- Opens separate command windows for:
  - Node server (`server`)
  - Python sidecar (`sidecar`)
  - Vite dev client (`client`)
- Intended as a convenience launcher for local development.

Notes:
- It uses `npm run dev -- --host` for the client.
- You can still stop each service independently by closing its terminal window.

## Docker Workflow

```powershell
docker-compose up --build
```

What it does:
- Builds images for `server`, `client`, and `sidecar` from `docker-compose.yml`.
- Starts all services in containers.
- Maps:
  - Server: `http://localhost:3000`
  - Client: `http://localhost:5173`

When to use it:
- Use for containerized testing or environment consistency.
- Useful when you want to avoid local dependency/version drift.

## Useful Access URLs

- Player view: `http://localhost:5173/` (Vite dev mode)
- Host view: `http://localhost:5173/?view=host`
- Host controls: `http://localhost:5173/?view=host-controls`
- Production-style served app: `http://localhost:3000`

## Common "Site Can't Be Reached" Causes

1. Only ran `npm run build` without starting the server.
2. Backend server is not running on port `3000`.
3. Frontend dev server is not running on port `5173` (if using dev mode).
4. Wrong URL used for current run mode (dev vs production-style).
5. A service exited due to missing dependencies or runtime error.

## Fast Health Check Commands

### Check backend HTTP response

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000 | Select-Object -ExpandProperty StatusCode
```

Expected result:
- `200` if backend is up and serving content.

### Rebuild client quickly

```powershell
Set-Location "client"
npm run build
```

### Verify server syntax quickly

```powershell
Set-Location "server"
node --check src/index.js
```
