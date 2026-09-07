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
if ($CheckOnly) { return }

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
  Invoke-DeliveryCommand -File git -Arguments @('push', $delivery.profile.git.remote, $delivery.profile.git.defaultBranch, "refs/tags/$tag")
  Invoke-DeliveryCommand -File npm -Arguments @('whoami')
  Invoke-DeliveryCommand -File npm -Arguments @('publish', $tarball, '--access', 'public', '--ignore-scripts')
  $integrity = (Invoke-DeliveryCommand -File npm -Arguments @('view', "$($package.name)@$($package.version)", 'dist.integrity')).Trim()
  if ($integrity -ne $packed[0].integrity) { throw 'Registry artifact integrity does not match the tested tarball.' }
  Invoke-DeliveryCommand -File gh -Arguments @('release', 'create', $tag, '--title', $tag, '--notes-file', $notes, '--latest')
  Invoke-DeliveryCommand -File gh -Arguments @('release', 'view', $tag, '--json', 'tagName,isDraft,url')
  Invoke-DeliveryCommand -File greprag -Arguments @('deploy-record', '--target', $target, '--sha', $sha)
} finally {
  & greprag deploy-lock release --target $target
}
