import { useCallback, useEffect, useState } from 'react';
import './SyncSetupModal.css';

interface SyncCapabilities {
  gitInstalled: boolean;
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  existingRepo: boolean;
  remoteUrl?: string;
}

interface SyncSetupModalProps {
  onClose: () => void;
  onSetupComplete: () => void;
}

type Phase = 'detecting' | 'setup' | 'progress' | 'done' | 'error';

export default function SyncSetupModal({ onClose, onSetupComplete }: SyncSetupModalProps) {
  const [phase, setPhase] = useState<Phase>('detecting');
  const [caps, setCaps] = useState<SyncCapabilities | null>(null);
  const [mode, setMode] = useState<'gh' | 'pat' | 'connect'>('gh');
  const [repoName, setRepoName] = useState('openwriter-docs');
  const [isPrivate, setIsPrivate] = useState(true);
  const [pat, setPat] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [progressMsg, setProgressMsg] = useState('');

  // Detect capabilities on mount
  useEffect(() => {
    fetch('/api/sync/capabilities')
      .then((r) => r.json())
      .then((data: SyncCapabilities) => {
        setCaps(data);
        if (data.ghAuthenticated) setMode('gh');
        else if (data.gitInstalled) setMode('pat');
        else setMode('pat');
        setPhase('setup');
      })
      .catch(() => {
        setErrorMsg('Failed to detect git capabilities');
        setPhase('error');
      });
  }, []);

  const handleSetup = useCallback(async () => {
    setPhase('progress');
    setProgressMsg(mode === 'connect' ? 'Connecting to repository...' : 'Creating repository and syncing...');

    try {
      const body: Record<string, any> = { method: mode, repoName, isPrivate };
      if (mode === 'pat') body.pat = pat;
      if (mode === 'connect') { body.remoteUrl = remoteUrl; body.pat = pat || undefined; }

      const res = await fetch('/api/sync/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Setup failed (${res.status})`);
      }

      setPhase('done');
      onSetupComplete();
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase('error');
    }
  }, [mode, repoName, isPrivate, pat, remoteUrl, onSetupComplete]);

  return (
    <div className="sync-modal-overlay" onClick={onClose}>
      <div className="sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sync-modal-header">
          <h2>Sync to GitHub</h2>
          <button className="sync-modal-close" onClick={onClose}>&times;</button>
        </div>

        {phase === 'detecting' && (
          <div className="sync-modal-body">
            <div className="sync-spinner" />
            <p>Detecting git configuration...</p>
          </div>
        )}

        {phase === 'setup' && caps && (
          <div className="sync-modal-body">
            {!caps.gitInstalled && (
              <div className="sync-warning">
                Git is not installed. Please <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">install git</a> first.
              </div>
            )}

            {caps.gitInstalled && (
              <>
                {/* Mode tabs */}
                <div className="sync-tabs">
                  {caps.ghAuthenticated && (
                    <button className={`sync-tab${mode === 'gh' ? ' active' : ''}`} onClick={() => setMode('gh')}>
                      GitHub CLI
                    </button>
                  )}
                  <button className={`sync-tab${mode === 'pat' ? ' active' : ''}`} onClick={() => setMode('pat')}>
                    Personal Access Token
                  </button>
                  <button className={`sync-tab${mode === 'connect' ? ' active' : ''}`} onClick={() => setMode('connect')}>
                    Connect Existing
                  </button>
                </div>

                {/* gh CLI mode */}
                {mode === 'gh' && (
                  <div className="sync-form">
                    <label>
                      Repository name
                      <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="openwriter-docs" />
                    </label>
                    <label className="sync-checkbox">
                      <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                      Private repository
                    </label>
                  </div>
                )}

                {/* PAT mode */}
                {mode === 'pat' && (
                  <div className="sync-form">
                    {!caps.ghAuthenticated && !caps.ghInstalled && (
                      <p className="sync-hint">
                        Create a <a href="https://github.com/settings/tokens/new?scopes=repo&description=OpenWriter" target="_blank" rel="noreferrer">Personal Access Token</a> with <code>repo</code> scope.
                      </p>
                    )}
                    <label>
                      Personal Access Token
                      <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="ghp_..." />
                    </label>
                    <label>
                      Repository name
                      <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="openwriter-docs" />
                    </label>
                    <label className="sync-checkbox">
                      <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                      Private repository
                    </label>
                  </div>
                )}

                {/* Connect existing mode */}
                {mode === 'connect' && (
                  <div className="sync-form">
                    <label>
                      Remote URL
                      <input type="text" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://github.com/user/repo.git" />
                    </label>
                    <label>
                      PAT (optional, for private repos)
                      <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="ghp_..." />
                    </label>
                  </div>
                )}

                <div className="sync-modal-actions">
                  <button className="sync-btn secondary" onClick={onClose}>Cancel</button>
                  <button
                    className="sync-btn primary"
                    onClick={handleSetup}
                    disabled={
                      (mode === 'pat' && !pat) ||
                      (mode === 'connect' && !remoteUrl) ||
                      (mode !== 'connect' && !repoName)
                    }
                  >
                    {mode === 'connect' ? 'Connect & Sync' : 'Create & Sync'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {phase === 'progress' && (
          <div className="sync-modal-body">
            <div className="sync-spinner" />
            <p>{progressMsg}</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="sync-modal-body">
            <div className="sync-success-icon">&#10003;</div>
            <p>Successfully synced to GitHub!</p>
            <div className="sync-modal-actions">
              <button className="sync-btn primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="sync-modal-body">
            <div className="sync-error-msg">{errorMsg}</div>
            <div className="sync-modal-actions">
              <button className="sync-btn secondary" onClick={() => setPhase('setup')}>Back</button>
              <button className="sync-btn secondary" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
