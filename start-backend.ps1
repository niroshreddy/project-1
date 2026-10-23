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
& '.\.venv\Scripts\python.exe' -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
