$ErrorActionPreference = "Stop"

$desktopDir = Split-Path -Parent $PSScriptRoot
$workspaceDir = (Resolve-Path (Join-Path $desktopDir "..\..")).Path
$targetTriple = "x86_64-pc-windows-msvc"
$source = Join-Path $workspaceDir "target\release\canrush-server.exe"
$destinationDir = Join-Path $desktopDir "src-tauri\binaries"
$destination = Join-Path $destinationDir "canrush-server-$targetTriple.exe"

cargo build --release -p canrush-server --manifest-path (Join-Path $workspaceDir "Cargo.toml")
if ($LASTEXITCODE -ne 0) {
    throw "canrush-server release build failed"
}

New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Host "Prepared Tauri sidecar: $destination"
