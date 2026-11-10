# Deploy YukiWeb from a git ref (tag, branch, or commit) to the live install.
#
#   pwsh scripts/deploy.ps1                 # latest tag
#   pwsh scripts/deploy.ps1 -Ref v0.2.0
#   pwsh scripts/deploy.ps1 -Ref main
#
# Build strategy: snapshot the tree at $Ref into a clean staging dir (git
# archive), npm ci + build there, then stop the live server, swap the folders,
# and start + verify. The previous install is kept at D:\Apps\YukiWeb-previous
# for one-command rollback (deploy.ps1 -Rollback).
param(
  [string]$Ref = '',
  [switch]$Rollback
)

$ErrorActionPreference = 'Stop'

$repo  = 'D:\Development\YukiWeb'
$live  = 'D:\Apps\YukiWeb'
$prev  = 'D:\Apps\YukiWeb-previous'
$stage = Join-Path $env:TEMP 'yukiweb-deploy'
$port  = 3210
$baseUrl = "http://127.0.0.1:$port"

function Stop-LiveServer {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$live*" -and $_.CommandLine -like '*index.js*' }
  if ($procs) {
    $procs | ForEach-Object {
      Write-Host "Stopping live server PID $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force
    }
    Start-Sleep -Seconds 1
  }
}

function Rollback {
  Stop-LiveServer
  if (-not (Test-Path $prev)) {
    Write-Warning "No previous install at ${prev} — nothing to roll back to."
    return $false
  }
  if (Test-Path $live) { Remove-Item $live -Recurse -Force }
  Rename-Item $prev $live
  Write-Host "Rolled back: ${prev} -> ${live}"
  return $true
}

# The tray app owns the server process (it supervises, logs, and can restart
# it). Restoring/stopping the server is done by restarting the tray.
function Restart-Tray {
  $trays = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*tray.ps1*' }
  if ($trays) {
    $trays | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
  }
  $vbs = Join-Path $repo 'scripts\yukiweb-tray.vbs'
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`""
}

if ($Rollback) { Rollback; return }

# --- Resolve ref ---
if (-not $Ref) {
  $Ref = git -C $repo describe --tags --exact-match 2>$null
  if (-not $Ref) {
    # No tag points at HEAD; use the most recent tag reachable from HEAD.
    $Ref = git -C $repo describe --tags --abbrev=0 2>$null
  }
  if (-not $Ref) { $Ref = 'main' }
  Write-Host "No -Ref given; using '$Ref'"
}

# --- 1. Snapshot ---
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
git -C $repo archive --format=tar $Ref | tar -x -C $stage
if ($LASTEXITCODE -ne 0) { Write-Error "git archive failed for ref '$Ref'" }

# --- 2. Build in staging ---
Push-Location $stage
try {
  Write-Host 'npm ci ...'
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  Write-Host 'npm run build ...'
  $env:VERSION_REF = $Ref   # stamped into dist/version.json
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
} finally {
  Pop-Location
}

# --- 2b. Prune repo-only files so the install is lean ---
# Runtime only needs dist/ + node_modules/ + package files + scripts/.
foreach ($p in @('src', 'docs', 'tests', '.gitignore', 'SPEC.md', 'tsconfig.json', 'paths.json.example')) {
  $full = Join-Path $stage $p
  if (Test-Path $full) { Remove-Item $full -Recurse -Force }
}
Write-Host 'Pruned repo-only files from staging.'

# --- 3. Stop live ---
Stop-LiveServer

# --- 4. Swap (keep one previous for rollback) ---
if (Test-Path $live) {
  if (Test-Path $prev) { Remove-Item $prev -Recurse -Force }
  Rename-Item $live $prev
}
Copy-Item $stage $live -Recurse
Remove-Item $stage -Recurse -Force

# .env with API keys (loadEnvFile reads .env from the working directory).
$srcEnv = Join-Path $repo '.env'
if ((Test-Path $srcEnv) -and -not (Test-Path (Join-Path $live '.env'))) {
  Copy-Item $srcEnv (Join-Path $live '.env')
}

# --- 5. Restart the tray (which starts the server) + verify ---
Restart-Tray

$ok = $false
$lastErr = ''
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  try {
    # Any HTTP response (even 404) proves the server is up.
    $http = New-Object System.Net.Http.HttpClient
    $http.Timeout = [TimeSpan]::FromSeconds(2)
    $resp = $http.GetAsync($baseUrl).GetAwaiter().GetResult()
    $code = [int]$resp.StatusCode
    $resp.Dispose(); $http.Dispose()
    if ($code -lt 500) { $ok = $true; break }
    $lastErr = "HTTP $code"
  } catch { $lastErr = $_.Exception.Message }
}
if (-not $ok) { Write-Warning "Last verify error: $lastErr" }

if (-not $ok) {
  Write-Warning "Live server did not respond on :$port — rolling back."
  if (Rollback) { Restart-Tray }
  exit 1
}

$stamp = (Get-Content (Join-Path $live 'dist\version.json') -Raw -ErrorAction SilentlyContinue)
Write-Host "Deployed to ${live}:"
Write-Host $stamp
Write-Host "Live is serving on :$port (rollback: pwsh scripts/deploy.ps1 -Rollback)"
