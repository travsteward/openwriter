/**
 * Prepublish script: copies skill files and bundles plugins into dist/plugins/
 * so they ship with the npm package.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Privacy gate (FIRST — fail fast before bundling anything) ---
// Whole-repo scan for operator content (book prose, chapter/beat names, venture
// names, identity). A non-zero exit throws here and aborts `npm publish`.
// adr: CLAUDE.md § Bundled-skill hygiene / Changelog governance.
const repoRoot = path.resolve('../..');
console.log('[prepublish] Privacy gate (whole-repo scan)…');
execSync('node scripts/check-skill-privacy.mjs', { stdio: 'inherit', cwd: repoRoot });
execSync('node scripts/check-fixture-provenance.mjs', { stdio: 'inherit', cwd: repoRoot });

// --- Copy skill files ---
const skillRoot = path.resolve('../../skills/openwriter');
const skillSrc = path.join(skillRoot, 'SKILL.md');
if (fs.existsSync(skillSrc)) {
  fs.copyFileSync(skillSrc, 'skill/SKILL.md');

  // Public-safe docs only (excludes changelog.md, publish-gotchas.md)
  fs.mkdirSync('skill/docs', { recursive: true });
  for (const doc of ['welcome.md', 'setup.md', 'enrichment.md', 'footnotes.md']) {
    const src = path.join(skillRoot, 'docs', doc);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join('skill/docs', doc));
  }

  // Voice frames (5 files, all public-safe)
  const voicesSrc = path.join(skillRoot, 'voices');
  if (fs.existsSync(voicesSrc)) {
    fs.mkdirSync('skill/voices', { recursive: true });
    for (const f of fs.readdirSync(voicesSrc)) {
      if (f.endsWith('.md')) fs.copyFileSync(path.join(voicesSrc, f), path.join('skill/voices', f));
    }
  }

  // Custom Claude Code subagents (e.g. enrichment minion). Installed to
  // ~/.claude/agents/ by install-skill so the main agent can dispatch them
  // via subagent_type. Allowlist-restricted tools keep their context lean.
  const agentsSrc = path.join(skillRoot, 'agents');
  if (fs.existsSync(agentsSrc)) {
    fs.mkdirSync('skill/agents', { recursive: true });
    for (const f of fs.readdirSync(agentsSrc)) {
      if (f.endsWith('.md')) fs.copyFileSync(path.join(agentsSrc, f), path.join('skill/agents', f));
    }
  }
}

// --- Bundle plugins into dist/plugins/ ---
const pluginsRoot = path.resolve('../../plugins');
const distPlugins = path.resolve('dist/plugins');

if (!fs.existsSync(pluginsRoot)) {
  console.log('[prepublish] No plugins/ directory found, skipping plugin bundling');
  process.exit(0);
}

// Build all plugins FRESH before bundling. `npm publish` runs prepublishOnly but
// NOT `npm run build`, so without this we would bundle whatever stale dist/ already
// exists (the stale-bundle class). build-plugins.cjs is the single source of truth.
execSync('node scripts/build-plugins.cjs', { stdio: 'inherit' });

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

let count = 0;
for (const dir of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;

  const pluginDir = path.join(pluginsRoot, dir.name);
  const pkgJson = path.join(pluginDir, 'package.json');
  const distDir = path.join(pluginDir, 'dist');

  if (!fs.existsSync(pkgJson) || !fs.existsSync(distDir)) {
    console.log(`[prepublish] Skipping ${dir.name} — missing package.json or dist/`);
    continue;
  }

  const outDir = path.join(distPlugins, dir.name);
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(pkgJson, path.join(outDir, 'package.json'));
  copyDirSync(distDir, path.join(outDir, 'dist'));

  // Plugins may ship an agent skill (e.g. authors-voice) — bundle it too,
  // or the published plugin delivers tools without its instructions.
  const skillDir = path.join(pluginDir, 'skill');
  if (fs.existsSync(skillDir)) copyDirSync(skillDir, path.join(outDir, 'skill'));

  count++;
  console.log(`[prepublish] Bundled plugin: ${dir.name}`);
}

console.log(`[prepublish] Bundled ${count} plugins into dist/plugins/`);
