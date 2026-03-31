@echo off
setlocal

:: ============================================================
:: auto-scrape.bat — Daily automated scrape for nycweedprice.org
:: Runs scrape-leafly.mjs, commits updated JSON, and pushes to GitHub
:: ============================================================

set PROJECT_DIR=C:\Users\Claudius\dispensary-price-scraper

:: Playwright browsers are installed in the user profile, not the SYSTEM profile.
:: Point the scraper at the correct location so it works under any account.
set PLAYWRIGHT_BROWSERS_PATH=C:\Users\Claudius\AppData\Local\ms-playwright

:: Build date string: YYYY-MM-DD
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DT=%%I
set DATESTAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%

set LOG_FILE=%PROJECT_DIR%\logs\scrape-%DATESTAMP%.log

:: Redirect all output (stdout + stderr) to log file
call :main >> "%LOG_FILE%" 2>&1
exit /b %ERRORLEVEL%

:main
echo ============================================================
echo  Auto-scrape started: %DATE% %TIME%
echo ============================================================

:: Rotate logs — delete scrape logs older than 30 days
forfiles /p "%PROJECT_DIR%\logs" /m "scrape-*.log" /d -30 /c "cmd /c del @path" 2>nul

cd /d "%PROJECT_DIR%"
if %ERRORLEVEL% neq 0 (
    echo ERROR: Could not cd to %PROJECT_DIR%
    exit /b 1
)

:: Run the scraper
echo [%TIME%] Running scraper: node scrape-leafly.mjs
node scrape-leafly.mjs
set SCRAPE_EXIT=%ERRORLEVEL%

echo [%TIME%] Scraper exited with code %SCRAPE_EXIT%

if %SCRAPE_EXIT% neq 0 (
    echo ERROR: Scraper failed with exit code %SCRAPE_EXIT%. Skipping git push.
    exit /b %SCRAPE_EXIT%
)

:: Allow SYSTEM account to access this repo (git ownership check)
git config --global --add safe.directory C:/Users/Claudius/dispensary-price-scraper

:: Commit and push updated output
echo [%TIME%] Staging output/ directory...
git add output\
if %ERRORLEVEL% neq 0 (
    echo ERROR: git add failed.
    exit /b 1
)

echo [%TIME%] Committing...
git commit -m "Auto price update %DATESTAMP%"
set COMMIT_EXIT=%ERRORLEVEL%

if %COMMIT_EXIT% neq 0 (
    echo INFO: git commit exited with %COMMIT_EXIT% (possibly nothing to commit — that is OK).
    exit /b 0
)

echo [%TIME%] Pushing to origin main...
git push origin main
if %ERRORLEVEL% neq 0 (
    echo ERROR: git push failed.
    exit /b 1
)

echo [%TIME%] Done. Push succeeded.
exit /b 0
