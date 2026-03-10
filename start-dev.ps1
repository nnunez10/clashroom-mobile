# Auto-detect Wi-Fi IPv4 address
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.InterfaceAlias -match "Wi-Fi" -and
    $_.IPAddress -match "^192\."
  } |
  Select-Object -First 1 -ExpandProperty IPAddress)

if (-not $ip) {
  Write-Host "Could not detect Wi-Fi IP. Falling back to LAN mode."
  npx expo start --dev-client --lan
  exit
}

$env:REACT_NATIVE_PACKAGER_HOSTNAME = $ip
Write-Host "Using REACT_NATIVE_PACKAGER_HOSTNAME=$ip"

npx expo start --dev-client --lan