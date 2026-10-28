/**
 * Set up sync with GitHub. One path: sign in with GitHub, name this device,
 * then use the documents already on GitHub or start new ones. A second device
 * finds the first one's documents, so it never creates a second store by
 * accident. The GitHub CLI, a token or a pasted address sit under "Other ways
 * to connect". adr: adr/two-way-sync.md
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import './SyncSetupModal.css';

interface SyncCapabilities {
  gitInstalled: boolean;
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  existingRepo: boolean;
  remoteUrl?: string;
  /** A GitHub token is stored (signed in, or a PAT pasted before). */
  signedIn?: boolean;
  /** "Sign in with GitHub" (device flow) is available on this server. */
  deviceFlow?: boolean;
  deviceName?: string;
  deviceSuggestion?: string;
}

interface DocsRepo { fullName: string; name: string; documents: number; private: boolean }

interface SyncSetupModalProps {
  onClose: () => void;
  onSetupComplete: () => void;
  /** This copy already syncs and GitHub refused its sign-in: sign in again, nothing else to choose. */
  signInAgain?: boolean;
}

type Phase = 'loading' | 'setup' | 'progress' | 'done' | 'error';
type Other = 'gh' | 'pat' | 'connect';
interface DeviceCode { userCode: string; verificationUri: string; interval: number }

function documentsLabel(n: number): string {
  return n === 1 ? '1 document' : `${n} documents`;
}

