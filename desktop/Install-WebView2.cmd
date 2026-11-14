@echo off
echo Folio uses Microsoft Edge WebView2 Runtime for its native window.
echo This installs the free Microsoft runtime through winget. Windows may request permission.
pause
winget install --id Microsoft.EdgeWebView2Runtime --exact --source winget --accept-source-agreements --accept-package-agreements
if errorlevel 1 echo Download the Evergreen Runtime from https://developer.microsoft.com/microsoft-edge/webview2/
pause
