/**
 * Plugin loader: resolves, imports, and validates OpenWriter plugins.
 */

import type { OpenWriterPlugin, LoadedPlugin, PluginLoadResult } from './plugin-types.js';

function resolvePluginConfig(
  plugin: OpenWriterPlugin,
  globalConfig: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!plugin.configSchema) return resolved;

  for (const [key, field] of Object.entries(plugin.configSchema)) {
    // Priority: globalConfig (CLI flags) → env var → empty
    const envVal = field.env ? process.env[field.env] : undefined;
    const value = globalConfig[key] || envVal || '';
    if (value) resolved[key] = value;
  }
  return resolved;
}

export async function loadPlugins(
  names: string[],
  globalConfig: Record<string, string>,
): Promise<PluginLoadResult> {
  const plugins: LoadedPlugin[] = [];
  const errors: string[] = [];

  for (const name of names) {
    try {
      const mod = await import(name);
      const plugin: OpenWriterPlugin = mod.default || mod.plugin || mod;

      if (!plugin.name || !plugin.version) {
        errors.push(`Plugin "${name}" missing name or version`);
        continue;
      }

      const config = resolvePluginConfig(plugin, globalConfig);
      plugins.push({ plugin, config });
    } catch (err: any) {
      errors.push(`Failed to load plugin "${name}": ${err.message}`);
    }
  }

  return { plugins, errors };
}
