# Deploy YukiWeb from a git ref (tag, branch, or commit) to the live install.
#
#   pwsh scripts/deploy.ps1                 # latest tag
#   pwsh scripts/deploy.ps1 -Ref v0.2.0
#   pwsh scripts/deploy.ps1 -Ref main
#
# Build strategy: build in-place in the repo, then copy only runtime files
# to D:\Apps\YukiWeb. No staging dir, no folder swap.
param(
  [string]$Ref = '',
  [switch]$Rollback
)

$ErrorActionPreference = 'Stop'

$repo  = 'D:\Development\YukiWeb'
$live  = 'D:\Apps\YukiWeb'
$port  = 3210
$baseUrl = "http://127.0.0.1:$port"

function Stop-LiveServer {
  # Stop the old PowerShell tray (if running).
  $oldTrays = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*tray.ps1*' }
  if ($oldTrays) {
    $oldTrays | ForEach-Object {
      Write-Host "Stopping old tray PID $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  # Stop the new C# tray (if running). Snapshot PIDs up front and null-guard:
  # a tray that's mid-shutdown can report a null ProcessId between the query
  # and the kill, which would otherwise abort the whole deploy on a bind error.
  $trayPids = @(Get-Process -Name 'yukiweb-tray' -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessId } | Where-Object { $null -ne $_ })
  foreach ($tpid in $trayPids) {
    Write-Host "Stopping tray PID $tpid"
    Stop-Process -Id $tpid -Force -ErrorAction SilentlyContinue
  }
  # Stop the node server and its children (taskkill /T kills the whole tree).
  # taskkill is async — it returns immediately after sending SIGKILL. We
  # must verify the process actually exited before proceeding, because Windows
  # may not release .node native DLL file handles until the process is fully
  # gone. Stop-Process -Force blocks until the process terminates.
  $maxWait = 60   # seconds
  $elapsed = 0
  while ($elapsed -lt $maxWait) {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object { $_.CommandLine -like "*$live*" -and $_.CommandLine -like '*index.js*' }
    if (-not $procs) { break }
    $pids = @($procs.ProcessId)
    $pids | ForEach-Object {
      Write-Host "Stopping live server PID $_"
      taskkill /PID $_ /T /F 2>$null | Out-Null
    }
    # Wait for each killed PID to actually exit (Stop-Process blocks).
    foreach ($procId in $pids) {
      try {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
          Write-Host "  PID $_ still alive — forcing exit (may take a few seconds)"
          Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
      } catch { }
    }
    # Give Windows time to release file handles before next iteration.
    Start-Sleep -Seconds 3
    $elapsed += 3
  }
  if ($elapsed -ge $maxWait) {
    Write-Warning "Node servers under $live did not exit within ${maxWait}s — forcing proceed"
  }
}

# Dev instances started from the repo keep native addons (better-sqlite3's
# prebuilt .node) mapped, which makes `npm ci` fail with
#   EPERM: operation not permitted, unlink ...\better-sqlite3\prebuilds\win32-x64.node
# Stop-LiveServer only matches processes whose command line contains $live, and
# a dev instance started with a *relative* path ("node dist/server/index.js")
# does not — so stop repo-side dev servers explicitly before touching node_modules.
# (It also re-kills a live server that survived Stop-LiveServer, which is what we
# want before the copy step.)
function Stop-RepoInstances {
  $patterns = @(
    '*dist\server\index.js*', '*dist/server/index.js*',
    '*src\server\index.ts*', '*src/server/index.ts*',
    '*src\client\dev-server.js*', '*src/client/dev-server.js*',
    '*e2e-ax\serve.js*', '*e2e-ax/serve.js*'
  )
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
      $cmd = $_.CommandLine
      if (-not $cmd) { return $false }
      foreach ($pat in $patterns) { if ($cmd -like $pat) { return $true } }
      return $false
    })
  foreach ($proc in $procs) {
    Write-Host "Stopping repo dev process PID $($proc.ProcessId)"
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($procs.Count -gt 0) { Start-Sleep -Milliseconds 800 }
}

# True when another process holds an exclusive handle on the file.
function Test-FileLocked([string]$Path) {
  if (-not (Test-Path $Path)) { return $false }
  try {
    $fs = [System.IO.File]::Open($Path, 'Open', 'ReadWrite', 'None')
    $fs.Close()
    return $false
  }
  catch { return $true }
}

