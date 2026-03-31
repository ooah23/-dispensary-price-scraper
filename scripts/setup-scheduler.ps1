# ============================================================
# setup-scheduler.ps1 — Register daily Task Scheduler job
# for nycweedprice.org automated scraping
#
# Run once as Administrator:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-scheduler.ps1
# ============================================================

$TaskName    = "NycWeedPriceScraper"
$ProjectDir  = "C:\Users\Claudius\dispensary-price-scraper"
$ScriptPath  = "$ProjectDir\scripts\auto-scrape.bat"
$LogDir      = "$ProjectDir\logs"

# Ensure the logs directory exists
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
    Write-Host "Created logs directory: $LogDir"
}

# Remove existing task if it exists (clean re-register)
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing task '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Action: run cmd.exe /c auto-scrape.bat so the .bat runs with a proper shell
$Action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$ScriptPath`"" `
    -WorkingDirectory $ProjectDir

# Trigger: daily at 6:00 AM
$Trigger = New-ScheduledTaskTrigger -Daily -At "06:00AM"

# Principal: run as SYSTEM with highest privileges, whether logged in or not
$Principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

# Settings: allow task to run on battery, wake to run, restart on failure
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 30) `
    -StartWhenAvailable `
    -WakeToRun `
    -RunOnlyIfNetworkAvailable

# Register the task
Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $Action `
    -Trigger   $Trigger `
    -Principal $Principal `
    -Settings  $Settings `
    -Description "Daily cannabis price scrape for nycweedprice.org. Commits and pushes updated JSON to GitHub."

Write-Host ""
Write-Host "Task '$TaskName' registered successfully."
Write-Host "  Schedule : Daily at 6:00 AM"
Write-Host "  Runs as  : SYSTEM (highest privileges, no login required)"
Write-Host "  Script   : $ScriptPath"
Write-Host "  Logs     : $LogDir\scrape-YYYY-MM-DD.log"
Write-Host ""
Write-Host "To verify: Get-ScheduledTask -TaskName '$TaskName' | Select-Object *"
Write-Host "To run now: Start-ScheduledTask -TaskName '$TaskName'"
