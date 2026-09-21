# OpenWriter npm release

Public package: openwriter. Semver is 0.x.y: patch for fixes, minor for new
user-facing features or breaking changes. Public notes describe behavior and
benefit, never private strategy. Private release history remains in the ignored
project notes.

## Prepare

1. Resolve [delivery.json](delivery.json). Work from the canonical main checkout
   only after changes have been committed, tested, and merged under its lock.
2. Confirm the public OpenWriter skill source is current and generic. The repo
   copy under skills/openwriter is the bundle source; never copy a private local
   adapter or personal worked examples over it.
3. Update the app version and lock metadata, move Unreleased changelog entries
   into that version's section, commit, integrate, and tag the release commit.
4. Run the release wrapper. It checks the tag, builds, runs the existing privacy
   and skill/plugin bundler, stamps the build, packs one tarball, pushes the
   branch/tag, records and publishes that exact tarball, proves the registry
   serves it, creates the GitHub release from public notes, then records the
   shipped commit.

```bash
Set-Location C:/openwriter
./scripts/release.ps1 -CheckOnly
./scripts/release.ps1
```

-CheckOnly prints the release plan: each of the four outward steps — push,
publish, GitHub release, deployment record — marked done or pending. It touches
nothing. Use it before and after any run to see exactly what is left.

The wrapper deliberately invokes prepublish.cjs before packing: this machine's
global npm ignore-scripts setting must not skip skill/plugin preparation. The
tested tarball is published with lifecycle scripts disabled so it cannot change
between packing and publication. Never replace the existing npm development
link; local runtime deployment uses [deploy.ps1](../scripts/deploy.ps1).

## Authentication and interruption

Use npm whoami first. If authentication is missing, use npm login --auth-type=web
and complete the browser approval. Publishing requires its own separate browser
approval, which only a human at the machine can complete, so run the wrapper in
a real terminal rather than through a tool that captures its output. Never print
a token or replace credentials merely to bypass interactive authentication.

If a run stops part way — a missed publish approval, a network failure, a closed
window — nothing needs undoing and nothing needs finishing by hand. Re-run the
same wrapper. Every outward step asks first whether it is already satisfied: the
tag and branch already on the remote, the version already on the registry, the
GitHub release already created, the deployment already recorded. Satisfied steps
are reported as skipped and the run continues from the first one that is not.

Do not republish or bump a version to recover from a partial run. Registry
integrity is re-proven on every run, whether this run published or an earlier
one did, and no deployment is recorded until every declared artifact is
verified.

That proof is against the integrity recorded beside the tarball when it was
handed to the registry, never against the tarball the current run packed: every
run rebuilds and stamps a fresh build time, so a later run's bytes differ from
the published ones and could never match. A new version is also given up to five
minutes to appear, with progress reported while waiting, because the registry's
per-version and package-level views become consistent at different times and npm
says so in its own publish output. If that wait runs out, the publish itself is
not in doubt — re-run the same wrapper to finish verifying it. A version already
on the registry with no such record cannot be proven and is refused; use
-CheckOnly to see whether any step is genuinely outstanding.
[test-release-integrity.ps1](../scripts/test-release-integrity.ps1) locks the
waiting, the bound, and the mismatch and missing-record refusals against its own
temporary records. It contacts no registry and publishes nothing.

After release, verify the registry version/integrity, GitHub tag and release,
public skill and all bundled plugins. Deploy the local-app target separately if
the local linked process also needs the new runtime.
