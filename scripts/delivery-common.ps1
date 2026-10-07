$ErrorActionPreference = 'Stop'

# adr: adr/delivery-system.md
# A delivery script's failure output is read by a person deciding what to do
# next. Re-throwing after the explanation prints a PowerShell exception dump
# underneath it, which buries the guidance and reads as a crash rather than a
# deliberate stop — on 2026-09-21 that made a release that had actually
# succeeded look broken. Scripts report the cause and the next step, then exit
# non-zero so automation still sees a failure.
function Exit-DeliveryFailure {
  param([string]$Summary, [string[]]$NextSteps)
  Write-Host ''
  Write-Host $Summary
  foreach ($line in $NextSteps) { Write-Host $line }
  Write-Host ''
  exit 1
}

function Invoke-DeliveryCommand {
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}

# npm's web approval (login, publish) waits for ENTER before opening the
# browser, and an approval nobody opened times out and fails the run. npm skips
# that prompt when stdin is not a terminal and only prints the link, so the
# command runs with stdin closed and the first npmjs.com auth or login link it
# prints is opened here. Output still streams to the console as it arrives.
function Invoke-DeliveryNpmWithBrowser {
  param([string[]]$Arguments)
  $prior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $opened = $false
  try {
    $null | & npm @Arguments 2>&1 | ForEach-Object {
      $line = "$_"
      Write-Host $line
      if (!$opened -and $line -match '^\s*(https://www\.npmjs\.com/(auth|login)/\S+)') {
        $opened = $true
        Write-Host 'Opening the approval page in your browser...'
        Start-Process $Matches[1]
      }
    }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prior }
  if ($code -ne 0) { throw "npm failed with exit code $code" }
}

function Get-DeliveryCommandOutput {
  param([string]$File, [string[]]$Arguments)
  $prior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $File @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($output | Out-String).Trim()
  } catch { return $null } finally { $ErrorActionPreference = $prior }
}

function Test-DeliveryCommand {
  param([string]$File, [string[]]$Arguments)
  return $null -ne (Get-DeliveryCommandOutput -File $File -Arguments $Arguments)
}

# One node of a resumable action graph: a step knows how to tell whether it is
# already satisfied, so the same command can be re-run after any interruption.
function Test-DeliveryStep {
  param([string]$Name, [scriptblock]$Satisfied)
  $done = [bool](& $Satisfied)
  $state = if ($done) { 'done   ' } else { 'pending' }
  Write-Host "  [$state] $Name"
  return $done
}

function Invoke-DeliveryStep {
  param([string]$Name, [scriptblock]$Satisfied, [scriptblock]$Action)
  if (& $Satisfied) {
    Write-Host "[skip] $Name - already satisfied"
    return
  }
  Write-Host "[run ] $Name"
  & $Action
}

# adr: adr/delivery-system.md
# A listener is identified by the file its entry script resolves to, never by the
# text of its command line: a launch through a junction or symlink (the npm
# development link) runs the same code as a launch by the direct path.
function Get-DeliveryEntryScript {
  param([string]$CommandLine)
  $tokens = @([regex]::Matches($CommandLine, '"([^"]*)"|(\S+)') | ForEach-Object { if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value } })
  return $tokens | Select-Object -Skip 1 | Where-Object { $_ -notlike '-*' } | Select-Object -First 1
}

function Resolve-DeliveryFinalPath {
  param([string]$Path)
  # A relative path would resolve against this shell, not the listener's directory.
  if ($Path -notmatch '^([A-Za-z]:[\\/]|\\\\)') { return $null }
  $final = Get-DeliveryCommandOutput -File node -Arguments @('-e', "process.stdout.write(require('fs').realpathSync.native(process.argv[1]))", $Path)
  if (!$final) { return $null }
  return $final -replace '/', '\'
}

function Test-DeliveryListenerEntry {
  param([string]$CommandLine, [string]$Entry)
  $actual = Resolve-DeliveryFinalPath (Get-DeliveryEntryScript $CommandLine)
  $expected = Resolve-DeliveryFinalPath $Entry
  return [bool]($actual -and $expected -and [string]::Equals($actual, $expected, [StringComparison]::OrdinalIgnoreCase))
}

