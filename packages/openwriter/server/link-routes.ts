/**
 * Express routes for document linking: create-link-doc and auto-tag-link.
 * Mounted in index.ts to keep the main file lean.
 */

import { Router } from 'express';
import { existsSync, writeFileSync } from 'fs';
import { listWorkspaces, getWorkspace, addDoc, addContainerToWorkspace, tagDoc } from './workspaces.js';
import { collectAllFiles } from './workspace-tree.js';
import { getActiveFilename } from './documents.js';
import { filePathForTitle, ensureDataDir } from './helpers.js';
import { tiptapToMarkdown } from './markdown.js';

interface BroadcastFns {
  broadcastDocumentsChanged: () => void;
  broadcastWorkspacesChanged: () => void;
}

export function createLinkRouter(b: BroadcastFns): Router {
  const router = Router();

  // Create a new doc, link-ready, auto-organized into workspace "Linked" container
  router.post('/api/create-link-doc', (req, res) => {
    try {
      const { title } = req.body;
      if (!title?.trim()) {
        res.status(400).json({ error: 'title is required' });
        return;
      }

      // 1. Create the .md file without switching active document
      ensureDataDir();
      const filePath = filePathForTitle(title.trim());
      const filename = filePath.split(/[/\\]/).pop()!;

      if (existsSync(filePath)) {
        res.status(409).json({ error: 'Document already exists', filename });
        return;
      }

      const emptyDoc = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
      const metadata = { title: title.trim() };
      const markdown = tiptapToMarkdown(emptyDoc as any, title.trim(), metadata);
      writeFileSync(filePath, markdown, 'utf-8');

      // 2. Find workspaces containing the current (source) doc
      const currentFilename = getActiveFilename();
      const allWorkspaces = listWorkspaces();

      for (const wsInfo of allWorkspaces) {
        try {
          const ws = getWorkspace(wsInfo.filename);
          const wsFiles = collectAllFiles(ws.root);
          if (!wsFiles.includes(currentFilename)) continue;

          // 3. Ensure "Linked" container exists (find or create at bottom)
          let linkedContainerId: string | null = null;
          for (const node of ws.root) {
            if (node.type === 'container' && node.name === 'Linked') {
              linkedContainerId = node.id;
              break;
            }
          }
          if (!linkedContainerId) {
            const result = addContainerToWorkspace(wsInfo.filename, null, 'Linked');
            linkedContainerId = result.containerId;
          }

          // 4. Add new doc to "Linked" container
          try {
            addDoc(wsInfo.filename, linkedContainerId, filename, title.trim());
          } catch {
            // Doc may already be in workspace (e.g., duplicate call)
          }

          // 5. Tag with "linked"
          try {
            tagDoc(wsInfo.filename, filename, 'linked');
          } catch {
            // Doc not in workspace or already tagged
          }
        } catch {
          // Skip problematic workspaces
        }
      }

      b.broadcastDocumentsChanged();
      b.broadcastWorkspacesChanged();
      res.json({ filename, title: title.trim() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-tag an existing doc with "linked" in shared workspaces
  router.post('/api/auto-tag-link', (req, res) => {
    try {
      const { targetFile } = req.body;
      if (!targetFile) {
        res.status(400).json({ error: 'targetFile is required' });
        return;
      }

      const currentFilename = getActiveFilename();
      const allWorkspaces = listWorkspaces();
      let tagged = false;

      for (const wsInfo of allWorkspaces) {
        try {
          const ws = getWorkspace(wsInfo.filename);
          const wsFiles = collectAllFiles(ws.root);
          // Both source and target must be in same workspace
          if (!wsFiles.includes(currentFilename) || !wsFiles.includes(targetFile)) continue;
          tagDoc(wsInfo.filename, targetFile, 'linked');
          tagged = true;
        } catch {
          // Skip
        }
      }

      if (tagged) b.broadcastWorkspacesChanged();
      res.json({ success: true, tagged });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
