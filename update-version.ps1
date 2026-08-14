# update-version.ps1
#
# Bumps CACHE_VERSION inside sw.js to the current local date/time, using
# the exact "yyyy-MM-dd-HHmm" format that sw.js and shared/js/pwa.js
# expect. Run this every time before pushing any content change, so the
# site's service worker actually notices something changed and shows the
# update-available banner instead of silently serving stale cached files.
#
# You normally don't need to run this file directly - double-click
# publish.bat instead, which calls this automatically.

$ErrorActionPreference = "Stop"

$swPath = Join-Path $PSScriptRoot "sw.js"

if (-not (Test-Path $swPath)) {
    Write-Host "[ERROR] sw.js not found. Make sure this file is in the sudo project root." -ForegroundColor Red
    exit 1
}

$timestamp = Get-Date -Format "yyyy-MM-dd-HHmm"
$content = Get-Content -Raw -Path $swPath -Encoding UTF8

if ($content -notmatch 'const CACHE_VERSION = "[^"]+";') {
    Write-Host "[ERROR] Could not find the CACHE_VERSION line in sw.js. Its format may have changed - check manually." -ForegroundColor Red
    exit 1
}

$newContent = $content -replace 'const CACHE_VERSION = "[^"]+";', "const CACHE_VERSION = `"$timestamp`";"
Set-Content -Path $swPath -Value $newContent -NoNewline -Encoding UTF8

Write-Host "CACHE_VERSION updated to $timestamp" -ForegroundColor Green