# adr: adr/delivery-system.md
# A server launched here outlives the script. Start-Process with redirected
# streams gives the child every inheritable handle this process holds, and a
# caller such as Git Bash passes copies of its output pipe beyond the standard
# three, so the caller waited on end-of-output until the server exited
# (2026-09-28). The launch is shell-executed, which inherits nothing, and a
# hidden cmd gives the server its own log files and an empty input.
function Start-DeliveryServerProcess {
  param([string]$FilePath, [string[]]$ArgumentList, [string]$WorkingDirectory, [string]$LogDirectory)
  $quoted = @($FilePath) + $ArgumentList | ForEach-Object { if ($_ -match '[\s"]') { "`"$_`"" } else { $_ } }
  $stdout = Join-Path $LogDirectory 'stdout.log'
  $stderr = Join-Path $LogDirectory 'stderr.log'
  $command = "/d /s /c `"$($quoted -join ' ') <NUL >`"$stdout`" 2>`"$stderr`"`""
  Start-Process -FilePath $env:ComSpec -ArgumentList $command -WorkingDirectory $WorkingDirectory -WindowStyle Hidden | Out-Null
}

# adr: adr/delivery-system.md
# A published artifact cannot be re-derived. Every run rebuilds and stamps a
# fresh build time, so a later run packs a byte-different tarball with a
# different integrity. Proof has to be recorded when the bytes are handed to
# the registry, and every later run compares the registry against that record
# rather than against whatever it happened to pack.
function Get-DeliveryPublishRecordPath {
  param([string]$Directory, [string]$Tag)
  return Join-Path $Directory "$Tag.published.json"
}

function Write-DeliveryPublishRecord {
  param([string]$Path, [string]$Spec, [string]$Sha, [string]$Integrity, [string]$Tarball)
  if (!$Integrity) { throw "The packed tarball for $Spec reported no integrity, so its publication could not be proven." }
  $record = [ordered]@{
    spec        = $Spec
    sha         = $Sha
    integrity   = $Integrity
    tarball     = [IO.Path]::GetFileName($Tarball)
    publishedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  [IO.File]::WriteAllText($Path, ($record | ConvertTo-Json))
}

# A record that is absent, unreadable, or written for another version proves
# nothing about this one, so all three read as no record at all.
function Read-DeliveryPublishRecord {
  param([string]$Path, [string]$Spec)
  if (!(Test-Path $Path)) { return $null }
  try { $record = Get-Content -Raw $Path | ConvertFrom-Json } catch { return $null }
  if (!$record -or $record.spec -ne $Spec -or !$record.integrity) { return $null }
  return $record
}

# The registry's per-version endpoint and its aggregated package document become
# consistent at different times, so a version npm has just accepted is briefly
# absent and npm says so in its own publish output. Wait for it, report
# progress, and stop at a bound rather than spinning.
function Wait-DeliveryValue {
  param([string]$Name, [scriptblock]$Probe, [int]$TimeoutSeconds = 300, [int]$PollSeconds = 15)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $waited = $false
  while ($true) {
    $value = & $Probe
    if ($value) {
      if ($waited) { Write-Host "  $Name is available." }
      return $value
    }
    $remaining = [int][Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)
    if ($remaining -le 0) { return $null }
    if (!$waited) { Write-Host "  Waiting up to $TimeoutSeconds seconds for $Name..."; $waited = $true }
    else { Write-Host "  still waiting for $Name, about $remaining seconds left..." }
    Start-Sleep -Seconds ([Math]::Min($PollSeconds, $remaining))
  }
}

function Get-DeliveryRegistryIntegrity {
  param([string]$Spec)
  # --prefer-online: a cached miss from before publication must not answer for
  # the registry while a run is waiting for that same version to appear.
  return Get-DeliveryCommandOutput -File npm -Arguments @('view', $Spec, 'dist.integrity', '--prefer-online')
}

# adr: adr/delivery-system.md
# Proof that the registry serves the bytes this pipeline built, tested and
# published. Never skipped, and never satisfied by re-deriving the artifact.
function Assert-DeliveryRegistryArtifact {
  param([string]$Spec, [string]$RecordPath, [scriptblock]$Probe = { Get-DeliveryRegistryIntegrity -Spec $Spec }, [int]$TimeoutSeconds = 300, [int]$PollSeconds = 15)
  $record = Read-DeliveryPublishRecord -Path $RecordPath -Spec $Spec
  if (!$record) {
    throw "No record of the tarball published for $Spec at $RecordPath, so the registry artifact cannot be proven against a tested build. Runs that publish write this record; a version published before the record existed has none, and -CheckOnly shows whether any step is actually outstanding."
  }
  $integrity = Wait-DeliveryValue -Name "$Spec on the registry" -Probe $Probe -TimeoutSeconds $TimeoutSeconds -PollSeconds $PollSeconds
  if (!$integrity) {
    throw "The registry did not serve $Spec within $TimeoutSeconds seconds. The publish itself is not in doubt; re-run ./scripts/release.ps1 to finish verifying it."
  }
  if ($integrity -ne $record.integrity) {
    throw "Registry artifact integrity for $Spec does not match the tarball this pipeline published."
  }
  Write-Host "Registry artifact for $Spec matches the published tarball."
}

function Get-DeliveryContext {
  $resolved = (Invoke-DeliveryCommand -File greprag -Arguments @('delivery', 'resolve', '--json')) | ConvertFrom-Json
  if ($resolved.mode -ne 'profile') { throw 'A valid committed delivery profile is required.' }
  $actual = [IO.Path]::GetFullPath((Get-Location).Path)
  $canonical = [IO.Path]::GetFullPath($resolved.profile.deploy.canonicalRoot)
  if ($actual -ne $canonical -or $actual -ne [IO.Path]::GetFullPath($resolved.root)) { throw "Run delivery from $canonical, not a worktree or package subdirectory." }
  $gitDir = (Invoke-DeliveryCommand -File git -Arguments @('rev-parse', '--absolute-git-dir')).Trim()
  $commonDir = (Invoke-DeliveryCommand -File git -Arguments @('rev-parse', '--git-common-dir')).Trim()
  $commonPath = if ([IO.Path]::IsPathRooted($commonDir)) { $commonDir } else { Join-Path $actual $commonDir }
  if ([IO.Path]::GetFullPath($gitDir) -ne [IO.Path]::GetFullPath($commonPath)) { throw 'Delivery requires the primary checkout.' }
  $branch = (Invoke-DeliveryCommand -File git -Arguments @('branch', '--show-current')).Trim()
  if ($branch -ne $resolved.profile.git.defaultBranch) { throw "Delivery requires $($resolved.profile.git.defaultBranch)." }
  return $resolved
}
