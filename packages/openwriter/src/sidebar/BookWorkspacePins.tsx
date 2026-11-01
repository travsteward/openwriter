import { useState } from 'react';
import type { DocumentInfo, WorkspaceWithData } from './sidebar-types';
import { bookMethod, bookWorkspaceView } from '../../server/book-workspace-model';
import { checkedFetch, jsonRequest } from '../utils/request';
import { sidebarRowProps } from './sidebar-keyboard';
import './BookWorkspace.css';

/** A projection of existing attachments; no tree move, copy or implicit build. */
export default function BookWorkspacePins({ workspace, docs, onOpen, onSettings, compact = false }: {
  workspace: WorkspaceWithData; docs: DocumentInfo[]; onOpen: (filename: string) => void;
  onSettings: () => void; compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (workspace.workspace?.workspaceType !== 'book') return null;
  const view = bookWorkspaceView(workspace.workspace, docs);
  const create = async (role: 'outline' | 'brief') => {
    if (busy) return;
    setBusy(role); setError('');
    try {
      const doc = await (await checkedFetch(`/api/workspaces/${encodeURIComponent(workspace.filename)}/book/${role}`, jsonRequest('POST', {}))).json();
      onOpen(doc.filename);
    } catch (e) { setError(e instanceof Error ? e.message : `Could not create ${role}.`); }
    finally { setBusy(null); }
  };
  const build = () => {
    if (!view.outline) return;
    if (view.manuscripts.length > 1) { onSettings(); return; }
    try { sessionStorage.setItem('ow-book-build-request', view.outline.docId!); } catch {}
    onOpen(view.outline.filename);
    window.dispatchEvent(new CustomEvent('ow-book-build-request', { detail: view.outline.docId }));
  };
  return <div className={`book-workspace-pins${compact ? ' book-workspace-pins--compact' : ''}`} role="group" aria-label={`${workspace.title} book documents`} aria-busy={!!busy}>
    <button type="button" {...sidebarRowProps()} aria-current={view.outline?.isActive ? 'page' : undefined} disabled={!!busy}
      title={view.outline?.title} onClick={() => view.outline ? onOpen(view.outline.filename) : view.outlines.length ? onSettings() : void create('outline')}>
      <span className="book-pin-icon" aria-hidden="true">◇</span><span>{busy === 'outline' ? 'Creating outline…' : view.outline ? 'Outline' : view.outlines.length ? 'Choose outline' : 'Create outline'}</span>
    </button>
    <button type="button" {...sidebarRowProps()} aria-current={view.manuscript?.isActive ? 'page' : undefined} disabled={!!busy || !view.outline}
      title={view.manuscript?.title ?? (!view.outline ? 'Create or choose the outline first' : 'Review the outline before building')}
      onClick={() => view.manuscript ? onOpen(view.manuscript.filename) : build()}>
      <span className="book-pin-icon" aria-hidden="true">▤</span><span>{view.manuscript ? 'Manuscript' : view.manuscripts.length > 1 ? 'Choose manuscript' : 'Build manuscript'}</span>
    </button>
    <div className="book-workspace-links"><button type="button" disabled={!!busy} aria-current={view.brief?.isActive ? 'page' : undefined}
      onClick={() => view.brief ? onOpen(view.brief.filename) : void create('brief')}>{busy === 'brief' ? 'Creating brief…' : view.brief ? 'Brief' : 'Create brief'}</button>
      <button type="button" disabled={!!busy} onClick={onSettings} aria-label={`Book settings for ${workspace.title}`}>Settings</button></div>
    {!compact && <div className="book-workspace-method" title="How your agent works on this book">
      <span>{bookMethod(workspace.workspace) === 'writer' ? 'Your way' : 'Step by step'}</span>
      <button type="button" disabled={!!busy} onClick={onSettings} aria-label={`Change how your agent works on ${workspace.title}`}>Change</button>
    </div>}
    {error && <p role="alert" className="book-workspace-error">{error}</p>}
  </div>;
}
