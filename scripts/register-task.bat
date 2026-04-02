@echo off
schtasks /Create /TN "NycWeedPriceWeeklyDigest" /TR "\"C:\Program Files\nodejs\node.exe\" scripts\send-weekly-digest.mjs" /SC WEEKLY /D MON /ST 08:00 /RU SYSTEM /RP "" /F
if %ERRORLEVEL% == 0 (
    echo Task registered successfully.
    schtasks /Query /TN "NycWeedPriceWeeklyDigest" /FO LIST
) else (
    echo Failed to register task. Try running as Administrator.
)
