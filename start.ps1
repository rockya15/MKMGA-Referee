$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfLog = "$Root\cloudflare.log"

function Write-Section($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)      { Write-Host "  [ OK ] $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "  [ !! ] $msg" -ForegroundColor Yellow }
function Write-Err($msg)     { Write-Host "  [FAIL] $msg" -ForegroundColor Red }

function Write-Link($label, $url, $color = 'Yellow') {
    $e = [char]27
    $link = "${e}]8;;${url}${e}\${url}${e}]8;;${e}\"
    Write-Host "  $label " -ForegroundColor Gray -NoNewline
    Write-Host $link -ForegroundColor $color
}

# ── Check Node.js ─────────────────────────────────────────────────────────────
Write-Section "Checking prerequisites..."

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Err "Node.js is not installed."
    Write-Host ""
    Write-Host "  Node.js is required to run MKMGA Referee." -ForegroundColor White
    Write-Host "  Download the LTS Windows Installer from:" -ForegroundColor White
    Write-Host ""
    Write-Host "    https://nodejs.org/en/download" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  After installing Node.js, close this window and run Start Game.bat again." -ForegroundColor White
    Write-Host ""
    $open = Read-Host "  Open the download page now? (Y/N)"
    if ($open -match '^[Yy]') { Start-Process "https://nodejs.org/en/download" }
    exit 1
}

$nodeVersion = (node --version 2>&1)
Write-OK "Node.js $nodeVersion"

# ── Install server dependencies (first run only) ──────────────────────────────
$serverModules = "$Root\server\node_modules"
if (-not (Test-Path $serverModules)) {
    Write-Section "Installing server dependencies (first time — needs internet)..."
    Push-Location "$Root\server"
    npm install
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
        Write-Err "npm install failed in server/. Check your internet connection and try again."
        Read-Host "`nPress Enter to exit"
        exit 1
    }
    Write-OK "Server dependencies installed."
} else {
    Write-OK "Server dependencies already installed."
}

# ── Build client (first run only) ─────────────────────────────────────────────
$clientDist = "$Root\client\dist"
if (-not (Test-Path $clientDist)) {
    Write-Section "Building client (first time — this takes about a minute)..."
    $clientModules = "$Root\client\node_modules"
    if (-not (Test-Path $clientModules)) {
        Push-Location "$Root\client"
        npm install
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) {
            Write-Err "npm install failed in client/. Check your internet connection and try again."
            Read-Host "`nPress Enter to exit"
            exit 1
        }
    }
    Push-Location "$Root\client"
    npm run build
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
        Write-Err "Client build failed. See errors above."
        Read-Host "`nPress Enter to exit"
        exit 1
    }
    Write-OK "Client built successfully."
} else {
    Write-OK "Client already built."
}

# ── Kill anything on port 3000 ────────────────────────────────────────────────
Write-Section "Cleaning up port 3000..."
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Warn "Killed existing process on port 3000."
} else {
    Write-OK "Port 3000 is clear."
}

Remove-Item $cfLog -ErrorAction SilentlyContinue

# ── Start services ────────────────────────────────────────────────────────────
Write-Section "Starting game server..."
$currentPath = $env:PATH
$jobs = @{}

$jobs['SERVER'] = Start-Job -ScriptBlock {
    param($root, $path)
    $env:PATH = $path
    Set-Location "$root\server"
    npm start 2>&1
} -ArgumentList $Root, $currentPath

# Cloudflared is optional — only start if installed
$cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cfCmd) {
    $jobs['CLOUDFLARE'] = Start-Job -ScriptBlock {
        param($root, $path, $cfLog)
        $env:PATH = $path
        cloudflared tunnel --url http://localhost:3000 2>&1 | ForEach-Object {
            $_ | Out-File -Append -Encoding utf8 $cfLog
            $_
        }
    } -ArgumentList $Root, $currentPath, $cfLog
    Write-OK "Cloudflare tunnel starting (remote player access)."
} else {
    Write-Warn "cloudflared not found — remote tunnel disabled."
    Write-Host "  Players on the same Wi-Fi can still join via your local IP." -ForegroundColor Gray
    Write-Host "  To enable remote access: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Gray
}

# ── Wait for server then open browser ─────────────────────────────────────────
Write-Host ""
Write-Host "  Waiting for server..." -ForegroundColor White

$browserOpened = $false
$cfUrl = $null
$jobColors = @{ SERVER = 'Green'; CLOUDFLARE = 'Yellow' }

try {
    while ($true) {
        foreach ($name in $jobs.Keys) {
            $output = Receive-Job $jobs[$name] -ErrorAction SilentlyContinue
            foreach ($line in $output) {
                $col = if ($jobColors[$name]) { $jobColors[$name] } else { 'White' }
                Write-Host "[$name] " -ForegroundColor $col -NoNewline
                Write-Host $line
            }
        }

        # Open browser once server responds
        if (-not $browserOpened) {
            try {
                Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop | Out-Null

                # Get local network IP for same-network players
                $ip = (Get-NetIPAddress -AddressFamily IPv4 |
                    Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169' } |
                    Select-Object -First 1).IPAddress

                Write-Host ""
                Write-Host "==========================================" -ForegroundColor Cyan
                Write-Host "  MKMGA REFEREE IS RUNNING" -ForegroundColor Green
                Write-Host ""
                Write-Link "  TV / Host View: " "http://localhost:3000/?view=host" 'Cyan'
                Write-Link "  Host Controls:  " "http://localhost:3000/?view=host-controls" 'Magenta'
                Write-Host ""
                if ($ip) {
                    Write-Host "  Same-network players can join at:" -ForegroundColor White
                    Write-Host "    http://${ip}:3000" -ForegroundColor Yellow
                }
                Write-Host "==========================================" -ForegroundColor Cyan
                Write-Host ""
                Write-Host "  Press Ctrl+C to stop the server." -ForegroundColor Gray
                Write-Host ""

                Start-Process "http://localhost:3000/?view=host"
                Start-Process "http://localhost:3000/?view=host-controls"
                $browserOpened = $true
            } catch {}
        }

        # Print Cloudflare URL when it appears
        if (-not $cfUrl -and (Test-Path $cfLog)) {
            $content = Get-Content $cfLog -Raw -ErrorAction SilentlyContinue
            if ($content -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
                $cfUrl = $Matches[0]
                Write-Host ""
                Write-Host "  REMOTE PLAYER LINK (share this):" -ForegroundColor Green
                Write-Link "  Players:" $cfUrl 'Yellow'
                Set-Clipboard $cfUrl
                Write-Host "  (Copied to clipboard!)" -ForegroundColor Green
                Write-Host ""
            }
        }

        Start-Sleep -Milliseconds 300
    }
} finally {
    Write-Host ""
    Write-Host "Stopping server..." -ForegroundColor Red
    $jobs.Values | Stop-Job -ErrorAction SilentlyContinue
    $jobs.Values | Remove-Job -ErrorAction SilentlyContinue
}
