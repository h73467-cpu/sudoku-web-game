@echo off
setlocal

cd /d "%~dp0"

echo ============================================
echo   Game Hub - One-Click Publish
echo ============================================
echo.

if not exist "sw.js" (
    echo [ERROR] sw.js not found. Make sure this .bat file is in the sudo project root.
    pause
    exit /b 1
)

if not exist "update-version.ps1" (
    echo [ERROR] update-version.ps1 not found. It must be in the same folder as this .bat file.
    pause
    exit /b 1
)

echo Updating sw.js version number...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-version.ps1"
if errorlevel 1 (
    echo [ERROR] Failed to update version number. Publish aborted.
    pause
    exit /b 1
)
echo.

echo Running: git add .
git add .
if errorlevel 1 (
    echo [ERROR] git add failed. Make sure this folder is a git project and git is installed.
    pause
    exit /b 1
)

set "COMMITMSG="
set /p COMMITMSG=Enter a short description for this update (press Enter for default): 
if "%COMMITMSG%"=="" set "COMMITMSG=Update site content"

echo.
echo Running: git commit
git commit -m "%COMMITMSG%"
if errorlevel 1 (
    echo.
    echo [NOTE] Nothing to commit, or commit failed - check the messages above.
    echo If it says "nothing to commit", either nothing actually changed, or a file wasn't saved.
    pause
    exit /b 1
)

echo.
echo Running: git push
git push
if errorlevel 1 (
    echo [ERROR] git push failed. Check your internet connection or GitHub login.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Done! Site updated and pushed to GitHub.
echo   GitHub Pages usually deploys within a minute or two.
echo ============================================
pause
