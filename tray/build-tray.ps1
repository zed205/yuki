# Builds the YukiWeb tray .exe from yukiweb-tray.cs using the Roslyn C# compiler
# (csc.exe) from Visual Studio / BuildTools. Embeds the .ico so the .exe is a
# self-contained single file.
#
# Output: tray\yukiweb-tray.exe
#
# The tray targets .NET Framework 4.x (always present on Windows), so no
# runtime install is needed.

$ErrorActionPreference = 'Stop'
$trayDir = $PSScriptRoot
$src = Join-Path $trayDir 'yukiweb-tray.cs'
$ico = Join-Path $trayDir 'yukiweb-tray.ico'
$out = Join-Path $trayDir 'yukiweb-tray.exe'

# --- Locate csc.exe ---
$cscCandidates = @(
    # Visual Studio BuildTools (x86 + x64)
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe",
    # Visual Studio editions
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn\csc.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\Roslyn\csc.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\Roslyn\csc.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\Roslyn\csc.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\Roslyn\csc.exe",
    # .NET Framework fallback
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $null
foreach ($c in $cscCandidates) {
    if (Test-Path $c) { $csc = $c; break }
}
if (-not $csc) {
    $cmd = Get-Command 'csc.exe' -ErrorAction SilentlyContinue
    if ($cmd) { $csc = $cmd.Source }
}
if (-not $csc) {
    Write-Error 'csc.exe not found. Install Visual Studio BuildTools (.NET desktop development) or the .NET Framework SDK.'
    exit 1
}
Write-Host "Using csc: $csc"

# --- Compile (embed the icon as a resource) ---
$argList = @(
    '/nologo',
    '/target:winexe',
    "/out:$out",
    '/reference:System.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll'
)
if (Test-Path $ico) {
    $argList += "/resource:$ico,tray-icon.ico"
}
$argList += $src

& $csc @argList
if ($LASTEXITCODE -ne 0) {
    Write-Error "csc failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

if (Test-Path $out) {
    $size = (Get-Item $out).Length
    Write-Host "Built: $out ($size bytes)"
} else {
    Write-Error "Build produced no output at $out"
    exit 1
}
