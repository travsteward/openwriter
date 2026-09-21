param([switch]$CheckOnly)
. "$PSScriptRoot/delivery-common.ps1"
$delivery = Get-DeliveryContext
$target = 'npm'
Invoke-DeliveryCommand -File greprag -Arguments @('deploy-gate', '--target', $target)
Invoke-DeliveryCommand -File node -Arguments @('scripts/check-build-inputs.mjs')
$sha = (Invoke-DeliveryCommand -File git -Arguments @('rev-parse', 'HEAD')).Trim()
$package = Get-Content -Raw packages/openwriter/package.json | ConvertFrom-Json
$tag = "v$($package.version)"
$tagSha = (Invoke-DeliveryCommand -File git -Arguments @('rev-parse', "$tag^{commit}")).Trim()
if ($tagSha -ne $sha) { throw 'The version tag must point at the release commit on main.' }

$remote = $delivery.profile.git.remote
$branch = $delivery.profile.git.defaultBranch
$spec = "$($package.name)@$($package.version)"

# Every mutating step below can answer "am I already done?", so an interrupted
# release resumes by re-running the same command instead of repeating work.
$isPushed = {
  $refs = Get-DeliveryCommandOutput -File git -Arguments @('ls-remote', $remote, "refs/tags/$tag", "refs/tags/$tag^{}", "refs/heads/$branch")
  if (!$refs) { return $false }
  $tagOnRemote = $false
  $branchSha = $null
  foreach ($line in ($refs -split "`n")) {
    $parts = $line.Trim() -split "\s+", 2
    if ($parts.Count -ne 2) { continue }
    if ($parts[1] -like "refs/tags/$tag*" -and $parts[0] -eq $sha) { $tagOnRemote = $true }
    if ($parts[1] -eq "refs/heads/$branch") { $branchSha = $parts[0] }
  }
  if (!$tagOnRemote -or !$branchSha) { return $false }
  if ($branchSha -eq $sha) { return $true }
  & git merge-base --is-ancestor $sha $branchSha 2>$null
  return $LASTEXITCODE -eq 0
}
$isPublished = { $null -ne (Get-DeliveryCommandOutput -File npm -Arguments @('view', $spec, 'dist.integrity')) }
$isReleased = { Test-DeliveryCommand -File gh -Arguments @('release', 'view', $tag, '--json', 'tagName') }
$isRecorded = {
  $json = Get-DeliveryCommandOutput -File greprag -Arguments @('deploy-record', 'show', '--target', $target, '--json')
  if (!$json) { return $false }
  try { return ($json | ConvertFrom-Json).record.sha -eq $sha } catch { return $false }
}

if ($CheckOnly) {
  Write-Host "Release plan for $tag ($sha):"
  $remaining = 0
  foreach ($step in @(
    @{ Name = "push $branch and $tag to $remote"; Test = $isPushed },
    @{ Name = "publish $spec to npm"; Test = $isPublished },
    @{ Name = "create GitHub release $tag"; Test = $isReleased },
    @{ Name = "record the npm deployment"; Test = $isRecorded }
  )) {
    if (!(Test-DeliveryStep -Name $step.Name -Satisfied $step.Test)) { $remaining++ }
  }
  if ($remaining -eq 0) { Write-Host 'Release complete. Nothing to do.' }
  else { Write-Host "$remaining step(s) remaining. Run ./scripts/release.ps1 to finish." }
  return
}

Invoke-DeliveryCommand -File greprag -Arguments @('deploy-lock', 'acquire', '--target', $target, '--pid', "$PID", '--label', "OpenWriter $tag")
try {
  Invoke-DeliveryCommand -File greprag -Arguments @('deploy-gate', '--target', $target, '--ignore-lock')
  $artifactDir = Join-Path $delivery.root '.greprag/runtime/releases'
  New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
  Push-Location (Join-Path $delivery.root 'packages/openwriter')
  try {
    Invoke-DeliveryCommand -File npm -Arguments @('run', 'build')
    Invoke-DeliveryCommand -File node -Arguments @('scripts/prepublish.cjs')
  } finally { Pop-Location }
  Invoke-DeliveryCommand -File node -Arguments @('scripts/stamp-build.mjs', $sha)
  Push-Location (Join-Path $delivery.root 'packages/openwriter')
  try {
    $packed = (Invoke-DeliveryCommand -File npm -Arguments @('pack', '--json', '--ignore-scripts', '--pack-destination', $artifactDir)) | ConvertFrom-Json
  } finally { Pop-Location }
  $tarball = Join-Path $artifactDir $packed[0].filename
  $notes = Join-Path $artifactDir "$tag.md"
  $changelog = Get-Content -Raw CHANGELOG.md
  $pattern = '(?ms)^## \[' + [regex]::Escape($package.version) + '\][^\n]*\n(.*?)(?=^## \[|\z)'
  $match = [regex]::Match($changelog, $pattern)
  if (!$match.Success) { throw 'A public changelog section for this version is required.' }
  [IO.File]::WriteAllText($notes, $match.Groups[1].Value.Trim())
  Invoke-DeliveryStep -Name "push $branch and $tag to $remote" -Satisfied $isPushed -Action {
    Invoke-DeliveryCommand -File git -Arguments @('push', $remote, $branch, "refs/tags/$tag")
  }
  Invoke-DeliveryStep -Name "publish $spec to npm" -Satisfied $isPublished -Action {
    Invoke-DeliveryCommand -File npm -Arguments @('whoami')
    Invoke-DeliveryCommand -File npm -Arguments @('publish', $tarball, '--access', 'public', '--ignore-scripts')
  }
  # Never skipped: whether this run published or a previous one did, the
  # registry artifact is proven against the tarball this run packed and tested.
  $integrity = (Invoke-DeliveryCommand -File npm -Arguments @('view', $spec, 'dist.integrity')).Trim()
  if ($integrity -ne $packed[0].integrity) { throw 'Registry artifact integrity does not match the tested tarball.' }
  Invoke-DeliveryStep -Name "create GitHub release $tag" -Satisfied $isReleased -Action {
    Invoke-DeliveryCommand -File gh -Arguments @('release', 'create', $tag, '--title', $tag, '--notes-file', $notes, '--latest')
  }
  Invoke-DeliveryCommand -File gh -Arguments @('release', 'view', $tag, '--json', 'tagName,isDraft,url')
  Invoke-DeliveryStep -Name 'record the npm deployment' -Satisfied $isRecorded -Action {
    Invoke-DeliveryCommand -File greprag -Arguments @('deploy-record', '--target', $target, '--sha', $sha)
  }
} catch {
  Write-Host ''
  Write-Host "Release of $tag stopped: $($_.Exception.Message)"
  Write-Host 'Nothing needs undoing. Completed steps are detected and skipped:'
  Write-Host '  ./scripts/release.ps1 -CheckOnly   shows what is left'
  Write-Host '  ./scripts/release.ps1              resumes from there'
  throw
} finally {
  & greprag deploy-lock release --target $target
}
