param([ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3.12 -m venv .venv
    } else {
        & python -m venv .venv
    }
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12, then run setup.ps1 again.' }
}
& '.\.venv\Scripts\python.exe' -c "import sys; assert sys.version_info[:2] in [(3,11),(3,12)], 'Python 3.11 or 3.12 is required'"
if ($LASTEXITCODE -ne 0) { throw 'Recreate the virtual environment using Python 3.12.' }
& '.\.venv\Scripts\python.exe' -m pip install -r backend/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependencies could not be installed. Check network access and retry.' }
if (-not (Test-Path -LiteralPath 'backend\.env')) { Copy-Item -LiteralPath 'backend\.env.example' -Destination 'backend\.env' }
if ($ExtensionId) {
    $settings = Get-Content -LiteralPath 'backend\.env' -Raw
    if ($settings -match '(?m)^EXTENSION_ID=') { $settings = $settings -replace '(?m)^EXTENSION_ID=.*$', "EXTENSION_ID=$ExtensionId" }
    else { $settings += "`nEXTENSION_ID=$ExtensionId`n" }
    Set-Content -LiteralPath 'backend\.env' -Value $settings -Encoding utf8
}
Write-Host 'Setup complete. Configure EXTENSION_ID in backend/.env if needed, then run .\start-backend.ps1.'
