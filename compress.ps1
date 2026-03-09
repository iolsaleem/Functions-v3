# ============================================================
# Athena Function App - Compress Script
# Usage: .\compress.ps1
# Run from: C:\Athena\V8\Source_code\Functions-v3
# Creates: deploy.zip (dist + node_modules + host.json + package.json)
# ============================================================

$ErrorActionPreference = "Stop"
$ZIP_PATH = "deploy.zip"

Write-Host "`n=== Building TypeScript ===" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed"; exit 1 }
Write-Host "Build complete." -ForegroundColor Green

Write-Host "`n=== Removing old zip ===" -ForegroundColor Cyan
if (Test-Path $ZIP_PATH) { Remove-Item $ZIP_PATH -Force }
Write-Host "Old zip removed." -ForegroundColor Green

Write-Host "`n=== Compressing files (this may take a few minutes) ===" -ForegroundColor Cyan
Compress-Archive -Path dist, node_modules, host.json, package.json -DestinationPath $ZIP_PATH -Force
$sizeMB = [math]::Round((Get-Item $ZIP_PATH).Length / 1MB, 2)
Write-Host "Created $ZIP_PATH ($sizeMB MB)" -ForegroundColor Green

Write-Host "`n=== Compression complete ===" -ForegroundColor Green
Write-Host "Run .\deploy.ps1 to deploy." -ForegroundColor Cyan
