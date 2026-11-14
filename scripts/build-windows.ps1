param([string]$Version = '0.1.0')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$python = Join-Path $projectRoot 'server/.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) { throw 'Create server/.venv and install desktop/requirements-build.txt first.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
& $python -m PyInstaller --noconfirm --clean --distpath release/windows --workpath build/desktop desktop/Folio.spec
if ($LASTEXITCODE -ne 0) { throw 'Windows bundling failed.' }
$bundle = Join-Path $projectRoot 'release/windows/Folio'
Copy-Item -LiteralPath 'desktop/START-HERE.txt','desktop/Install-LibreOffice.cmd','desktop/Install-WebView2.cmd','LICENSE' -Destination $bundle -Force
& $python scripts/third-party-licenses.py --output (Join-Path $bundle 'THIRD-PARTY-LICENSES.txt')
if ($LASTEXITCODE -ne 0) { throw 'License collection failed.' }
$archive = Join-Path $projectRoot "release/Folio-$Version-Windows-x64.zip"
Compress-Archive -LiteralPath $bundle -DestinationPath $archive -Force
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $projectRoot 'release/SHA256SUMS.txt') -Value "$hash  $(Split-Path $archive -Leaf)" -Encoding ascii
Write-Output "Built $archive"
Write-Output "SHA256 $hash"
