$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$pythonExecutable = Join-Path $projectDirectory 'server/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    throw 'Install the server dependencies using the README instructions first.'
}
$serverProcess = Start-Process -FilePath $pythonExecutable -ArgumentList @('-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8765') -WorkingDirectory (Join-Path $projectDirectory 'server') -WindowStyle Hidden -PassThru
try {
    Set-Location -LiteralPath $projectDirectory
    npm run dev -- --host 127.0.0.1
} finally {
    if (-not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id
    }
}
