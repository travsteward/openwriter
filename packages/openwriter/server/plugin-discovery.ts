/**
 * Plugin discovery: scans the plugins/ directory for available plugins.
 * Reads package.json metadata without importing or loading the plugin code.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { PluginConfigField } from './plugin-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DiscoveredPlugin {
  /** npm package name (e.g. "@openwriter/plugin-authors-voice") */
  name: string;
  /** Directory name in plugins/ (e.g. "authors-voice") */
  dirName: string;
  version: string;
  description: string;
}

/**
 * Scan the plugins/ directory at the monorepo root.
 * Returns metadata from each plugin's package.json without importing code.
 * Returns [] if plugins/ doesn't exist (e.g. npm install scenario).
 */
export function discoverPlugins(): DiscoveredPlugin[] {
  // At runtime: dist/server/ → ../../../.. → monorepo root → /plugins/
  const pluginsDir = join(__dirname, '..', '..', '..', '..', 'plugins');

  if (!existsSync(pluginsDir)) return [];

  const results: DiscoveredPlugin[] = [];

  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pkgPath = join(pluginsDir, entry.name, 'package.json');
    if (!existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (!pkg.name) continue;

      results.push({
        name: pkg.name,
        dirName: entry.name,
        version: pkg.version || '0.0.0',
        description: pkg.description || '',
      });
    } catch {
      // Skip malformed package.json
    }
  }

  return results;
}

/**
 * Import a plugin by npm package name and extract its metadata.
 * Returns the plugin's configSchema and full module export.
 */
export async function loadPluginModule(name: string): Promise<{
  plugin: any;
  configSchema: Record<string, PluginConfigField>;
} | null> {
  try {
    const mod = await import(name);
    const plugin = mod.default || mod.plugin || mod;

    if (!plugin.name || !plugin.version) return null;

    return {
      plugin,
      configSchema: plugin.configSchema || {},
    };
  } catch (err: any) {
    console.error(`[PluginDiscovery] Failed to import "${name}":`, err.message);
    return null;
  }
}
