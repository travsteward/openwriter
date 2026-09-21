import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Only files consumed by the app/plugin build or shipped skill are artifact
// inputs. Unrelated notes, local configuration and old tarballs do not gate it.
export const buildInputs = [
  'package.json', 'tsconfig.base.json', '.greprag/delivery.json',
  '.greprag/deploy.md', '.greprag/release.md', 'scripts',
  'packages/openwriter/src', 'packages/openwriter/server', 'packages/openwriter/bin',
  'packages/openwriter/public', 'packages/openwriter/index.html',
  'packages/openwriter/package.json', 'packages/openwriter/vite.config.ts',
  'packages/openwriter/tsconfig.json', 'packages/openwriter/tsconfig.server.json',
  'packages/openwriter/scripts/build-plugins.cjs', 'packages/openwriter/scripts/prepublish.cjs',
  'plugins', 'skills/openwriter',
];
export function assertBuildInputs() {
  const dirt = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...buildInputs], { encoding: 'utf8' }).trim();
  if (dirt) throw new Error(`Build inputs differ from committed HEAD. Commit and merge them first:\n${dirt}`);
}

// Run as a script: this is a deliberate refusal, not a crash. An unhandled
// throw prints a node stack trace over the file list the reader actually
// needs, and reads as the tool breaking rather than the tool stopping.
// The thrown form stays for importers.
//
// pathToFileURL, not string surgery: a hand-built file:// prefix does not
// match node's own URL for a Windows path, and the mismatch makes this block
// silently never run — a gate that always passes, which is worse than a noisy
// one. Proven by test-delivery-failure-report.ps1.
// adr: adr/delivery-system.md
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    assertBuildInputs();
  } catch (e) {
    console.error(`\n${e.message}\n`);
    process.exit(1);
  }
}
