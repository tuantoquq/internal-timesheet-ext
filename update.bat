@echo off
setlocal

cd /d "%~dp0"

echo Updating Timesheet AutoFill...
git pull --ff-only

echo.
echo Update finished.
echo Open chrome://extensions and click Reload on Timesheet AutoFill.
echo.
pause
