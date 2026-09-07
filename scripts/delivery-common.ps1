$ErrorActionPreference = 'Stop'

function Invoke-DeliveryCommand {
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
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
