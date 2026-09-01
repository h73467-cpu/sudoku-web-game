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

# Retries a read/write action a few times if the file is briefly locked by
# another process (cloud sync, antivirus scan, an editor's file watcher,
# etc). Only retries IOException - anything else fails immediately.
function Invoke-WithRetry {
    param(
        [scriptblock]$Action,
        [int]$MaxAttempts = 6,
        [int]$DelayMs = 500
    )
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            return & $Action
        } catch [System.IO.IOException] {
            if ($attempt -eq $MaxAttempts) {
                throw
            }
            Write-Host "[WARN] sw.js is locked by another process (attempt $attempt/$MaxAttempts). Retrying in $($DelayMs)ms..." -ForegroundColor Yellow
            Start-Sleep -Milliseconds $DelayMs
        }
    }
}

$timestamp = Get-Date -Format "yyyy-MM-dd-HHmm"

try {
    $content = Invoke-WithRetry { Get-Content -Raw -Path $swPath -Encoding UTF8 }
} catch {
    Write-Host "[ERROR] Could not read sw.js after several retries - it stayed locked by another process." -ForegroundColor Red
    Write-Host "        Close any program that might have it open (editor, OneDrive/Dropbox sync, antivirus scan) and try again." -ForegroundColor Red
    exit 1
}

if ($content -notmatch 'const CACHE_VERSION = "[^"]+";') {
    Write-Host "[ERROR] Could not find the CACHE_VERSION line in sw.js. Its format may have changed - check manually." -ForegroundColor Red
    exit 1
}

$newContent = $content -replace 'const CACHE_VERSION = "[^"]+";', "const CACHE_VERSION = `"$timestamp`";"

try {
    Invoke-WithRetry { Set-Content -Path $swPath -Value $newContent -NoNewline -Encoding UTF8 }
} catch {
    Write-Host "[ERROR] Could not write sw.js after several retries - it stayed locked by another process." -ForegroundColor Red
    Write-Host "        Close any program that might have it open (editor, OneDrive/Dropbox sync, antivirus scan) and try again." -ForegroundColor Red
    exit 1
}

Write-Host "CACHE_VERSION updated to $timestamp" -ForegroundColor Green
