# MKMGA Referee

A Jackbox-style betting game for Mario Kart races.

## Setup

1. Install dependencies:
   - Node.js
   - Python 3
   - npm

2. Install server dependencies:
   ```bash
   cd server
   npm install
   ```

3. Install client dependencies:
   ```bash
   cd client
   npm install
   ```

4. Install Python dependencies:
   ```bash
   cd sidecar
   pip install -r requirements.txt
   ```

## Running Locally

1. Start the server:
   ```bash
   cd server
   npm start
   ```

2. Start the client (development):
   ```bash
   cd client
   npm run dev
   ```

3. Start the sidecar:
   ```bash
   cd sidecar
   python main.py
   ```

4. Open browser to:
   - Player view: http://localhost:5173/
   - Host view: http://localhost:5173/?view=host
   - Host controls: http://localhost:5173/?view=host-controls

## Production Build

1. Build the client:
   ```bash
   cd client
   npm run build
   ```

2. Start the server (serves built client):
   ```bash
   cd server
   npm start
   ```

## Docker Deployment

1. Build and run with Docker Compose:
   ```bash
   docker-compose up --build
   ```

2. Access:
   - Server: http://localhost:3000
   - Client: http://localhost:5173

## Architecture

- **Server**: Node.js + Express + Socket.io
- **Client**: React + Vite
- **Sidecar**: Python for race detection
- **Tunnel**: Cloudflare for public URLs</content>
<parameter name="filePath">c:\Users\Big Balls\Documents\RockYaGames\rockyagames\MKMGA Referee\README.md