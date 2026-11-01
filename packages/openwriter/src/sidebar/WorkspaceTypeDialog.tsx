import { useEffect, useRef, useState } from 'react';
import type { DocumentInfo, WorkspaceWithData } from './sidebar-types';
import { bookWorkflow, bookWorkspaceView } from '../../server/book-workspace-model';
import type { BookWorkflow } from '../../server/workspace-types';
import { checkedFetch, jsonRequest } from '../utils/request';
import { useUiText } from '../plugins/client-plugins';
import './BookWorkspace.css';

export default function WorkspaceTypeDialog({ workspace, docs, onClose, onSaved }: {
  workspace: WorkspaceWithData; docs: DocumentInfo[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const ws = workspace.workspace!;
  const view = bookWorkspaceView(ws, docs);
  const [kind, setKind] = useState(ws.workspaceType ?? 'general');
  const [outlineId, setOutlineId] = useState(ws.book?.outlineDocId ?? (view.outlines.length === 1 ? view.outlines[0].docId! : ''));
  const [manuscriptId, setManuscriptId] = useState(ws.book?.manuscriptDocId ?? '');
  const [briefId, setBriefId] = useState(ws.book?.briefDocId ?? '');
  const [workflow, setWorkflow] = useState<BookWorkflow>(bookWorkflow(ws));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const guidanceNote = useUiText('workspace.bookGuidance', 'Agents receive the brief and book guidance when working with this workspace.');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      const target = trigger?.isConnected ? trigger : document.querySelector<HTMLElement>(`[data-workspace-menu="${CSS.escape(workspace.filename)}"]`);
      target?.focus();
    };
  }, []);
  const manuscripts = view.members.filter(d => d.masterDocId === outlineId && d.variantType === 'manuscript');
  const selectedManuscript = manuscriptId || (manuscripts.length === 1 ? manuscripts[0].docId! : '');
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await checkedFetch(`/api/workspaces/${encodeURIComponent(workspace.filename)}/book`, jsonRequest('PUT', {
        workspaceType: kind,
        ...(kind === 'book' ? { outlineDocId: outlineId || null, manuscriptDocId: selectedManuscript || null, briefDocId: briefId || null, workflow } : {}),
      }));
      await onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save workspace type.'); }
    finally { setBusy(false); }
  };
  return <dialog ref={ref} className="book-workspace-dialog" aria-labelledby="workspace-type-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); void save(); }} aria-busy={busy}>
      <h2 id="workspace-type-title">{kind === 'book' ? 'Book settings' : 'Workspace type'}</h2>
      <p className="book-workspace-description">{workspace.title}</p>
      <label>Type<select autoFocus value={kind} disabled={busy} onChange={e => setKind(e.target.value as 'general' | 'book')}><option value="general">General</option><option value="book">Book</option></select></label>
      {kind === 'book' ? <>
        <fieldset className="book-workspace-method-choice" disabled={busy}>
          <legend>Workflow</legend>
          <label><input type="radio" name="book-workflow" checked={workflow === 'guided'} onChange={() => setWorkflow('guided')} />
            <span>Guided</span>
            <small>The agent runs the OpenWriter book method: interview, chapter plan, beats, drafts in your voice, staged editing. Recommended for a first book.</small></label>
          <label><input type="radio" name="book-workflow" checked={workflow === 'custom'} onChange={() => setWorkflow('custom')} />
            <span>Custom</span>
            <small>The agent follows the process defined in the brief’s How we work section and assists on request.</small></label>
        </fieldset>
        <p id="book-attachments-help">Outline and Manuscript stay pinned above your folders. Attach existing documents or create them from the pinned entries later.</p>
        <label>Outline<select value={outlineId} disabled={busy} aria-describedby="book-attachments-help" onChange={e => { setOutlineId(e.target.value); setManuscriptId(''); }}>
          <option value="">Choose later</option>{view.outlines.map(d => <option value={d.docId} key={d.docId}>{d.title}</option>)}
        </select></label>
        <label>Manuscript<select value={selectedManuscript} disabled={busy || !outlineId} onChange={e => setManuscriptId(e.target.value)}>
          <option value="">{manuscripts.length ? 'Choose a manuscript' : 'Build from the outline later'}</option>{manuscripts.map(d => <option value={d.docId} key={d.docId}>{d.title}</option>)}
        </select></label>
        <label>Attached brief<select value={briefId} disabled={busy} onChange={e => setBriefId(e.target.value)}>
          <option value="">Create or attach later</option>{view.members.filter(d => d.docId && d.contentType !== 'manuscript' && d.variantType !== 'manuscript').map(d => <option value={d.docId} key={d.docId}>{d.title}</option>)}
        </select></label>
        <p>{guidanceNote ? `${guidanceNote} ` : ''}Your documents and folders keep their current contents and locations.</p>
      </> : <p>General keeps all documents and folders. Existing book attachments are remembered if you switch back.</p>}
      {error && <p role="alert" className="book-workspace-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></footer>
    </form>
  </dialog>;
}
