@echo off
cd /d "%~dp0"
echo Dang kiem tra phien ban moi...

:: Thay bang repo cua ban
set REPO=tuantoquq/internal-timesheet-ext

:: Lay URL zip cua release moi nhat tu GitHub API
powershell -Command "$r = Invoke-RestMethod 'https://api.github.com/repos/%REPO%/releases/latest'; $asset = $r.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1; $r.tag_name | Out-File -Encoding utf8 '%TEMP%\ts_ver.txt'; Invoke-WebRequest $asset.browser_download_url -OutFile '%TEMP%\ts_update.zip'"

:: Doc version moi
set /p NEW_VER=<%TEMP%\ts_ver.txt
set NEW_VER=%NEW_VER: =%

echo Phien ban moi: %NEW_VER%
echo Dang cap nhat...

:: Giai nen de vao thu muc hien tai
powershell -Command "Expand-Archive -Path '%TEMP%\ts_update.zip' -DestinationPath '%~dp0' -Force"

echo.
echo Cap nhat xong! Vao chrome://extensions hoac about:addons va nhan Reload.
pause