# Regression lock for the npm release's registry proof: the artifact is compared
# against the integrity recorded when it was published, and the registry is
# given bounded time to index it. Uses its own temp records and fake probes;
# contacts no registry and publishes nothing.
. "$PSScriptRoot/delivery-common.ps1"

$root = Join-Path ([IO.Path]::GetTempPath()) ("ow-release-integrity-" + [guid]::NewGuid().ToString('N'))
$spec = 'openwriter@9.9.9'
$other = 'openwriter@9.9.8'
$integrity = 'sha512-recorded=='
$failures = 0

function Assert-True {
  param([string]$Name, [bool]$Condition)
  $state = if ($Condition) { 'pass' } else { $script:failures++; 'FAIL' }
  Write-Host "  [$state] $Name"
}

function Assert-Throws {
  param([string]$Name, [scriptblock]$Action)
  $threw = $false
  try { & $Action } catch { $threw = $true }
  Assert-True $Name $threw
}

try {
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $recordPath = Get-DeliveryPublishRecordPath -Directory $root -Tag 'v9.9.9'

  # The registry is allowed to lag: a version npm has just accepted is briefly
  # absent, which is the failure this check exists to stop repeating.
  $script:attempts = 0
  $lagging = { $script:attempts++; if ($script:attempts -ge 3) { 'sha512-recorded==' } else { $null } }
  $started = Get-Date
  $waited = Wait-DeliveryValue -Name 'a lagging value' -Probe $lagging -TimeoutSeconds 20 -PollSeconds 1
  Assert-True 'a value that appears late is still returned' ($waited -eq $integrity)
  Assert-True 'waiting actually waits rather than asking once' (((Get-Date) - $started).TotalSeconds -ge 1)

  # ...but the wait is bounded, so an artifact that never appears still fails.
  $started = Get-Date
  $never = Wait-DeliveryValue -Name 'a value that never appears' -Probe { $null } -TimeoutSeconds 2 -PollSeconds 1
  $elapsed = ((Get-Date) - $started).TotalSeconds
  Assert-True 'a value that never appears gives up' ($null -eq $never)
  Assert-True 'giving up happens at the bound, not later' ($elapsed -ge 1 -and $elapsed -lt 20)

  Assert-Throws 'a pack that reports no integrity is refused' {
    Write-DeliveryPublishRecord -Path $recordPath -Spec $spec -Sha 'abc' -Integrity '' -Tarball 'openwriter-9.9.9.tgz'
  }
  Assert-True 'a refused record is not written' (!(Test-Path $recordPath))

  Assert-Throws 'a missing record refuses to prove the registry' {
    Assert-DeliveryRegistryArtifact -Spec $spec -RecordPath $recordPath -Probe { 'sha512-recorded==' } -TimeoutSeconds 0
  }

  Write-DeliveryPublishRecord -Path $recordPath -Spec $spec -Sha 'abc' -Integrity $integrity -Tarball (Join-Path $root 'openwriter-9.9.9.tgz')
  $record = Read-DeliveryPublishRecord -Path $recordPath -Spec $spec
  Assert-True 'a written record reads back its integrity' ($record.integrity -eq $integrity)
  Assert-True 'a written record keeps the tarball name, not its path' ($record.tarball -eq 'openwriter-9.9.9.tgz')
  Assert-True 'a record written for another version reads as no record' ($null -eq (Read-DeliveryPublishRecord -Path $recordPath -Spec $other))

  Assert-True 'the recorded artifact proves a matching registry' ($null -eq (Assert-DeliveryRegistryArtifact -Spec $spec -RecordPath $recordPath -Probe { 'sha512-recorded==' } -TimeoutSeconds 0 -PollSeconds 1))

  Assert-Throws 'a registry artifact that differs still fails' {
    Assert-DeliveryRegistryArtifact -Spec $spec -RecordPath $recordPath -Probe { 'sha512-something-else==' } -TimeoutSeconds 0
  }

  Assert-Throws 'a version that never reaches the registry fails after the bound' {
    Assert-DeliveryRegistryArtifact -Spec $spec -RecordPath $recordPath -Probe { $null } -TimeoutSeconds 2 -PollSeconds 1
  }

  Set-Content -Path $recordPath -Value 'not json'
  Assert-True 'an unreadable record reads as no record' ($null -eq (Read-DeliveryPublishRecord -Path $recordPath -Spec $spec))
  Assert-Throws 'an unreadable record refuses to prove the registry' {
    Assert-DeliveryRegistryArtifact -Spec $spec -RecordPath $recordPath -Probe { 'sha512-recorded==' } -TimeoutSeconds 0
  }
} finally {
  if (Test-Path $root) { Remove-Item -Path $root -Recurse -Force }
}

if ($failures -gt 0) { throw "$failures release integrity check(s) failed." }
Write-Host 'Release integrity checks passed.'
