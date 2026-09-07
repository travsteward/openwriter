# OpenWriter delivery

The typed [delivery profile](delivery.json) is authoritative. The canonical
checkout is C:/openwriter, its default branch is main, and its remote is origin.
The user confirmed that “master” meant this existing main branch.

## Ordinary completed coding work

1. Build and test in an isolated worktree; commit the useful work.
2. Discover same-repo peers through the active harness and send one delivery
   notice. Include ready committed work; do not wait for unrelated active work.
3. Fetch origin, rebase the source worktree onto the latest canonical main, and
   rerun affected checks. Never rebase the shared main checkout.
4. In the canonical root, run the merge wrapper with the prepared branch. It
   holds the GrepRAG merge lock, fast-forwards only, and records the landed SHA.
5. Push origin/main once, then deploy the local-app target. Push alone does not
   update the linked desktop editor.

```bash
Set-Location C:/openwriter
./scripts/merge-main.ps1 -Branch codex/your-prepared-branch
git push origin main
./scripts/deploy.ps1
```

## local-app

[deploy.ps1](../scripts/deploy.ps1) owns the complete action:

- GrepRAG checks canonical location, primary checkout, branch, merge state,
  provenance claims, and the target lock.
- The repo checks that build inputs match committed HEAD, then acquires a
  process-held deploy lock. Unrelated notes, local configuration, and old
  tarballs are preserved.
- Build the app and plugins from the canonical checkout. Bind the result to
  the unchanged commit using [stamp-build.mjs](../scripts/stamp-build.mjs).
- Identify only the listener on port 5050, verify its canonical entrypoint,
  require successful save, and recheck the listener before stopping that PID.
  Leave MCP proxies and other test servers alone. Relaunch hidden.
- Verify the process-start build stamp and artifact digest, restore the active
  document when still present, then write the deployment record and release the
  lock. The stamp is served at /__build.json with Cache-Control: no-store.

Read-only preflight:

```bash
Set-Location C:/openwriter
./scripts/deploy.ps1 -CheckOnly
greprag deploy-gate --target local-app
greprag deploy-record show --target local-app
```

The running process captures its stamp at startup. Rebuilding files under an old
process cannot make that process claim it is running the new commit. A failed
proof must not be recorded as a successful deployment.

## npm

Versioned public publication is a separate [release](release.md). Ordinary local
delivery does not bump or publish an npm version. The npm target uses the same
canonical checkout, provenance checks, and a separate process-held target lock.

## Recovery

Do not take another process's lock or clear an unfinished merge without
investigating it. If main advances during a build, rebuild its new tip. If the
port owner changes, retry without killing the replacement. If startup or proof
fails, inspect the ignored local runtime logs and retry the same gated path.
Never claim success from build exit zero alone. Worktree cleanup is a separate
close/cleanup operation, never part of deployment.
