import { execFileSync } from 'node:child_process';

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
assertBuildInputs();
