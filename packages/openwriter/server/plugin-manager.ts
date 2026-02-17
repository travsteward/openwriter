/**
 * Plugin Manager: dynamic enable/disable, config persistence, route management.
 * Replaces the one-shot loadPlugins() with a full lifecycle manager.
 */

import type { Express, Router, Request, Response, NextFunction } from 'express';
import { Router as createRouter } from 'express';
import { discoverPlugins, loadPluginModule, type DiscoveredPlugin } from './plugin-discovery.js';
import { registerPluginTools, removePluginTools } from './mcp.js';
import { readConfig, saveConfig } from './helpers.js';
import type { OpenWriterPlugin, PluginConfigField, PluginContextMenuItem } from './plugin-types.js';
import { broadcastPluginsChanged } from './ws.js';

interface ManagedPlugin {
  discovered: DiscoveredPlugin;
  plugin?: OpenWriterPlugin;
  configSchema: Record<string, PluginConfigField>;
  enabled: boolean;
  config: Record<string, string>;
  /** Middleware wrapper — skips routing when disabled */
  middleware?: (req: Request, res: Response, next: NextFunction) => void;
  /** Router holding plugin routes */
  router?: Router;
  /** Names of MCP tools registered by this plugin */
  toolNames: string[];
}

export class PluginManager {
  private app: Express;
  private plugins = new Map<string, ManagedPlugin>();

  constructor(app: Express) {
    this.app = app;
  }

  /** Scan plugins/ directory and build the available plugins map. */
  async discover(): Promise<void> {
    const discovered = discoverPlugins();
    const savedConfig = readConfig();
    const savedPlugins = savedConfig.plugins || {};

    for (const d of discovered) {
      // Load module to get configSchema
      const loaded = await loadPluginModule(d.name);

      const saved = savedPlugins[d.name];

      this.plugins.set(d.name, {
        discovered: d,
        plugin: loaded?.plugin,
        configSchema: loaded?.configSchema || {},
        enabled: false,
        config: saved?.config || {},
        toolNames: [],
      });
    }
  }

  /** Enable a plugin: import, register routes + tools, save state. */
  async enable(name: string): Promise<{ success: boolean; error?: string }> {
    const managed = this.plugins.get(name);
    if (!managed) return { success: false, error: `Plugin "${name}" not found` };
    if (managed.enabled) return { success: true };

    // Ensure plugin module is loaded
    if (!managed.plugin) {
      const loaded = await loadPluginModule(name);
      if (!loaded) return { success: false, error: `Failed to import "${name}"` };
      managed.plugin = loaded.plugin;
      managed.configSchema = loaded.configSchema;
    }

    if (!managed.plugin) return { success: false, error: `Plugin "${name}" failed to load` };
    const plugin = managed.plugin;

    // Resolve config: saved config → env vars → empty
    const resolvedConfig = this.resolveConfig(managed);

    // Register routes via togglable middleware
    if (plugin.registerRoutes) {
      const router = createRouter();
      await plugin.registerRoutes({ app: router, config: resolvedConfig });
      managed.router = router;

      // Wrap in middleware that skips when disabled
      managed.middleware = (req: Request, res: Response, next: NextFunction) => {
        if (!managed.enabled) return next();
        managed.router!(req, res, next);
      };

      this.app.use(managed.middleware);
    }

    // Register MCP tools
    if (plugin.mcpTools) {
      const tools = plugin.mcpTools(resolvedConfig);
      managed.toolNames = tools.map((t) => t.name);
      registerPluginTools(tools);
    }

    managed.enabled = true;
    managed.config = resolvedConfig;
    this.savePluginState();
    broadcastPluginsChanged();

    console.log(`[PluginManager] Enabled: ${plugin.name} v${plugin.version}`);
    return { success: true };
  }

  /** Disable a plugin: skip routes, remove tools, save state. */
  async disable(name: string): Promise<{ success: boolean; error?: string }> {
    const managed = this.plugins.get(name);
    if (!managed) return { success: false, error: `Plugin "${name}" not found` };
    if (!managed.enabled) return { success: true };

    // Remove MCP tools
    if (managed.toolNames.length > 0) {
      removePluginTools(managed.toolNames);
      managed.toolNames = [];
    }

    managed.enabled = false;
    this.savePluginState();
    broadcastPluginsChanged();

    console.log(`[PluginManager] Disabled: ${name}`);
    return { success: true };
  }

  /** Update plugin config values and save. */
  updateConfig(name: string, values: Record<string, string>): { success: boolean; error?: string } {
    const managed = this.plugins.get(name);
    if (!managed) return { success: false, error: `Plugin "${name}" not found` };

    managed.config = { ...managed.config, ...values };
    this.savePluginState();
    return { success: true };
  }

  /** Get all discovered plugins with status and config info. */
  getAvailablePlugins(): Array<{
    name: string;
    version: string;
    description: string;
    enabled: boolean;
    configSchema: Record<string, PluginConfigField>;
    config: Record<string, string>;
  }> {
    return Array.from(this.plugins.values()).map((m) => ({
      name: m.discovered.name,
      version: m.discovered.version,
      description: m.discovered.description,
      enabled: m.enabled,
      configSchema: m.configSchema,
      config: m.config,
    }));
  }

  /** Get enabled plugins' context menu items (backward-compatible with GET /api/plugins). */
  getEnabledPluginDescriptors(): Array<{ name: string; contextMenuItems: PluginContextMenuItem[] }> {
    const results: Array<{ name: string; contextMenuItems: PluginContextMenuItem[] }> = [];
    for (const managed of this.plugins.values()) {
      if (!managed.enabled || !managed.plugin) continue;
      results.push({
        name: managed.plugin.name,
        contextMenuItems: managed.plugin.contextMenuItems?.() || [],
      });
    }
    return results;
  }

  /** Resolve config values: saved config → env vars → empty. */
  private resolveConfig(managed: ManagedPlugin): Record<string, string> {
    const resolved: Record<string, string> = { ...managed.config };

    for (const [key, field] of Object.entries(managed.configSchema)) {
      if (resolved[key]) continue;
      const envVal = field.env ? process.env[field.env] : undefined;
      if (envVal) resolved[key] = envVal;
    }

    return resolved;
  }

  /** Persist enabled/config state to ~/.openwriter/config.json. */
  private savePluginState(): void {
    const pluginsState: Record<string, { enabled: boolean; config: Record<string, string> }> = {};

    for (const [name, managed] of this.plugins) {
      pluginsState[name] = {
        enabled: managed.enabled,
        config: managed.config,
      };
    }

    saveConfig({ plugins: pluginsState } as any);
  }
}
