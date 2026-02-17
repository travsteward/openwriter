/**
 * OpenWriter Plugin API types.
 * Plugins extend the editor with routes, MCP tools, and context menu items.
 */

import type { Express } from 'express';

export interface OpenWriterPlugin {
  name: string;
  version: string;
  description?: string;
  configSchema?: Record<string, PluginConfigField>;
  registerRoutes?(ctx: PluginRouteContext): void | Promise<void>;
  mcpTools?(config: Record<string, string>): PluginMcpTool[];
  contextMenuItems?(): PluginContextMenuItem[];
}

export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  env?: string;
  description?: string;
}

export interface PluginRouteContext {
  app: Express;
  config: Record<string, string>;
}

export interface PluginMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface PluginContextMenuItem {
  label: string;
  shortcut?: string;
  action: string;
  condition?: 'has-selection' | 'always';
  promptForInput?: boolean;
}

export interface PluginActionPayload {
  action: string;
  selectedNodes: any[];
  selectedNodeIds: string[];
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  instruction?: string;
}

export interface PluginActionResponse {
  nodes?: any[];
  nodeIds?: string[];
  action?: string;
  error?: string;
  success?: boolean;
}

export interface LoadedPlugin {
  plugin: OpenWriterPlugin;
  config: Record<string, string>;
}

export interface PluginLoadResult {
  plugins: LoadedPlugin[];
  errors: string[];
}
