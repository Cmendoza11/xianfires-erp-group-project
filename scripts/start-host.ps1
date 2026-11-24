# DJ's ERP - start the Accounting host for the defence (double-click DJs-ERP-Host.bat).
#   1. Starts MySQL (Laragon) if it is not running
#   2. Checks the firewall rules (runs the network setup once if they are missing)
#   3. Asks for the teammates' IPs (Enter to skip), then prepares the connection sheets in lan\
#   4. Opens the lan folder and starts Accounting (only Accounting runs on this laptop)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
$Host.UI.RawUI.WindowTitle = "DJ's ERP - Accounting host"

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }

Say "`nDJ's ERP - Accounting host`n" Cyan

# 1. MySQL
$listening = Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  $mysqld = Get-ChildItem "C:\laragon\bin\mysql\*\bin\mysqld.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $mysqld) { Say "MySQL is not running and Laragon's MySQL was not found. Open Laragon and click Start All, then run this again." Red; Read-Host "Press Enter to close"; exit 1 }
  $ini = Join-Path $mysqld.Directory.Parent.FullName "my.ini"
  Say "Starting MySQL ($($mysqld.Directory.Parent.Name)) ..."
  Start-Process -FilePath $mysqld.FullName -ArgumentList "--defaults-file=`"$ini`"", "--standalone" -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 700 }
}
if (Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue) { Say "  OK  MySQL is running" Green }
else { Say "  MySQL did not start. Open Laragon and click Start All." Red; Read-Host "Press Enter to close"; exit 1 }

# 2. Firewall (one-time; asks for administrator permission)
$rules = @(Get-NetFirewallRule -DisplayName "DJ's ERP*" -ErrorAction SilentlyContinue)
if ($rules.Count -lt 2) {
  Say "  The firewall rules are missing. Windows will ask for permission (click Yes, then type y)." Yellow
  Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\host-network-setup.ps1`""
} else { Say "  OK  firewall rules are in place" Green }

# 3. Teammates' IPs (they run ipconfig and read "IPv4 Address" under "Wireless LAN adapter Wi-Fi")
Say "`nType each teammate's laptop IP, or just press Enter if you do not have it yet:"
$lanArgs = @("scripts/lan.js", "host", "--erp-only")
foreach ($m in @(@{c="pos";n="POS & Inventory"}, @{c="hr";n="HR"}, @{c="scm";n="Procurement"}, @{c="crm";n="Customer Logs"})) {
  $ip = (Read-Host ("  {0,-16} IP" -f $m.n)).Trim()
  if ($ip -match '^\d{1,3}(\.\d{1,3}){3}$') { $lanArgs += "--$($m.c)=$ip" }
  elseif ($ip) { Say "    '$ip' is not an IP address; skipped" Yellow }
}

& node @lanArgs
if ($LASTEXITCODE -ne 0) { Say "Host setup failed (see above)." Red; Read-Host "Press Enter to close"; exit 1 }

# 4. Hand-out folder and Accounting
Start-Process explorer.exe (Resolve-Path "lan").Path
$url = (Get-Content .env | Where-Object { $_ -match '^ERP_URL_ERP=' }) -replace '^ERP_URL_ERP=', ''
Say "`nSend each teammate their 2 files from the lan folder (connect-<module>.txt and test-<module>.bat)." Cyan
Say "Accounting opens at $url  -  keep this window open; Ctrl+C stops it.`n" Cyan
if ($url) { Start-Process $url }
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
  Say "Accounting is already running on port 3000. Restart it after an IP change: close its window (Ctrl+C), then run this again." Yellow
} else {
  & node scripts/dev-all.js --only=erp
}
