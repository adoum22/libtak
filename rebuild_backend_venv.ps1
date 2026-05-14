param(
    [string]$VenvPath = ".venv-win",
    [string]$Python = "py -3.11"
)

$ErrorActionPreference = "Stop"

Write-Host "Reconstruction environnement backend Libtak" -ForegroundColor Cyan
Write-Host "Venv: $VenvPath"

if (-not (Test-Path $VenvPath)) {
    Write-Host "Creation du venv..."
    Invoke-Expression "$Python -m venv `"$VenvPath`""
}

$pythonExe = Join-Path $VenvPath "Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    throw "Python du venv introuvable: $pythonExe"
}

& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r requirements.txt

Push-Location backend
try {
    & "..\$VenvPath\Scripts\python.exe" manage.py check
    & "..\$VenvPath\Scripts\python.exe" manage.py test accounting sales inventory core
}
finally {
    Pop-Location
}

Write-Host "Environnement backend OK." -ForegroundColor Green
