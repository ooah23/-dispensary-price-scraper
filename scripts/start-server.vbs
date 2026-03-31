Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Claudius\dispensary-price-scraper"
WshShell.Run "node serve-ui.mjs", 0, False
