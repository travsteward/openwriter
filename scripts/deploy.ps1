param([switch]$CheckOnly)
. "$PSScriptRoot/delivery-common.ps1"
$delivery = Get-DeliveryContext
$target = 'local-app'
Invoke-DeliveryCommand -File greprag -Arguments @('deploy-gate', '--target', $target)
Invoke-DeliveryCommand -File node -Arguments @('scripts/check-build-inputs.mjs')
if ($CheckOnly) { return }

Invoke-DeliveryCommand -File greprag -Arguments @('deploy-lock', 'acquire', '--target', $target, '--pid', "$PID", '--label', 'OpenWriter local app')
try {
  Invoke-DeliveryCommand -File greprag -Arguments @('deploy-gate', '--target', $target, '--ignore-lock')
  $sha = (Invoke-DeliveryCommand -File git -Arguments @('rev-parse', 'HEAD')).Trim()
  $entry = Join-Path $delivery.root 'packages/openwriter/dist/bin/pad.js'
  $entryMatch = [regex]::Escape(($entry -replace '\\', '/')) + '(?:["\s]|$)'
  $listeners = @(Get-NetTCPConnection -LocalPort 5050 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($listeners.Count -gt 1) { throw 'More than one process owns port 5050.' }
  $primary = $null
  if ($listeners.Count -eq 1) {
    $primary = Get-CimInstance Win32_Process -Filter "ProcessId=$($listeners[0])"
    if (($primary.CommandLine -replace '\\', '/') -notmatch $entryMatch) { throw 'Port 5050 is not the canonical OpenWriter entrypoint.' }
  }
  Push-Location (Join-Path $delivery.root 'packages/openwriter')
  try { Invoke-DeliveryCommand -File npm -Arguments @('run', 'build') } finally { Pop-Location }
  Invoke-DeliveryCommand -File node -Arguments @('scripts/stamp-build.mjs', $sha)
  $stamp = Get-Content -Raw packages/openwriter/dist/build-info.json | ConvertFrom-Json

  $activeDocId = $null
  if ($primary) {
    $documents = Invoke-RestMethod http://localhost:5050/api/documents
    $activeDocId = ($documents | Where-Object isActive | Select-Object -First 1).docId
    $saved = Invoke-RestMethod http://localhost:5050/api/save -Method Post
    if (!$saved.success) { throw 'OpenWriter did not acknowledge saving.' }
    $currentListeners = @(Get-NetTCPConnection -LocalPort 5050 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique)
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($primary.ProcessId)"
    if ($currentListeners.Count -ne 1 -or $currentListeners[0] -ne $primary.ProcessId -or !$current -or ($current.CommandLine -replace '\\', '/') -notmatch $entryMatch) {
      throw 'The primary process changed during the build. Retry without stopping it.'
    }
    Stop-Process -Id $primary.ProcessId
  }

  $logs = Join-Path $delivery.root '.greprag/runtime/local-app'
  New-Item -ItemType Directory -Path $logs -Force | Out-Null
  $nodePath = (Get-Command node).Source
  $started = Start-Process -FilePath $nodePath -ArgumentList @($entry, '--no-open') -WorkingDirectory (Join-Path $delivery.root 'packages/openwriter') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'stdout.log') -RedirectStandardError (Join-Path $logs 'stderr.log') -PassThru
  Invoke-DeliveryCommand -File greprag -Arguments @('deploy-verify', '--origin', 'http://localhost:5050', '--sha', $sha, '--attempts', '5')
  $running = Invoke-RestMethod http://localhost:5050/__build.json
  if ($running.artifact -ne $stamp.artifact) { throw 'The running artifact differs from the verified build.' }
  if ($activeDocId) {
    $documents = Invoke-RestMethod http://localhost:5050/api/documents
    $restore = $documents | Where-Object { $_.docId -eq $activeDocId } | Select-Object -First 1
    if ($restore) {
      Invoke-RestMethod http://localhost:5050/api/documents/switch -Method Post -ContentType application/json -Body (@{ filename = $restore.filename } | ConvertTo-Json) | Out-Null
    }
  }
  Invoke-DeliveryCommand -File greprag -Arguments @('deploy-record', '--target', $target, '--sha', $sha)
  Write-Output "OpenWriter $sha verified on port 5050 (PID $($started.Id))."
} finally {
  & greprag deploy-lock release --target $target
}
