$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfLog = "$Root\cloudflare.log"

# Colors per service
$colors = @{
    SERVER     = 'Green'
    SIDECAR    = 'Magenta'
    CLIENT     = 'Cyan'
    CLOUDFLARE = 'Yellow'
}

function Write-Service($name, $line) {
    if (-not $line) { return }
    Write-Host "[$name] " -ForegroundColor $colors[$name] -NoNewline
    Write-Host $line
}

# OSC 8 clickable hyperlink (works in Windows Terminal)
function Write-Link($label, $url, $color = 'Yellow') {
    $e = [char]27
    $link = "${e}]8;;${url}${e}\${url}${e}]8;;${e}\"
    Write-Host "  $label " -ForegroundColor Gray -NoNewline
    Write-Host $link -ForegroundColor $color
}

# Kill port 3000
Write-Host "Cleaning up port 3000..." -ForegroundColor White
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Killed process on port 3000" -ForegroundColor Yellow
} else {
    Write-Host "Port 3000 is clear" -ForegroundColor Green
}

Remove-Item $cfLog -ErrorAction SilentlyContinue

# Start all services as background jobs, passing PATH so npm/python/cloudflared are found
$currentPath = $env:PATH

$jobs = @{}

$jobs['SERVER'] = Start-Job -ScriptBlock {
    param($root, $path)
    $env:PATH = $path
    Set-Location "$root\server"
    npm start 2>&1
} -ArgumentList $Root, $currentPath

$jobs['SIDECAR'] = Start-Job -ScriptBlock {
    param($root, $path)
    $env:PATH = $path
    Set-Location "$root\sidecar"
    python main.py 2>&1
} -ArgumentList $Root, $currentPath

$jobs['CLIENT'] = Start-Job -ScriptBlock {
    param($root, $path)
    $env:PATH = $path
    Set-Location "$root\client"
    npm run dev -- --host 2>&1
} -ArgumentList $Root, $currentPath

$jobs['CLOUDFLARE'] = Start-Job -ScriptBlock {
    param($root, $path, $cfLog)
    $env:PATH = $path
    Set-Location "$root\server"
    cloudflared tunnel --url http://localhost:3000 2>&1 | ForEach-Object {
        $_ | Out-File -Append -Encoding utf8 $cfLog
        $_
    }
} -ArgumentList $Root, $currentPath, $cfLog

Write-Host ""
Write-Host "All services started. Ctrl+C to stop everything." -ForegroundColor White
Write-Host ""

$cfUrl        = $null
$browserOpened = $false

try {
    while ($true) {
        # Print output from each job
        foreach ($name in $jobs.Keys) {
            $output = Receive-Job $jobs[$name] -ErrorAction SilentlyContinue
            foreach ($line in $output) { Write-Service $name $line }
        }

        # Detect Cloudflare URL
        if (-not $cfUrl -and (Test-Path $cfLog)) {
            $content = Get-Content $cfLog -Raw -ErrorAction SilentlyContinue
            if ($content -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
                $cfUrl = $Matches[0]
                $hostUrl    = "http://localhost:5173/?view=host"
                $controlUrl = "http://localhost:5173/?view=host-controls"
                Write-Host ""
                Write-Host "==========================================" -ForegroundColor Cyan
                Write-Host "  PLAYER JOIN URL:" -ForegroundColor Green
                Write-Link "  Player:" $cfUrl 'Yellow'
                Write-Host ""
                Write-Host "  HOST LINKS:" -ForegroundColor Green
                Write-Link "  Host Controls:" $controlUrl 'Magenta'
                Write-Link "  TV View:      " $hostUrl 'Cyan'
                Write-Host "==========================================" -ForegroundColor Cyan
                Set-Clipboard $cfUrl
                Write-Host "  Player URL copied to clipboard!" -ForegroundColor Green
                Write-Host ""
            }
        }

        # Open browser tabs once Vite is ready
        if (-not $browserOpened) {
            try {
                Invoke-WebRequest "http://localhost:5173" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop | Out-Null
                Start-Process "http://localhost:5173/?view=host"
                Start-Process "http://localhost:5173/?view=host-controls"
                $browserOpened = $true
                Write-Host "[SYSTEM] Browser tabs opened." -ForegroundColor White
            } catch {}
        }

        Start-Sleep -Milliseconds 300
    }
} finally {
    # Ctrl+C — clean up all jobs
    Write-Host ""
    Write-Host "Stopping all services..." -ForegroundColor Red
    $jobs.Values | Stop-Job -ErrorAction SilentlyContinue
    $jobs.Values | Remove-Job -ErrorAction SilentlyContinue
}
