# Uninstall Calidrux (user install). Data in %APPDATA%\Calidrux is preserved unless -RemoveData is set.

param([switch]$RemoveData)

$ErrorActionPreference = "Stop"
$AppName = "Calidrux"
$InstallKey = Join-Path $env:LOCALAPPDATA "Calidrux\install_path.txt"

if (Test-Path $InstallKey) {
    $Target = Get-Content $InstallKey -Raw
    $Target = $Target.Trim()
} else {
    $Target = Join-Path $env:LOCALAPPDATA "Programs\Calidrux"
}

Write-Host "Removing $AppName from $Target ..."

if (Test-Path $Target) {
    Remove-Item $Target -Recurse -Force
}

$StartMenu = Join-Path ([Environment]::GetFolderPath("Programs")) $AppName
if (Test-Path $StartMenu) {
    Remove-Item $StartMenu -Recurse -Force
}

$DesktopLink = Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk"
if (Test-Path $DesktopLink) {
    Remove-Item $DesktopLink -Force
}

if ($RemoveData) {
    $DataDir = Join-Path $env:APPDATA "Calidrux"
    if (Test-Path $DataDir) {
        Remove-Item $DataDir -Recurse -Force
        Write-Host "Removed application data: $DataDir"
    }
} else {
    Write-Host "Database and settings kept at %APPDATA%\Calidrux"
}

Write-Host "$AppName uninstalled." -ForegroundColor Green
