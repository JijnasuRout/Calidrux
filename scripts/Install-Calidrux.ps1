# Install Calidrux to the current user's Programs folder and create shortcuts.
# Run from the folder containing Calidrux.exe (portable build output).

$ErrorActionPreference = "Stop"
$AppName = "Calidrux"
$Source = $PSScriptRoot
$Target = Join-Path $env:LOCALAPPDATA "Programs\Calidrux"
$Exe = Join-Path $Target "Calidrux.exe"

Write-Host "Installing $AppName to $Target ..."

if (-not (Test-Path (Join-Path $Source "Calidrux.exe"))) {
    Write-Error "Calidrux.exe not found in $Source"
}

if (Test-Path $Target) {
    Write-Host "Removing previous installation..."
    Remove-Item $Target -Recurse -Force
}

New-Item -ItemType Directory -Path $Target -Force | Out-Null
Copy-Item "$Source\*" $Target -Recurse -Exclude @("Install-Calidrux.ps1", "Uninstall-Calidrux.ps1")

$WshShell = New-Object -ComObject WScript.Shell

$StartMenu = [Environment]::GetFolderPath("Programs")
$ShortcutDir = Join-Path $StartMenu $AppName
New-Item -ItemType Directory -Path $ShortcutDir -Force | Out-Null

$Shortcut = $WshShell.CreateShortcut((Join-Path $ShortcutDir "$AppName.lnk"))
$Shortcut.TargetPath = $Exe
$Shortcut.WorkingDirectory = $Target
$Shortcut.Description = "Pharmaceutical Warehouse Optimizer"
$Shortcut.Save()

$DesktopShortcut = $WshShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk"))
$DesktopShortcut.TargetPath = $Exe
$DesktopShortcut.WorkingDirectory = $Target
$DesktopShortcut.Save()

# Record install location for uninstall
$InstallKey = Join-Path $env:LOCALAPPDATA "Calidrux\install_path.txt"
$ConfigDir = Split-Path $InstallKey -Parent
New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
Set-Content -Path $InstallKey -Value $Target -Encoding UTF8

Write-Host ""
Write-Host "$AppName installed successfully." -ForegroundColor Green
Write-Host "  Start Menu: $ShortcutDir"
Write-Host "  Desktop shortcut created."
Write-Host ""
Write-Host "Launch: $Exe"
