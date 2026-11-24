# DJ's ERP - host laptop network setup (run by the host, as administrator). Run it once.
# Lets the teammates' laptops reach this one:
#   1. Firewall rule "DJ's ERP MySQL"   : TCP 3306       from the SAME network only (LocalSubnet)
#   2. Firewall rule "DJ's ERP modules" : TCP 3000-3004  from the SAME network only (LocalSubnet)
#   3. The current Wi-Fi is set to Private (Windows trusts it more)
# The rules work on any Wi-Fi or hotspot (school, phone), so nothing needs changing on a new network,
# but only laptops on the same network can connect. MySQL "root" stays localhost-only; the network
# accounts (djs_pos, djs_hr, ...) all have long random passwords.
# Run: npm run host-network   (or right-click this file > Run with PowerShell)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "This needs administrator rights. Windows will ask you to allow it." -ForegroundColor Yellow
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}

Write-Host ""
Write-Host "DJ's ERP host network setup" -ForegroundColor Cyan
Write-Host "This will:"
Write-Host "  1. Allow MySQL      (TCP 3306)      from laptops on the same network"
Write-Host "  2. Allow ERP pages  (TCP 3000-3004) from laptops on the same network"
Write-Host "  3. Turn off Windows rules that BLOCK MySQL or Node (left by a Cancel on 'Allow access?')"
Write-Host "  4. Set the connected Wi-Fi to Private"
$answer = Read-Host "Continue? (y/n)"
if ($answer -notmatch '^[yY]') { Write-Host "Nothing changed."; Read-Host "Press Enter to close"; exit }

$rules = @(
  @{ Name = "DJ's ERP MySQL"; Port = "3306" },
  @{ Name = "DJ's ERP modules"; Port = "3000-3004" }
)
foreach ($r in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
  if ($existing) {
    $existing | Set-NetFirewallRule -Enabled True -Profile Any -Action Allow
    $existing | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
    Write-Host "  OK  updated '$($r.Name)' (TCP $($r.Port), same network, any Wi-Fi)" -ForegroundColor Green
  } else {
    New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Protocol TCP -LocalPort $r.Port -Action Allow -Profile Any -RemoteAddress LocalSubnet | Out-Null
    Write-Host "  OK  added '$($r.Name)' (TCP $($r.Port), same network, any Wi-Fi)" -ForegroundColor Green
  }
}

# "Block" beats "Allow" in Windows Firewall. Clicking Cancel on Windows' "Allow mysqld / node?" prompt
# leaves Block rules for MySQL or Node, which would cancel the rules above. Turn only those off.
Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | ForEach-Object {
  $program = ($_ | Get-NetFirewallApplicationFilter).Program
  if ($program -match '\\(mysqld|node)\.exe$') {
    $_ | Set-NetFirewallRule -Enabled False
    Write-Host "  OK  turned off block rule '$($_.DisplayName)' ($([IO.Path]::GetFileName($program)), $($_.Profile))" -ForegroundColor Green
  }
}

Get-NetConnectionProfile | ForEach-Object {
  if ($_.NetworkCategory -ne 'Private') {
    try {
      Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
      Write-Host "  OK  $($_.InterfaceAlias) ($($_.Name)) is now Private" -ForegroundColor Green
    } catch {
      Write-Host "  --  could not change $($_.InterfaceAlias) to Private (the firewall rules still work)" -ForegroundColor Yellow
    }
  } else {
    Write-Host "  OK  $($_.InterfaceAlias) ($($_.Name)) is Private" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "Done. You do not need to run this again on a new Wi-Fi." -ForegroundColor Cyan
Read-Host "Press Enter to close"
