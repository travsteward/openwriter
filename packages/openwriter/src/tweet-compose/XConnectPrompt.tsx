/**
 * XConnectPrompt — contextual activation for X API plugin.
 * Appears inline when user clicks Post but X is not connected.
 * Collects 4 OAuth credentials, enables the plugin, and verifies connection.
 */

import { useState } from 'react';

interface XConnectPromptProps {
  onConnected: () => void;
  onCancel: () => void;
}

const PLUGIN_NAME = '@openwriter/plugin-x-api';

const FIELDS = [
  { key: 'api-key', label: 'API Key', env: 'X_API_KEY' },
  { key: 'api-secret', label: 'API Secret', env: 'X_API_SECRET' },
  { key: 'access-token', label: 'Access Token', env: 'X_ACCESS_TOKEN' },
  { key: 'access-token-secret', label: 'Access Token Secret', env: 'X_ACCESS_TOKEN_SECRET' },
] as const;

export default function XConnectPrompt({ onConnected, onCancel }: XConnectPromptProps) {
  const [values, setValues] = useState<Record<string, string>>({
    'api-key': '',
    'api-secret': '',
    'access-token': '',
    'access-token-secret': '',
  });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const allFilled = FIELDS.every((f) => values[f.key].trim());

  const handleConnect = async () => {
    setConnecting(true);
    setError('');

    try {
      // 1. Save config
      const configRes = await fetch('/api/plugins/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: PLUGIN_NAME, config: values }),
      });
      if (!configRes.ok) throw new Error('Failed to save config');

      // 2. Enable plugin
      const enableRes = await fetch('/api/plugins/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: PLUGIN_NAME }),
      });
      const enableData = await enableRes.json();
      if (!enableData.success) throw new Error(enableData.error || 'Failed to enable plugin');

      // 3. Verify connection
      const statusRes = await fetch('/api/x/status');
      const statusData = await statusRes.json();

      if (statusData.connected) {
        onConnected();
      } else {
        setError(statusData.error || 'Could not verify X credentials. Check your API keys.');
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="x-connect-prompt">
      <div className="x-connect-header">
        <span className="x-connect-title">Connect your X account to post</span>
        <button className="x-connect-cancel" onClick={onCancel} title="Cancel">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z" />
          </svg>
        </button>
      </div>

      <div className="x-connect-fields">
        {FIELDS.map((f) => (
          <div key={f.key} className="x-connect-field">
            <label className="x-connect-label">{f.label}</label>
            <input
              type="password"
              className="x-connect-input"
              value={values[f.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.env}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        ))}
      </div>

      {error && <div className="x-connect-error">{error}</div>}

      <div className="x-connect-actions">
        <a
          className="x-connect-dev-link"
          href="https://developer.x.com/en/portal/dashboard"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get credentials
        </a>
        <button
          className="x-connect-btn"
          onClick={handleConnect}
          disabled={!allFilled || connecting}
        >
          {connecting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
