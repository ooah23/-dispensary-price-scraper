@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: check-scraper-health.bat — Verify last scrape was within 48h
:: Reads output\metadata.json and checks the scrapedAt timestamp
:: Usage: just double-click or run from any terminal
:: ============================================================

set PROJECT_DIR=C:\Users\Claudius\dispensary-price-scraper
set METADATA=%PROJECT_DIR%\output\metadata.json

if not exist "%METADATA%" (
    echo [STALE] metadata.json not found at %METADATA%
    exit /b 1
)

:: Extract the scrapedAt value from metadata.json using PowerShell
for /f "usebackq delims=" %%T in (
    `powershell -NoProfile -Command "$m = Get-Content '%METADATA%' | ConvertFrom-Json; $scraped = [datetime]::Parse($m.scrapedAt).ToUniversalTime(); $age = ([datetime]::UtcNow - $scraped).TotalHours; Write-Output \"$([math]::Round($age,1))|$($scraped.ToString('yyyy-MM-dd HH:mm:ss')) UTC\")"`
) do set RESULT=%%T

:: Split on pipe: RESULT = "ageHours|timestampString"
for /f "tokens=1,2 delims=|" %%A in ("!RESULT!") do (
    set AGE_HOURS=%%A
    set SCRAPED_AT=%%B
)

:: Compare age — PowerShell does the float comparison cleanly
for /f "usebackq delims=" %%S in (
    `powershell -NoProfile -Command "if (%AGE_HOURS% -le 48) { 'OK' } else { 'STALE' }"`
) do set STATUS=%%S

if "!STATUS!"=="OK" (
    echo [OK] Last scrape was !AGE_HOURS! hours ago  ^(!SCRAPED_AT!^)
    exit /b 0
) else (
    echo [STALE] Last scrape was !AGE_HOURS! hours ago  ^(!SCRAPED_AT!^)  -- exceeds 48h threshold
    exit /b 1
)
