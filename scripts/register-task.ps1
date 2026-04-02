$Action = New-ScheduledTaskAction -Execute "node" -Argument "scripts\send-weekly-digest.mjs" -WorkingDirectory "C:\Users\Claudius\dispensary-price-scraper"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "08:00AM"
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable -RunOnlyIfNetworkAvailable
Register-ScheduledTask -TaskName "NycWeedPriceWeeklyDigest" -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Weekly digest nycweedprice.org" -Force
Write-Host "Task registered."
Get-ScheduledTask -TaskName "NycWeedPriceWeeklyDigest" | Select-Object TaskName, State
