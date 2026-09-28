# The app a deploy relaunches outlives the deploy. On 2026-09-28 it inherited
# the pipe its caller was reading, so a deploy piped through tail never ended
# for its caller until the app itself was stopped.
# adr: adr/delivery-system.md
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-deploy-launch.ps1

$root = Split-Path -Parent $PSScriptRoot
. "$root/scripts/delivery-common.ps1"
$failures = 0

function Assert($condition, $label) {
  if ($condition) { Write-Host "  [pass] $label" }
  else { Write-Host "  [FAIL] $label"; $script:failures++ }
}

$dir = Join-Path ([IO.Path]::GetTempPath()) "ow-launch-probe-$PID"
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$server = Join-Path $dir 'server with space.js'
[IO.File]::WriteAllText($server, "console.log('server out'); console.error('server err'); setTimeout(() => {}, 30000);")

# Launch from a child PowerShell whose output this suite reads through a pipe,
# as a caller piping the deploy through tail does.
$probe = @'
. "{0}/scripts/delivery-common.ps1"
Start-DeliveryServerProcess -FilePath (Get-Command node).Source -ArgumentList @('{1}', '--no-open') -WorkingDirectory '{2}' -LogDirectory '{2}'
Write-Output 'launched'
'@ -f ($root -replace '\\', '/'), $server, $dir
$probeFile = Join-Path $dir 'probe.ps1'
[IO.File]::WriteAllText($probeFile, $probe)

try {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $probeFile 2>&1
  $elapsed = $clock.Elapsed.TotalSeconds
  Assert (($output | Out-String) -match 'launched') 'the launch returns'
  Assert ($elapsed -lt 15) "the caller's output ends with the script, not the server ($([int]$elapsed)s)"

  Start-Sleep -Milliseconds 800
  $launched = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$server*" })
  Assert ($launched.Count -eq 1) 'the server is running'
  if ($launched.Count -eq 1) {
    Assert (Test-DeliveryListenerEntry -CommandLine $launched[0].CommandLine -Entry $server) 'its command line still identifies the entry script'
  }
  Assert ((Get-Content -Raw (Join-Path $dir 'stdout.log')) -match 'server out') 'server output goes to its log'
  Assert ((Get-Content -Raw (Join-Path $dir 'stderr.log')) -match 'server err') 'server errors go to their log'
} finally {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$server*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
}

if ($failures) { Write-Host "`nDeploy launch checks FAILED ($failures)"; exit 1 }
Write-Host "`nDeploy launch checks passed."
