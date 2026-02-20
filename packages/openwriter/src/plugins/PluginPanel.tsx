import { useCallback, useEffect, useRef, useState } from 'react';
import './PluginPanel.css';

interface ConfigField {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  env?: string;
  description?: string;
}

interface AvailablePlugin {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  configSchema: Record<string, ConfigField>;
  config: Record<string, string>;
}

/** Pretty display name: strip @openwriter/plugin- prefix */
function displayName(name: string): string {
  return name
    .replace(/^@openwriter\/plugin-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PluginPanel() {
  const [open, setOpen] = useState(false);
  const [plugins, setPlugins] = useState<AvailablePlugin[]>([]);
  const [loadingPlugin, setLoadingPlugin] = useState<string | null>(null);
  const [expandedConfigs, setExpandedConfigs] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const fetchPlugins = useCallback(() => {
    fetch('/api/available-plugins')
      .then((r) => r.json())
      .then((data) => setPlugins(data.plugins || []))
      .catch(() => {});
  }, []);

  // Fetch on open
  useEffect(() => {
    if (open) fetchPlugins();
  }, [open, fetchPlugins]);

  // Listen for WS-driven refresh
  useEffect(() => {
    const handler = () => fetchPlugins();
    window.addEventListener('ow-plugins-changed', handler);
    return () => window.removeEventListener('ow-plugins-changed', handler);
  }, [fetchPlugins]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = useCallback(async (name: string, currentlyEnabled: boolean) => {
    setLoadingPlugin(name);
    try {
      const endpoint = currentlyEnabled ? '/api/plugins/disable' : '/api/plugins/enable';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) fetchPlugins();
    } catch {
      // ignore
    } finally {
      setLoadingPlugin(null);
    }
  }, [fetchPlugins]);

  const handleConfigBlur = useCallback((pluginName: string, key: string, value: string) => {
    fetch('/api/plugins/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: pluginName, config: { [key]: value } }),
    }).catch(() => {});
  }, []);

  return (
    <div className="plugin-wrapper" ref={ref}>
      <button
        className={`titlebar-nav-btn${open ? ' titlebar-nav-btn--active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Plugins"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22v-5" />
          <path d="M9 8V2" />
          <path d="M15 8V2" />
          <path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z" />
        </svg>
      </button>
      {open && (
        <div className="plugin-dropdown">
          <div className="plugin-dropdown-header">Plugins</div>
          {plugins.length === 0 ? (
            <div className="plugin-empty">No plugins found</div>
          ) : (
            plugins.map((p) => (
              <div key={p.name} className="plugin-item">
                <div className="plugin-item-header">
                  <div className="plugin-item-info">
                    <div className="plugin-item-name">
                      {displayName(p.name)}
                      <span className="plugin-item-version">v{p.version}</span>
                    </div>
                    {p.description && (
                      <div className="plugin-item-desc">{p.description}</div>
                    )}
                  </div>
                  <label className={`plugin-toggle${loadingPlugin === p.name ? ' loading' : ''}`}>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      disabled={loadingPlugin === p.name}
                      onChange={() => handleToggle(p.name, p.enabled)}
                    />
                    <span className="plugin-toggle-track" />
                    <span className="plugin-toggle-thumb" />
                  </label>
                </div>
                {p.enabled && Object.keys(p.configSchema).length > 0 && (
                  <div className="plugin-config-section">
                    <button
                      className="plugin-config-toggle"
                      onClick={() => setExpandedConfigs((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.name)) next.delete(p.name);
                        else next.add(p.name);
                        return next;
                      })}
                    >
                      <svg
                        className={`plugin-config-chevron${expandedConfigs.has(p.name) ? ' plugin-config-chevron--open' : ''}`}
                        width="12" height="12" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      Settings
                    </button>
                    {expandedConfigs.has(p.name) && (
                      <div className="plugin-config">
                        {Object.entries(p.configSchema).map(([key, field]) => (
                          <div key={key} className="plugin-config-field">
                            <label className="plugin-config-label">
                              {field.description || key}
                            </label>
                            <input
                              className="plugin-config-input"
                              type={key.toLowerCase().includes('key') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') ? 'password' : 'text'}
                              defaultValue={p.config[key] || ''}
                              placeholder={field.env ? `$${field.env}` : ''}
                              onBlur={(e) => handleConfigBlur(p.name, key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
