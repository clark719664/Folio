@echo off
echo Folio uses the free LibreOffice app for Word, Excel and PowerPoint conversion.
echo This installs LibreOffice from its winget package. Windows may request permission.
echo Close and reopen Folio after installation. No paid conversion service is used.
pause
winget install --id TheDocumentFoundation.LibreOffice --exact --source winget --accept-source-agreements --accept-package-agreements
if errorlevel 1 echo Installation did not finish. Download LibreOffice from https://www.libreoffice.org/download/download-libreoffice/
pause
