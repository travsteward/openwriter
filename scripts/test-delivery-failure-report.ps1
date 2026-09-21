# A delivery script's failure must read as a deliberate stop with a next step,
# not a crash. Re-throwing printed a PowerShell exception dump under the
# explanation and buried it; on 2026-09-21 that made a release that had in fact
# succeeded look broken.
# adr: adr/delivery-system.md
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-delivery-failure-report.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$failures = 0

function Assert($condition, $label) {
  if ($condition) { Write-Host "  [pass] $label" }
  else { Write-Host "  [FAIL] $label"; $script:failures++ }
}

# Drive the real helper in a child PowerShell so `exit` is observable.
$probe = @'
. "{0}/scripts/delivery-common.ps1"
Exit-DeliveryFailure -Summary "Release of v1.2.3 stopped: npm failed with exit code 1" -NextSteps @(
  "Nothing needs undoing."
  "  ./scripts/release.ps1   resumes from there"
)
Write-Host "UNREACHABLE"
'@ -f ($root -replace '\\', '/')

$probeFile = Join-Path ([IO.Path]::GetTempPath()) "ow-failure-probe-$PID.ps1"
[IO.File]::WriteAllText($probeFile, $probe)
try {
  $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $probeFile 2>&1
  $code = $LASTEXITCODE
  $text = ($output | Out-String)

  Assert ($code -eq 1) 'a reported failure exits non-zero'
  Assert ($text -match 'Release of v1\.2\.3 stopped: npm failed with exit code 1') 'the cause is stated'
  Assert ($text -match 'resumes from there') 'the next step is shown'
  Assert ($text -notmatch 'UNREACHABLE') 'execution stops at the report'

  # The whole point: no PowerShell exception furniture after the message.
  Assert ($text -notmatch 'CategoryInfo') 'no CategoryInfo block'
  Assert ($text -notmatch 'FullyQualifiedErrorId') 'no FullyQualifiedErrorId block'
  Assert ($text -notmatch 'at <ScriptBlock>') 'no stack frames'
  Assert ($text -notmatch '(?m)^\s*\+\s+~~~') 'no caret underline of source'
  Assert ($text -notmatch 'Exception:') 'not rendered as an exception'
} finally {
  Remove-Item $probeFile -ErrorAction SilentlyContinue
}

# Every delivery script must route failure through the helper, not a rethrow.
foreach ($name in @('release.ps1', 'deploy.ps1', 'merge-main.ps1')) {
  $body = Get-Content -Raw (Join-Path $root "scripts/$name")
  Assert ($body -match 'Exit-DeliveryFailure') "$name reports through the shared helper"
  Assert ($body -notmatch '(?m)^\s*throw\s*$') "$name does not bare-rethrow"
}

# check-build-inputs refuses as a script, and that refusal must actually run.
# Guarding "am I the entry point?" by hand-building a file:// string does not
# match node's own URL for a Windows path, which turns the gate into a no-op
# that always passes. Prove it fires by giving it real dirt.
$dirtFile = Join-Path $root 'scripts/.build-input-probe.tmp'
try {
  [IO.File]::WriteAllText($dirtFile, "probe`n")
  # A native command writing to stderr is the expected result here, not a
  # PowerShell error; 'Stop' would abort the suite on it.
  $prior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & node (Join-Path $root 'scripts/check-build-inputs.mjs') 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prior
  $text = ($out | Out-String)

  Assert ($code -eq 1) 'check-build-inputs refuses a dirty build input'
  Assert ($text -match 'Build inputs differ from committed HEAD') 'it names the problem'
  Assert ($text -match 'build-input-probe') 'it lists the offending path'
  Assert ($text -notmatch 'at assertBuildInputs') 'no node stack frames'
  Assert ($text -notmatch 'ModuleJob') 'no node module internals'
} finally {
  Remove-Item $dirtFile -ErrorAction SilentlyContinue
}

# Parse every delivery script so a malformed edit cannot pass this suite.
foreach ($name in @('delivery-common.ps1', 'release.ps1', 'deploy.ps1', 'merge-main.ps1')) {
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $root "scripts/$name"), [ref]$null, [ref]$errors)
  Assert ($errors.Count -eq 0) "$name parses"
}

if ($failures) { Write-Host "`nFailure-report checks FAILED ($failures)"; exit 1 }
Write-Host "`nFailure-report checks passed."
