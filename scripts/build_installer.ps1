<#
.SYNOPSIS
  Build the Calidrux Windows installer.

.PARAMETER PortableOnly
  Skip Inno Setup and only produce the portable ZIP.

.PARAMETER SkipInno
  Alias for -PortableOnly.

.EXAMPLE
  .\scripts\build_installer.ps1
  .\scripts\build_installer.ps1 -PortableOnly
#>
param(
    [switch]$PortableOnly,
    [switch]$SkipInno
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root    = Split-Path -Parent $PSScriptRoot
$venv    = "$root\.venv\Scripts"
$python  = "$venv\python.exe"
$pip     = "$venv\pip.exe"
$pyi     = "$venv\pyinstaller.exe"
$version = "0.5.0"

Push-Location $root
try {

Write-Host "==> Calidrux build v$version" -ForegroundColor Cyan

# 1. Install / verify build dependencies
Write-Host "==> Checking build dependencies…"
& $pip install pyinstaller -q
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

# 2. Download Chart.js vendor file (no-op if already present)
Write-Host "==> Downloading front-end vendor files…"
& $python scripts\download_vendor.py
if ($LASTEXITCODE -ne 0) { throw "download_vendor.py failed" }

# 3. Generate application icon
$iconScript = "$root\installer\generate_icon.py"
if (Test-Path $iconScript) {
    Write-Host "==> Generating icon…"
    & $python $iconScript
    if ($LASTEXITCODE -ne 0) { Write-Warning "Icon generation failed (non-fatal)" }
}

# 4. PyInstaller
Write-Host "==> Running PyInstaller…" -ForegroundColor Cyan
& $pyi calidrux.spec --noconfirm --clean
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

# 5. Portable ZIP
$distDir   = "$root\dist\Calidrux"
$outDir    = "$root\dist\installer"
$zipName   = "Calidrux-Portable-$version.zip"
$zipPath   = "$outDir\$zipName"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "==> Creating portable ZIP: $zipName"
if (Test-Path $zipPath) { Remove-Item $zipPath }
Compress-Archive -Path "$distDir\*" -DestinationPath $zipPath
Write-Host "    -> $zipPath  ($([math]::Round((Get-Item $zipPath).Length/1MB,1)) MB)" -ForegroundColor Green

# 6. Inno Setup installer
if (-not $PortableOnly -and -not $SkipInno) {
    $inno = @(
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($inno) {
        Write-Host "==> Building Inno Setup installer…" -ForegroundColor Cyan
        & $inno "$root\installer\calidrux.iss"
        if ($LASTEXITCODE -eq 0) {
            $setupExe = "$outDir\Calidrux-Setup-$version.exe"
            Write-Host "    -> $setupExe" -ForegroundColor Green
        } else {
            Write-Warning "Inno Setup build failed (portable ZIP is still available)."
        }
    } else {
        Write-Host "  Inno Setup not found — skipping .exe installer (portable ZIP ready)." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Build complete!" -ForegroundColor Green
Write-Host "  Portable ZIP : $zipPath"
Write-Host ""
Write-Host "To install the portable version on any Windows machine:"
Write-Host "  1. Extract the ZIP to a folder of your choice."
Write-Host "  2. Double-click Calidrux.exe."

} finally {
    Pop-Location
}
