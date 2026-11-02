$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    throw 'Create the Python virtual environment and install backend/requirements.txt first. See README.md.'
}
if (-not (Test-Path -LiteralPath 'backend\.env')) {
    Copy-Item -LiteralPath 'backend\.env.example' -Destination 'backend\.env'
    Write-Host 'Created backend/.env. Add EXTENSION_ID, then run this script again. No API key is needed.'
    exit 0
}
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 3
    if ($health.ok) {
        Write-Host 'The comparison service is already running on port 8765. Stop its existing terminal before restarting after code updates.'
        exit 0
    }
} catch { }
& '.\.venv\Scripts\python.exe' -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
