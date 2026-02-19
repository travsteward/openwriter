/**
 * Built-in update check — zero dependencies.
 * Uses Node's built-in fetch + existing config system.
 * Fire-and-forget: never blocks startup, never throws to caller.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readConfig, saveConfig } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 5000;

let cachedLatestVersion: string | null = null;

/** Compare two semver strings numerically. Returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((s) => parseInt(s, 10));
  const partsB = b.split('.').map((s) => parseInt(s, 10));
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

/** Read current package version from package.json on disk. */
function getCurrentVersion(): string {
  try {
    const pkgPath = join(__dirname, '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Check npm registry for a newer version. Fire-and-forget.
 * - Respects NO_UPDATE_NOTIFIER env var
 * - Caches result for 24h in config
 * - Logs to stderr if update available
 */
export async function checkForUpdate(): Promise<void> {
  if (process.env.NO_UPDATE_NOTIFIER) return;

  const config = readConfig();
  const now = Date.now();
  const currentVersion = getCurrentVersion();

  // Use cached result if checked within 24h
  if (config.lastUpdateCheck && config.latestVersion) {
    const lastCheck = new Date(config.lastUpdateCheck).getTime();
    if (now - lastCheck < CHECK_INTERVAL_MS) {
      if (compareVersions(currentVersion, config.latestVersion) < 0) {
        cachedLatestVersion = config.latestVersion;
        console.error(`[OpenWriter] Update available: ${currentVersion} → ${config.latestVersion} — run: npm update -g openwriter`);
      }
      return;
    }
  }

  // Fetch latest version from npm registry
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch('https://registry.npmjs.org/openwriter/latest', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return;

    const data = (await res.json()) as { version?: string };
    const latestVersion = data.version;
    if (!latestVersion) return;

    // Save to config for 24h cache
    saveConfig({
      lastUpdateCheck: new Date().toISOString(),
      latestVersion,
    });

    if (compareVersions(currentVersion, latestVersion) < 0) {
      cachedLatestVersion = latestVersion;
      console.error(`[OpenWriter] Update available: ${currentVersion} → ${latestVersion} — run: npm update -g openwriter`);
    }
  } catch {
    // Network error, timeout, abort — silently ignore
    clearTimeout(timeout);
  }
}

/** Sync getter: returns latest version string if update available, null otherwise. */
export function getUpdateInfo(): string | null {
  return cachedLatestVersion;
}