export default function SyncSetupModal({ onClose, onSetupComplete, signInAgain }: SyncSetupModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [caps, setCaps] = useState<SyncCapabilities | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  const [deviceMsg, setDeviceMsg] = useState('');
  const [repos, setRepos] = useState<DocsRepo[] | null>(null);
  const [reposError, setReposError] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [repoName, setRepoName] = useState('openwriter-docs');
  const [isPrivate, setIsPrivate] = useState(true);
  const [other, setOther] = useState<Other | null>(null);
  const [pat, setPat] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/sync/capabilities')
      .then((r) => r.json())
      .then((data: SyncCapabilities) => {
        setCaps(data);
        // The stored sign-in is the one GitHub refused, so it does not count.
        setSignedIn(!signInAgain && !!data.signedIn);
        if (data.deviceName) setDeviceName(data.deviceName);
        setPhase('setup');
      })
      .catch(() => {
        setErrorMsg('OpenWriter could not check this computer. Close this window and try again.');
        setPhase('error');
      });
  }, []);

  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  // Once signed in: look for documents already on GitHub, and suggest a name for this device.
  useEffect(() => {
    if (!signedIn) return;
    if (signInAgain) {
      // Same documents, same place on GitHub: sync now with the new sign-in.
      setPhase('progress');
      setProgressMsg('Syncing your documents...');
      fetch('/api/sync/push', { method: 'POST' }).catch(() => {}).finally(() => { onSetupComplete(); setPhase('done'); });
      return;
    }
    setRepos(null);
    setReposError('');
    fetch('/api/sync/repos')
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        // An expired sign-in shows the Sign in button with the reason, not a dead end.
        if (data.signIn) { setSignedIn(false); setDeviceMsg(data.error); return; }
        if (!r.ok) throw new Error(data.error || 'Could not reach GitHub');
        setRepos(data.repos || []);
        setDeviceName((name) => name || data.deviceSuggestion || '');
      })
      .catch((err: Error) => { setReposError(err.message); setRepos([]); });
  }, [signedIn, signInAgain, onSetupComplete]);

  // "Sign in with GitHub": show the code, then ask the server every few
  // seconds whether GitHub has approved it. adr: adr/two-way-sync.md
  const poll = useCallback((interval: number) => {
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/sync/device/poll', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'pending') { poll(data.interval || interval); return; }
        setDeviceCode(null);
        if (data.status === 'done') { setSignedIn(true); setDeviceMsg(''); return; }
        setDeviceMsg(data.status === 'expired' ? 'The code expired. Get a new one.'
          : data.status === 'denied' ? 'Sign-in was cancelled on GitHub.'
          : data.error || 'Sign-in failed. Try again.');
      } catch {
        setDeviceCode(null);
        setDeviceMsg('Sign-in failed. Try again.');
      }
    }, interval * 1000);
  }, []);

  const startSignIn = useCallback(async () => {
    setDeviceMsg('');
    try {
      const res = await fetch('/api/sync/device/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start sign-in');
      setDeviceCode(data);
      poll(data.interval || 5);
    } catch (err: any) {
      setDeviceMsg(err.message);
    }
  }, [poll]);

  const runSetup = useCallback(async (body: Record<string, any>, message: string) => {
    setPhase('progress');
    setProgressMsg(message);
    try {
      const res = await fetch('/api/sync/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, deviceName: deviceName.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Setup failed (${res.status})`);
      setPhase('done');
      onSetupComplete();
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase('error');
    }
  }, [deviceName, onSetupComplete]);

  const connectTo = (repo: DocsRepo) => runSetup({ method: 'use', repo: repo.fullName }, `Bringing your documents from ${repo.name}...`);
  // A new repo with the signed-in token: the server's token path, no token in the body.
  const createRepo = () => runSetup({ method: 'pat', repoName, isPrivate }, `Creating ${repoName} on GitHub...`);
  const runOther = () => {
    if (other === 'gh') return runSetup({ method: 'gh', repoName, isPrivate }, `Creating ${repoName} on GitHub...`);
    if (other === 'pat') return runSetup({ method: 'pat', pat, repoName, isPrivate }, `Creating ${repoName} on GitHub...`);
    return runSetup({ method: 'connect', remoteUrl, pat: pat || undefined }, 'Bringing your documents from GitHub...');
  };

  const newRepoFields = (
    <>
      <label>
        Name on GitHub
        <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="openwriter-docs" />
      </label>
      <label className="sync-checkbox">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        Private (only you can see it)
      </label>
    </>
  );

  const found = repos && repos.length > 0 ? repos[0] : null;
  const connectedTo = caps?.remoteUrl?.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

  return (
    <div className="sync-modal-overlay" onClick={onClose}>
      <div className="sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sync-modal-header">
          <h2>Sync with GitHub</h2>
          <button className="sync-modal-close" onClick={onClose}>&times;</button>
        </div>

        {phase === 'loading' && (
          <div className="sync-modal-body">
            <div className="sync-spinner" />
          </div>
        )}

        {phase === 'setup' && caps && !caps.gitInstalled && (
          <div className="sync-modal-body">
            <div className="sync-warning">
              Syncing needs Git on this computer. Install it from <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">git-scm.com</a>, then open this window again.
            </div>
          </div>
        )}

        {phase === 'setup' && caps?.gitInstalled && (
          <div className="sync-modal-body">
            <p className="sync-hint">
              {signInAgain
                ? `This copy syncs with ${connectedTo || 'your documents on GitHub'}, but GitHub stopped accepting its sign-in. Sign in again and syncing carries on. Nothing else changes.`
                : 'Your documents are kept on GitHub and stay the same on every device you write on. Changes sync by themselves.'}
            </p>

            {!signedIn && (
              <div className="sync-form">
                {!deviceCode && <button className="sync-btn primary" onClick={startSignIn}>Sign in with GitHub</button>}
                {deviceCode && (
                  <>
                    <p className="sync-hint">
                      Open <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer">{deviceCode.verificationUri}</a> and enter this code:
                    </p>
                    <div className="sync-device-code">{deviceCode.userCode}</div>
                    <p className="sync-hint">Waiting for GitHub...</p>
                  </>
                )}
                {deviceMsg && <div className="sync-warning">{deviceMsg}</div>}
              </div>
            )}

            {signedIn && repos === null && <div className="sync-spinner" />}

            {signedIn && repos !== null && (
              <div className="sync-form">
                <label>
                  Name this device
                  <input type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Maya's laptop" />
                </label>
                <p className="sync-hint">History shows which device made each change.</p>
                {reposError && <div className="sync-warning">{reposError}</div>}

                {found && !creating && (
                  <>
                    {repos!.map((r, i) => (
                      <button key={r.fullName} className={`sync-btn ${i === 0 ? 'primary' : 'secondary'} sync-btn-wide`} disabled={!deviceName.trim()} onClick={() => connectTo(r)}>
                        Use {r.name} ({documentsLabel(r.documents)})
                      </button>
                    ))}
                    <button className="sync-link" onClick={() => setCreating(true)}>Start with new, empty documents instead</button>
                  </>
                )}

                {(!found || creating) && (
                  <>
                    {creating && <p className="sync-hint">This keeps a separate set of documents. Your other devices will not see them unless they choose it too.</p>}
                    {newRepoFields}
                    <button className="sync-btn primary sync-btn-wide" disabled={!deviceName.trim() || !repoName.trim()} onClick={createRepo}>
                      Create {repoName || 'openwriter-docs'} on GitHub
                    </button>
                    {creating && <button className="sync-link" onClick={() => setCreating(false)}>Back</button>}
                  </>
                )}
              </div>
            )}

            {!signInAgain && <details className="sync-other" onToggle={(e) => {
              if (!(e.target as HTMLDetailsElement).open) { setOther(null); return; }
              if (!other) setOther(caps.ghAuthenticated ? 'gh' : 'pat');
              setDeviceName((name) => name || caps.deviceSuggestion || '');
            }}>
              <summary>Other ways to connect</summary>
              <div className="sync-tabs">
                {caps.ghAuthenticated && (
                  <button className={`sync-tab${other === 'gh' ? ' active' : ''}`} onClick={() => setOther('gh')}>GitHub CLI</button>
                )}
                <button className={`sync-tab${other === 'pat' ? ' active' : ''}`} onClick={() => setOther('pat')}>Personal Access Token</button>
                <button className={`sync-tab${other === 'connect' ? ' active' : ''}`} onClick={() => setOther('connect')}>Address on GitHub</button>
              </div>
              {other && (
                <div className="sync-form">
                  {other === 'pat' && (
                    <>
                      <p className="sync-hint">
                        Create a <a href="https://github.com/settings/tokens/new?scopes=repo&description=OpenWriter" target="_blank" rel="noreferrer">Personal Access Token</a> with <code>repo</code> access.
                      </p>
                      <label>
                        Personal Access Token
                        <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="ghp_..." />
                      </label>
                    </>
                  )}
                  {other !== 'connect' && newRepoFields}
                  {other === 'connect' && (
                    <>
                      <p className="sync-hint">Brings down every document stored there. Documents already here are kept.</p>
                      <label>
                        Address on GitHub
                        <input type="text" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://github.com/you/openwriter-docs" />
                      </label>
                      <label>
                        {signedIn ? 'Personal Access Token (optional, you are signed in)' : 'Personal Access Token (for private ones)'}
                        <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="ghp_..." />
                      </label>
                    </>
                  )}
                  {!signedIn && (
                    <label>
                      Name this device
                      <input type="text" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Maya's laptop" />
                    </label>
                  )}
                  <div className="sync-modal-actions">
                    <button
                      className="sync-btn primary"
                      onClick={runOther}
                      disabled={!deviceName.trim() || (other === 'pat' && !pat) || (other === 'connect' ? !remoteUrl : !repoName)}
                    >
                      {other === 'connect' ? 'Connect' : 'Create and connect'}
                    </button>
                  </div>
                </div>
              )}
            </details>}
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
            <p>Your documents are synced with GitHub. From now on they sync by themselves.</p>
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
