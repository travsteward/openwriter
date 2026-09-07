param([Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._/-]*$')][string]$Branch)
. "$PSScriptRoot/delivery-common.ps1"
$delivery = Get-DeliveryContext
Invoke-DeliveryCommand -File git -Arguments @('check-ref-format', '--branch', $Branch)
Invoke-DeliveryCommand -File git -Arguments @('fetch', $delivery.profile.git.remote)
Invoke-DeliveryCommand -File greprag -Arguments @('merge-lock', 'acquire', '--label', "OpenWriter: $Branch")
$released = $false
try {
  Invoke-DeliveryCommand -File git -Arguments @('merge', '--ff-only', "$($delivery.profile.git.remote)/$($delivery.profile.git.defaultBranch)")
  Invoke-DeliveryCommand -File git -Arguments @('merge', '--ff-only', $Branch)
  $landed = (Invoke-DeliveryCommand -File git -Arguments @('rev-parse', 'HEAD')).Trim()
  Invoke-DeliveryCommand -File greprag -Arguments @('merge-lock', 'release', '--landed', $landed)
  $released = $true
} finally {
  if (!$released) { & greprag merge-lock release }
}
