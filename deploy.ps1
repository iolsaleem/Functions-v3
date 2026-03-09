$STORAGE_ACCOUNT   = "stprojectathena"
$STORAGE_CONTAINER = "deployments"
$BLOB_NAME         = "project-iol-athena-fn.zip"
$FUNCTION_APP      = "project-iol-athena-fn"
$RESOURCE_GROUP    = "rg-project-athena"
$SUBSCRIPTION_ID   = "65818ccf-a81b-4245-8efd-28a573d3f60d"
$ZIP_PATH          = "deploy.zip"
$SAS_TEMP_FILE     = "$env:TEMP\athena_sas.txt"

if (-not (Test-Path $ZIP_PATH)) { Write-Error "deploy.zip not found."; exit 1 }
Write-Host "Found $ZIP_PATH" -ForegroundColor Green

Write-Host "`n=== STEP 1: Build ===" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed"; exit 1 }

Write-Host "`n=== STEP 2: Get storage key ===" -ForegroundColor Cyan
$accountKey = az storage account keys list --account-name $STORAGE_ACCOUNT --resource-group $RESOURCE_GROUP --query "[0].value" --output tsv
if (-not $accountKey) { Write-Error "Failed to get storage key"; exit 1 }

Write-Host "`n=== STEP 3: Upload zip ===" -ForegroundColor Cyan
az storage blob upload --account-name $STORAGE_ACCOUNT --account-key $accountKey --container-name $STORAGE_CONTAINER --name $BLOB_NAME --file $ZIP_PATH --overwrite
if ($LASTEXITCODE -ne 0) { Write-Error "Upload failed"; exit 1 }

Write-Host "`n=== STEP 4: Generate SAS URL ===" -ForegroundColor Cyan
$expiry = (Get-Date).AddYears(1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mmZ")
az storage blob generate-sas --account-name $STORAGE_ACCOUNT --account-key $accountKey --container-name $STORAGE_CONTAINER --name $BLOB_NAME --permissions r --expiry $expiry --full-uri --output tsv | Out-File -FilePath $SAS_TEMP_FILE -Encoding ascii
$sasUrl = (Get-Content $SAS_TEMP_FILE -Raw).Trim().Trim('"')
Write-Host "SAS length: $($sasUrl.Length)" -ForegroundColor Green

Write-Host "`n=== STEP 5: Update app setting via REST ===" -ForegroundColor Cyan
$token = az account get-access-token --query accessToken --output tsv
$listUrl = "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$FUNCTION_APP/config/appsettings/list?api-version=2022-03-01"
$current = Invoke-RestMethod -Uri $listUrl -Method POST -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json"
$props = $current.properties
$props | Add-Member -NotePropertyName "WEBSITE_RUN_FROM_PACKAGE" -NotePropertyValue $sasUrl -Force
$putUrl = "https://management.azure.com/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$FUNCTION_APP/config/appsettings?api-version=2022-03-01"
$body = @{ properties = $props } | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri $putUrl -Method PUT -Headers @{ Authorization = "Bearer $token" } -Body $body -ContentType "application/json" | Out-Null
Write-Host "App setting updated." -ForegroundColor Green

Write-Host "`n=== STEP 6: Restart ===" -ForegroundColor Cyan
az functionapp stop --name $FUNCTION_APP --resource-group $RESOURCE_GROUP
Start-Sleep -Seconds 10
az functionapp start --name $FUNCTION_APP --resource-group $RESOURCE_GROUP

Write-Host "`n=== STEP 7: Health check ===" -ForegroundColor Cyan
Start-Sleep -Seconds 30
try {
  $health = Invoke-RestMethod -Uri "https://$FUNCTION_APP.azurewebsites.net/api/health" -Method GET -TimeoutSec 30
  Write-Host "Health: $($health.status)" -ForegroundColor $(if ($health.status -eq "healthy") { "Green" } else { "Yellow" })
  Write-Host "Cosmos: $($health.services.cosmos) | Graph: $($health.services.graph) | Anthropic: $($health.services.anthropic)"
} catch {
  Write-Host "Health check failed: $_" -ForegroundColor Yellow
}
Write-Host "`n=== Done: https://$FUNCTION_APP.azurewebsites.net/api ===" -ForegroundColor Green