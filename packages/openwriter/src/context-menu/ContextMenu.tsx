import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

import { applyNodeChangesFromBridge } from '../decorations/bridge';

interface PluginMenuItem {
  label: string;
  shortcut?: string;
  action: string;
  condition?: 'has-selection' | 'always';
  promptForInput?: boolean;
}

type CoreAction = 'delete' | 'link' | 'unlink';

interface MenuItem {
  action: string;
  label: string;
  shortcut?: string;
  isPlugin?: boolean;
  promptForInput?: boolean;
}

interface ContextMenuProps {
  editorRef: React.MutableRefObject<Editor | null>;
}

interface MenuPosition {
  x: number;
  y: number;
}

const CORE_ACTIONS: Array<{ action: CoreAction; label: string; shortcut?: string }> = [
  { action: 'delete', label: 'Delete', shortcut: 'D' },
];

export default function ContextMenu({ editorRef }: ContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customAction, setCustomAction] = useState('');
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [docList, setDocList] = useState<Array<{ filename: string; title: string }>>([]);
  const [linkedDocs, setLinkedDocs] = useState<string[]>([]);
  const [showNewLinkInput, setShowNewLinkInput] = useState(false);
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [pluginItems, setPluginItems] = useState<PluginMenuItem[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch plugin menu items on mount
  useEffect(() => {
    fetch('/api/plugins')
      .then((r) => r.json())
      .then((data) => {
        const items: PluginMenuItem[] = [];
        for (const plugin of data.plugins || []) {
          items.push(...(plugin.contextMenuItems || []));
        }
        setPluginItems(items);
      })
      .catch(() => {});
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setVisible(false);
        setShowCustom(false);
        setShowLinkPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Check if selection is inside a link
  const isOnLink = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return false;
    return editor.isActive('link');
  }, [editorRef]);

  // Build dynamic actions list based on context
  const getActions = useCallback((): MenuItem[] => {
    const editor = editorRef.current;
    const { from, to } = editor?.state.selection || { from: 0, to: 0 };
    const hasSelection = from !== to;

    // Plugin items first (filtered by condition)
    const items: MenuItem[] = [];
    for (const pi of pluginItems) {
      if (pi.condition === 'has-selection' && !hasSelection) continue;
      items.push({
        action: pi.action,
        label: pi.label,
        shortcut: pi.shortcut,
        isPlugin: true,
        promptForInput: pi.promptForInput,
      });
    }

    // Core actions
    for (const ca of CORE_ACTIONS) {
      items.push(ca);
    }
    if (hasSelection) {
      items.push({ action: 'link', label: 'Link to doc', shortcut: 'L' });
    }
    if (isOnLink()) {
      items.push({ action: 'unlink', label: 'Unlink' });
    }
    return items;
  }, [editorRef, isOnLink, pluginItems]);

  // Open on right-click in editor
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const editor = editorRef.current;
      if (!editor) return;

      const editorEl = editor.view.dom;
      if (!editorEl.contains(e.target as Node)) return;

      e.preventDefault();
      setPosition({ x: e.clientX, y: e.clientY });
      setVisible(true);
      setShowCustom(false);
      setShowLinkPicker(false);
    };
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [editorRef]);

  const getSelectedNodes = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return { nodes: [], nodeIds: [] };

    const { from, to } = editor.state.selection;
    const nodes: any[] = [];
    const nodeIds: string[] = [];

    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isBlock && node.type.name !== 'doc') {
        const json = node.toJSON();
        nodes.push(json);
        if (node.attrs.id) nodeIds.push(node.attrs.id);
      }
    });

    return { nodes, nodeIds };
  }, [editorRef]);

  const callPluginAction = useCallback(async (action: string, instruction?: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    const { nodes, nodeIds } = getSelectedNodes();
    if (nodes.length === 0) return;

    setLoading(true);
    setVisible(false);
    setShowCustom(false);

    const { from, to } = editor.state.selection;
    const loadingId = `ctx-${Date.now()}`;
    editor.commands.applyLoadingEffect(loadingId, from, to, 'paragraph');

    try {
      const contextBefore: string[] = [];
      const contextAfter: string[] = [];
      let foundSelection = false;

      editor.state.doc.descendants((node, pos) => {
        if (node.isBlock && node.type.name !== 'doc') {
          if (pos >= from && pos < to) {
            foundSelection = true;
          } else if (!foundSelection) {
            contextBefore.push(node.textContent);
          } else {
            contextAfter.push(node.textContent);
          }
        }
      });

      const body: any = {
        nodes,
        action,
        nodeIds,
        contextBefore: contextBefore.slice(-3).join('\n'),
        contextAfter: contextAfter.slice(0, 3).join('\n'),
      };
      if (instruction) body.instruction = instruction;

      const res = await fetch(`${window.location.origin}/api/voice/apply-editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) return;

      const data = await res.json();
      if (data.success && data.nodes) {
        applyNodeChangesFromBridge(editor, data.nodes, nodeIds, action);
      }
    } catch (err) {
      console.error('[ContextMenu] Plugin action failed:', err);
    } finally {
      editor.commands.removeLoadingEffect(loadingId);
      setLoading(false);
    }
  }, [editorRef, getSelectedNodes]);

  const handleAction = useCallback((item: MenuItem) => {
    const { action, isPlugin, promptForInput } = item;

    if (isPlugin && promptForInput) {
      setCustomAction(action);
      setShowCustom(true);
      return;
    }
    if (isPlugin) {
      callPluginAction(action);
      return;
    }
    if (action === 'delete') {
      const editor = editorRef.current;
      if (editor) {
        const { from, to } = editor.state.selection;
        editor.state.doc.nodesBetween(from, to, (node) => {
          if (node.isBlock && node.type.name !== 'doc' && node.attrs.id) {
            applyNodeChangesFromBridge(editor, [], [node.attrs.id], 'delete');
          }
        });
      }
      setVisible(false);
      return;
    }
    if (action === 'link') {
      const editor = editorRef.current;
      if (editor) {
        const hrefs: string[] = [];
        editor.state.doc.descendants((node) => {
          node.marks?.forEach((mark: any) => {
            if (mark.type.name === 'link' && mark.attrs?.href?.startsWith('doc:')) {
              const file = mark.attrs.href.slice(4);
              if (!hrefs.includes(file)) hrefs.push(file);
            }
          });
        });
        setLinkedDocs(hrefs);
      }
      fetch('/api/documents')
        .then((r) => r.json())
        .then((docs) => {
          if (Array.isArray(docs)) {
            setDocList(docs.map((d: any) => ({ filename: d.filename, title: d.title })));
          }
          setShowNewLinkInput(false);
          setNewLinkTitle('');
          setShowLinkPicker(true);
        })
        .catch(() => {});
      return;
    }
    if (action === 'unlink') {
      const editor = editorRef.current;
      if (editor) {
        editor.chain().focus().unsetLink().run();
      }
      setVisible(false);
      return;
    }
  }, [callPluginAction, editorRef]);

  const handleCustomSubmit = useCallback(() => {
    if (customInput.trim()) {
      callPluginAction(customAction, customInput.trim());
      setCustomInput('');
      setCustomAction('');
    }
  }, [callPluginAction, customAction, customInput]);

  const handleLinkSelect = useCallback((filename: string) => {
    const editor = editorRef.current;
    if (editor) {
      editor.chain().focus().setLink({ href: `doc:${filename}` }).run();
    }
    fetch('/api/auto-tag-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetFile: filename }),
    }).catch(() => {});
    setVisible(false);
    setShowLinkPicker(false);
  }, [editorRef]);

  const handleNewLinkDoc = useCallback(() => {
    const title = newLinkTitle.trim();
    if (!title) return;
    const editor = editorRef.current;
    if (!editor) return;

    fetch('/api/create-link-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.filename) {
          editor.chain().focus().setLink({ href: `doc:${data.filename}` }).run();
        }
      })
      .catch(() => {});

    setVisible(false);
    setShowLinkPicker(false);
    setShowNewLinkInput(false);
    setNewLinkTitle('');
  }, [editorRef, newLinkTitle]);

  if (!visible) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {loading ? (
        <div className="context-menu-loading">Applying...</div>
      ) : showCustom ? (
        <div className="context-menu-custom">
          <input
            autoFocus
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCustomSubmit();
              if (e.key === 'Escape') setVisible(false);
            }}
            placeholder="Custom instruction..."
          />
          <button onClick={handleCustomSubmit}>Apply</button>
        </div>
      ) : showLinkPicker ? (
        <div className="context-menu-link-picker">
          <div className="context-menu-link-header">Link to document</div>
          {showNewLinkInput ? (
            <div className="context-menu-custom">
              <input
                autoFocus
                value={newLinkTitle}
                onChange={(e) => setNewLinkTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNewLinkDoc();
                  if (e.key === 'Escape') setShowNewLinkInput(false);
                }}
                placeholder="New document title..."
              />
              <button onClick={handleNewLinkDoc}>Create</button>
            </div>
          ) : (
            <button
              className="context-menu-item context-menu-new-link"
              onClick={() => setShowNewLinkInput(true)}
            >
              <span>+ New link doc</span>
            </button>
          )}
          <div className="context-menu-link-list">
            {linkedDocs.length > 0 && (
              <>
                <div className="context-menu-section-header">Linked in this doc</div>
                {docList
                  .filter((d) => linkedDocs.includes(d.filename))
                  .map(({ filename, title }) => (
                    <button
                      key={`linked-${filename}`}
                      className="context-menu-item"
                      onClick={() => handleLinkSelect(filename)}
                    >
                      <span>{title}</span>
                    </button>
                  ))}
              </>
            )}
            <div className="context-menu-section-header">All documents</div>
            {docList
              .filter((d) => !linkedDocs.includes(d.filename))
              .map(({ filename, title }) => (
                <button
                  key={filename}
                  className="context-menu-item"
                  onClick={() => handleLinkSelect(filename)}
                >
                  <span>{title}</span>
                </button>
              ))}
            {docList.length === 0 && (
              <div className="context-menu-loading">No documents</div>
            )}
          </div>
        </div>
      ) : (
        getActions().map((item) => (
          <button
            key={item.action}
            className="context-menu-item"
            onClick={() => handleAction(item)}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        ))
      )}
    </div>
  );
}
