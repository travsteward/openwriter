$ErrorActionPreference = 'Stop'

function Invoke-DeliveryCommand {
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
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
