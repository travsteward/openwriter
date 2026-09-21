# Regression lock for the local-app listener check: identity is the resolved entry
# file, so a launch through a junction is accepted and any other file is refused.
# Builds its own fixture under the temp directory; touches no process or port.
. "$PSScriptRoot/delivery-common.ps1"

$root = Join-Path ([IO.Path]::GetTempPath()) ("ow-listener-identity-" + [guid]::NewGuid().ToString('N'))
$real = Join-Path $root 'real'
$other = Join-Path $root 'other'
$link = Join-Path $root 'link'
$failures = 0

function Assert-Listener {
  param([string]$Name, [string]$CommandLine, [bool]$Expected)
  $actual = Test-DeliveryListenerEntry -CommandLine $CommandLine -Entry $script:entry
  $state = if ($actual -eq $Expected) { 'pass' } else { $script:failures++; 'FAIL' }
  Write-Host "  [$state] $Name"
}

try {
  foreach ($dir in @($real, $other)) {
    New-Item -ItemType Directory -Path (Join-Path $dir 'dist/bin') -Force | Out-Null
    Set-Content -Path (Join-Path $dir 'dist/bin/pad.js') -Value '// fixture'
  }
  New-Item -ItemType Junction -Path $link -Target $real | Out-Null
  $entry = Join-Path $real 'dist/bin/pad.js'
  $viaLink = Join-Path $link 'dist\bin\pad.js'
  $doubled = $link + '\\dist\bin\pad.js'

  Assert-Listener 'direct path is accepted' "`"node`" `"$entry`" --no-open" $true
  Assert-Listener 'junction path is accepted' "`"node`" `"$viaLink`" --no-open" $true
  Assert-Listener 'junction path with a doubled backslash is accepted' "`"node`"   `"$doubled`" --no-open" $true
  Assert-Listener 'unquoted, forward slashes and other case are accepted' ("node " + ($viaLink -replace '\\', '/').ToUpperInvariant() + " --no-open") $true
  Assert-Listener 'node options before the entry are skipped' "`"node`" --enable-source-maps `"$viaLink`"" $true
  Assert-Listener 'a different pad.js is refused' "`"node`" `"$(Join-Path $other 'dist\bin\pad.js')`" --no-open" $false
  Assert-Listener 'a missing file is refused' "`"node`" `"$(Join-Path $root 'gone\dist\bin\pad.js')`" --no-open" $false
  Assert-Listener 'a relative path is refused' '"node" "dist\bin\pad.js" --no-open' $false
  Assert-Listener 'the canonical path as a later argument is refused' "`"node`" `"$(Join-Path $other 'dist\bin\pad.js')`" `"$entry`"" $false
  Assert-Listener 'an empty command line is refused' '' $false
} finally {
  # Remove the junction itself first so the recursive delete never follows it.
  if (Test-Path $link) { [IO.Directory]::Delete($link) }
  if (Test-Path $root) { Remove-Item -Path $root -Recurse -Force }
}

if ($failures -gt 0) { throw "$failures listener identity check(s) failed." }
Write-Host 'Listener identity checks passed.'
