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
$baseUrl = "http://localhost:$port"

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
  if (-not (Test-Path $prev)) {
    Write-Error "No previous install at $prev — nothing to roll back to."
  }
  Stop-LiveServer
  if (Test-Path $live) { Remove-Item $live -Recurse -Force }
  Rename-Item $prev $live
  Write-Host "Rolled back: $prev -> $live"
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
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
} finally {
  Pop-Location
}

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

# --- 5. Start + verify (rollback on failure) ---
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'node'
$psi.Arguments = "`"$live\dist\server\index.js`""
$psi.WorkingDirectory = $live
$psi.UseShellExecute = $false
$p = New-Object System.Diagnostics.Process
$p.StartInfo = $psi
$p.Start() | Out-Null

$ok = $false
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -lt 500) { $ok = $true; break }
  } catch {}
}

if (-not $ok) {
  Write-Warning "Live server did not respond on :$port — rolling back."
  try { $p.Kill(); $p.WaitForExit(3000) } catch {}
  Rollback
  # Best-effort restart of the previous version.
  $psi2 = New-Object System.Diagnostics.ProcessStartInfo
  $psi2.FileName = 'node'
  $psi2.Arguments = "`"$live\dist\server\index.js`""
  $psi2.WorkingDirectory = $live
  $psi2.UseShellExecute = $false
  (New-Object System.Diagnostics.Process).StartInfo = $psi2
  (New-Object System.Diagnostics.Process).Start() | Out-Null
  exit 1
}

$stamp = (Get-Content (Join-Path $live 'dist\version.json') -Raw -ErrorAction SilentlyContinue)
Write-Host "Deployed to $live:"
Write-Host $stamp
Write-Host "Live is serving on :$port (rollback: pwsh scripts/deploy.ps1 -Rollback)"
