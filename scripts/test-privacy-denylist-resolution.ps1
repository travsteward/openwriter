# Regression lock for the push privacy gate's personal-term rules.
#
# The failure being locked out: the personal denylist is gitignored, a git
# worktree checks out tracked files only, so in a worktree the file was absent,
# personal-term checking was skipped, and the gate printed "clean" and exited 0.
# Every machine-authored commit is made in a worktree, so that was the gate
# half-running exactly where it mattered most.
#
# This builds a throwaway repo with a worktree and a denylist of INVENTED terms.
# It never reads, copies or names the operator's real denylist.
#
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-privacy-denylist-resolution.ps1

$ErrorActionPreference = 'Stop'

$gate = Join-Path $PSScriptRoot 'check-push-privacy.mjs'
$root = Join-Path ([IO.Path]::GetTempPath()) ("ow-privacy-denylist-" + [guid]::NewGuid().ToString('N'))
$main = Join-Path $root 'main'
$tree = Join-Path $root 'wt'
$failures = 0

# Invented vocabulary standing in for the operator's private terms.
$secretTerm = 'Quillhaven'
$denylistJson = '["\\bquillhaven\\b", "marrowdeep"]'

function Assert-True {
  param([string]$Name, [bool]$Condition)
  $state = if ($Condition) { 'pass' } else { $script:failures++; 'FAIL' }
  Write-Host "  [$state] $Name"
}

function Invoke-Gate {
  # Runs the real gate from $Cwd over the unpushed commits of HEAD, the way the
  # pre-push hook does: the ref line arrives on stdin.
  param([string]$Cwd)
  Push-Location $Cwd
  # The gate writes its refusals and blocks to stderr, which a Stop preference
  # would turn into a terminating error before the exit code could be read.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $sha = (git rev-parse HEAD).Trim()
    $line = "refs/heads/main $sha refs/heads/main 0000000000000000000000000000000000000000"
    $out = ($line | & node $gate origin 2>&1 | Out-String)
    return [pscustomobject]@{ Code = $LASTEXITCODE; Output = $out }
  } finally { $ErrorActionPreference = $prev; Pop-Location }
}

try {
  New-Item -ItemType Directory -Path $main -Force | Out-Null
  Push-Location $main
  try {
    git init --quiet --initial-branch=main 2>&1 | Out-Null
    git config user.email 'test@example.com' | Out-Null
    git config user.name 'Privacy Gate Test' | Out-Null
    Set-Content -Path (Join-Path $main '.gitignore') -Value 'scripts/privacy-denylist.local.json'
    git add -A 2>&1 | Out-Null
    git commit --quiet -m 'base' 2>&1 | Out-Null
    git update-ref refs/remotes/origin/main HEAD 2>&1 | Out-Null

    # The denylist lives ONLY in the main checkout, gitignored — the real shape.
    New-Item -ItemType Directory -Path (Join-Path $main 'scripts') -Force | Out-Null
    Set-Content -Path (Join-Path $main 'scripts/privacy-denylist.local.json') -Value $denylistJson

    git worktree add --quiet -b chip/test $tree 2>&1 | Out-Null
  } finally { Pop-Location }

  Assert-True 'the worktree does not have the denylist (it is gitignored)' `
    (!(Test-Path (Join-Path $tree 'scripts/privacy-denylist.local.json')))

  # --- a personal term committed in a worktree must be refused -------------
  Push-Location $tree
  try {
    git config user.email 'test@example.com' | Out-Null
    git config user.name 'Privacy Gate Test' | Out-Null
    Set-Content -Path (Join-Path $tree 'notes.md') -Value "A chapter about $secretTerm."
    git add -A 2>&1 | Out-Null
    git commit --quiet -m 'add notes' 2>&1 | Out-Null
  } finally { Pop-Location }

  $r = Invoke-Gate -Cwd $tree
  Assert-True 'a personal term committed in a worktree BLOCKS the push' ($r.Code -eq 1)
  Assert-True 'the block names the file it found the term in' ($r.Output -match 'notes\.md')

  # --- a clean commit in the same worktree still passes ---------------------
  Push-Location $tree
  try {
    Set-Content -Path (Join-Path $tree 'notes.md') -Value 'A chapter about nothing in particular.'
    git commit --quiet -am 'scrub notes' 2>&1 | Out-Null
    # The original commit still carries the term, so rewrite rather than revert.
    git reset --quiet --hard HEAD~2 2>&1 | Out-Null
    Set-Content -Path (Join-Path $tree 'notes.md') -Value 'A chapter about nothing in particular.'
    git add -A 2>&1 | Out-Null
    git commit --quiet -m 'add clean notes' 2>&1 | Out-Null
  } finally { Pop-Location }

  $r = Invoke-Gate -Cwd $tree
  Assert-True 'a clean commit in a worktree passes' ($r.Code -eq 0)
  Assert-True 'a passing run states which rules ran' ($r.Output -match 'generic \+ personal')
  Assert-True 'a passing run names the main checkout as the source of the rules' ($r.Output -match 'main checkout')

  # --- no denylist anywhere: refuse, do not pass ---------------------------
  Remove-Item (Join-Path $main 'scripts/privacy-denylist.local.json') -Force
  $r = Invoke-Gate -Cwd $tree
  Assert-True 'no denylist anywhere REFUSES rather than passing' ($r.Code -eq 2)
  Assert-True 'the refusal lists where it looked' ($r.Output -match 'Looked in')

  # --- absence can be acknowledged, and then it is stated out loud ----------
  $env:OPENWRITER_PRIVACY_NO_DENYLIST = '1'
  try {
    $r = Invoke-Gate -Cwd $tree
    Assert-True 'an acknowledged absence runs generic checks only' ($r.Code -eq 0)
    Assert-True 'the acknowledged run says personal checking is off' ($r.Output -match 'GENERIC ONLY')
  } finally { Remove-Item Env:\OPENWRITER_PRIVACY_NO_DENYLIST }

  # --- an explicit path is honoured ----------------------------------------
  $fixture = Join-Path $root 'fixture-denylist.json'
  Set-Content -Path $fixture -Value $denylistJson
  Push-Location $tree
  try {
    Set-Content -Path (Join-Path $tree 'notes.md') -Value "Another look at $secretTerm."
    git commit --quiet -am 'reintroduce the term' 2>&1 | Out-Null
  } finally { Pop-Location }
  $env:OPENWRITER_PRIVACY_DENYLIST = $fixture
  try {
    $r = Invoke-Gate -Cwd $tree
    Assert-True 'a denylist given by explicit path still blocks the term' ($r.Code -eq 1)
  } finally { Remove-Item Env:\OPENWRITER_PRIVACY_DENYLIST }
} finally {
  if (Test-Path $root) { Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($failures -gt 0) {
  Write-Host "`n$failures check(s) failed." -ForegroundColor Red
  exit 1
}
Write-Host "`nprivacy denylist resolution: all checks passed." -ForegroundColor Green
