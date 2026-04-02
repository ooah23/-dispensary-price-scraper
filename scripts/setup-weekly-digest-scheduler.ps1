# ============================================================
# setup-weekly-digest-scheduler.ps1
# Registers a Monday 8 AM Task Scheduler job to send the
# weekly price digest email to all subscribers.
#
# Run once as Administrator:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-weekly-digest-scheduler.ps1
# ============================================================

$TaskName   = "NycWeedPriceWeeklyDigest"
$ProjectDir = "C:\Users\Claudius\dispensary-price-scraper"
$NodePath   = (Get-Command node -ErrorAction Stop).Source

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing task '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Action: node scripts\send-weekly-digest.mjs
$Action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "scripts\send-weekly-digest.mjs" `
    -WorkingDirectory $ProjectDir

# Trigger: every Monday at 8:00 AM
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "08:00AM"

# Principal: run as SYSTEM with highest privileges
$Principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

# Settings
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

# Register
Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $Action `
    -Trigger   $Trigger `
    -Principal $Principal `
    -Settings  $Settings `
    -Description "Send weekly NYC weed price digest to email subscribers (nycweedprice.org)" `
    -Force | Out-Null

Write-Host ""
Write-Host "Task '$TaskName' registered successfully."
Write-Host "  Schedule : Every Monday at 8:00 AM"
Write-Host "  Command  : node scripts\send-weekly-digest.mjs"
Write-Host "  Working  : $ProjectDir"
Write-Host ""
Write-Host "Make sure RESEND_API_KEY is set as a Machine-level environment variable:"
Write-Host '  [System.Environment]::SetEnvironmentVariable("RESEND_API_KEY","re_xxx...","Machine")'
Write-Host ""
Write-Host "To test immediately:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