function Rollback {
  Stop-LiveServer
  # Simple rollback: copy the previous live dir back (if it exists).
  $prev  = 'D:\Apps\YukiWeb-previous'
  if (-not (Test-Path $prev)) {
    Write-Warning "No previous install at ${prev} — nothing to roll back to."
    return $false
  }
  if (Test-Path $live) { Remove-Item $live -Recurse -Force }
  Rename-Item $prev $live
  Write-Host "Rolled back: ${prev} -> ${live}"
  return $true
}

# The tray app (tray\yukiweb-tray.exe) owns the server process: it launches,
# supervises, logs, and can restart it. Restoring/stopping the server is done
# by restarting the tray.
function Restart-Tray {
  # Stop running tray instances. Loop until none remain: a single pass can miss
  # a tray that's mid-shutdown (its ProcessId goes null) or still tearing down,
  # which otherwise leaves a duplicate behind when the new tray starts.
  for ($i = 0; $i -lt 20; $i++) {
    $trays = @(Get-Process -Name 'yukiweb-tray' -ErrorAction SilentlyContinue)
    if ($trays.Count -eq 0) { break }
    foreach ($t in $trays) { if ($null -ne $t.Id) { Stop-Process -Id $t.Id -Force -ErrorAction SilentlyContinue } }
    Start-Sleep -Milliseconds 400
  }
  # The tray may have been force-killed before it could stop its server; stop
  # the server too so the new tray starts cleanly.
  Stop-LiveServer
  # Start the tray from the repo (it reads AppDir from source as D:\Apps\YukiWeb).
  $exe = Join-Path $repo 'tray\yukiweb-tray.exe'
  if (Test-Path $exe) {
    Start-Process -FilePath $exe
    Write-Host "Started tray: $exe"
  }
  else {
    Write-Warning "Tray exe not found at $exe — server will not auto-start."
  }
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

# --- 0. Stop any running server (must run before Remove-Item) ---
Write-Host 'Stopping live server (if any)...'
Stop-LiveServer
# Repo-side dev instances hold native addons in node_modules; stop them too.
Stop-RepoInstances

# --- 1. Build in-place ---
$sqliteAddon = Join-Path $repo 'node_modules\better-sqlite3\prebuilds\win32-x64.node'
if (Test-FileLocked $sqliteAddon) {
  Write-Warning "A process still holds $sqliteAddon"
  Write-Warning 'npm ci will fail with EPERM: unlink. Stop dev servers (node dist/server/index.js, npm run dev) and retry.'
}
Write-Host 'npm ci ...'
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
Write-Host 'npm run build ...'
$env:VERSION_REF = $Ref   # stamped into dist/version.json
npm run build
if ($LASTEXITCODE -ne 0) { throw 'build failed' }

# --- 1b. Copy runtime files to live dir ---
# Live install only needs: dist/, node_modules/, package files, scripts/, tray/.
if (Test-Path $live) { Remove-Item $live -Recurse -Force }
New-Item -ItemType Directory -Path $live | Out-Null

# Copy dist (built output)
Copy-Item (Join-Path $repo 'dist') (Join-Path $live 'dist') -Recurse

# Copy node_modules (already installed in repo)
Copy-Item (Join-Path $repo 'node_modules') (Join-Path $live 'node_modules') -Recurse

# Copy runtime-only files
Copy-Item (Join-Path $repo 'package.json') (Join-Path $live 'package.json')
Copy-Item (Join-Path $repo 'package-lock.json') (Join-Path $live 'package-lock.json')
Copy-Item (Join-Path $repo 'scripts') (Join-Path $live 'scripts') -Recurse
Copy-Item (Join-Path $repo 'tray') (Join-Path $live 'tray') -Recurse
Copy-Item (Join-Path $repo 'extension') (Join-Path $live 'extension') -Recurse -ErrorAction SilentlyContinue
Copy-Item (Join-Path $repo 'UIMigration') (Join-Path $live 'UIMigration') -Recurse -ErrorAction SilentlyContinue
Write-Host "Copied runtime files to ${live}."

# .env with API keys (loadEnvFile reads .env from the working directory).
$srcEnv = Join-Path $repo '.env'
if (Test-Path $srcEnv) {
  Copy-Item $srcEnv (Join-Path $live '.env')
}

# --- 2. Restart the tray (which starts the server) + verify ---
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
