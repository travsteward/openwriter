/**
 * MCP stdio server: tool registry + stdio transport.
 * Uses compact wire format for token efficiency.
 * Exports TOOL_REGISTRY for HTTP proxy (multi-session support).
 */

import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DATA_DIR, ensureDataDir } from './helpers.js';
import {
  getDocument,
  getWordCount,
  getPendingChangeCount,
  getTitle,
  getStatus,
  getNodesByIds,
  getMetadata,
  setMetadata,
  applyChanges,
  applyTextEdits,
  updateDocument,
  save,
  markAllNodesAsPending,
  setAgentLock,
  updatePendingCacheForActiveDoc,
  type NodeChange,
} from './state.js';
import { listDocuments, switchDocument, createDocument, deleteDocument, openFile, getActiveFilename } from './documents.js';
import { broadcastDocumentSwitched, broadcastDocumentsChanged, broadcastWorkspacesChanged, broadcastTitleChanged, broadcastMetadataChanged, broadcastPendingDocsChanged, broadcastWritingStarted, broadcastWritingFinished } from './ws.js';
import { listWorkspaces, getWorkspace, getDocTitle, getItemContext, addDoc, updateWorkspaceContext, createWorkspace, deleteWorkspace, addContainerToWorkspace, findOrCreateWorkspace, findOrCreateContainer, moveDoc } from './workspaces.js';
import { addDocTag, removeDocTag, getDocTagsByFilename } from './state.js';
import type { WorkspaceNode } from './workspace-types.js';
import { importGoogleDoc } from './gdoc-import.js';
import { toCompactFormat, compactNodes, parseMarkdownContent } from './compact.js';
import { getUpdateInfo } from './update-check.js';


export type ToolResult = { content: { type: 'text'; text: string }[] };

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (args: any) => Promise<ToolResult>;
}

export const TOOL_REGISTRY: ToolDef[] = [
  {
    name: 'read_pad',
    description: 'Read the current document. Returns compact tagged-line format with [type:id] per node, inline markdown formatting. Much more token-efficient than JSON.',
    schema: {},
    handler: async () => {
      const doc = getDocument();
      const compact = toCompactFormat(doc, getTitle(), getWordCount(), getPendingChangeCount());
      return { content: [{ type: 'text', text: compact }] };
    },
  },
  {
    name: 'write_to_pad',
    description: 'Preferred tool for all document edits. Send 3-8 changes per call for responsive feel. Multiple rapid calls better than one monolithic call. Content can be a markdown string (preferred) or TipTap JSON. Markdown strings are auto-converted. Changes appear as pending decorations the user accepts or rejects. Use afterNodeId: "end" to append to the document without knowing node IDs. Response includes lastNodeId for chaining subsequent inserts.',
    schema: {
      changes: z.array(z.object({
        operation: z.enum(['rewrite', 'insert', 'delete']),
        nodeId: z.string().optional(),
        afterNodeId: z.string().optional(),
        content: z.any().optional(),
      })).describe('Array of node changes. Content accepts markdown strings or TipTap JSON.'),
    },
    handler: async ({ changes }: { changes: any[] }) => {
      const processed = changes.map((change) => {
        const resolved = { ...change };
        if (typeof resolved.content === 'string') {
          resolved.content = parseMarkdownContent(resolved.content);
        }
        return resolved;
      });
      const { count: appliedCount, lastNodeId } = applyChanges(processed as NodeChange[]);
      // broadcastPendingDocsChanged() already fires via onChanges listener in ws.ts
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: appliedCount > 0,
            appliedCount,
            ...(lastNodeId ? { lastNodeId } : {}),
            ...(appliedCount < processed.length ? { skipped: processed.length - appliedCount } : {}),
          }),
        }],
      };
    },
  },
  {
    name: 'get_pad_status',
    description: 'Get the current status of the pad: word count, pending changes. Cheap call for polling.',
    schema: {},
    handler: async () => {
      const status = getStatus();
      const latestVersion = getUpdateInfo();
      const payload = latestVersion ? { ...status, updateAvailable: latestVersion } : status;
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  },
  {
    name: 'get_nodes',
    description: 'Get specific nodes by ID. Returns compact tagged-line format per node.',
    schema: {
      nodeIds: z.array(z.string()).describe('Array of node IDs to retrieve'),
    },
    handler: async ({ nodeIds }: { nodeIds: string[] }) => {
      return { content: [{ type: 'text', text: compactNodes(getNodesByIds(nodeIds)) }] };
    },
  },
  {
    name: 'list_documents',
    description: 'List all documents in the workspace. Shows filename, word count, last modified date, and which document is active.',
    schema: {},
    handler: async () => {
      const docs = listDocuments();
      const lines = docs.map((d) => {
        const active = d.isActive ? ' (active)' : '';
        const date = d.lastModified.split('T')[0];
        return `  ${d.filename}${active} — ${d.wordCount.toLocaleString()} words — ${date}`;
      });
      return { content: [{ type: 'text', text: `documents:\n${lines.join('\n') || '  (none)'}` }] };
    },
  },
  {
    name: 'switch_document',
    description: 'Switch to a different document by filename. Saves the current document first. Returns a compact read of the newly active document.',
    schema: {
      filename: z.string().describe('Filename of the document to switch to (e.g. "My Essay.md")'),
    },
    handler: async ({ filename }: { filename: string }) => {
      broadcastWritingFinished(); // Clear any in-progress creation spinner
      const result = switchDocument(filename);
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      const compact = toCompactFormat(result.document, result.title, getWordCount(), getPendingChangeCount());
      return { content: [{ type: 'text', text: `Switched to "${result.title}"\n\n${compact}` }] };
    },
  },
  {
    name: 'create_document',
    description: 'Create a new empty document and switch to it. Always provide a title. Saves the current document first. By default shows a sidebar spinner that persists until populate_document is called — set empty=true to skip the spinner and switch immediately (use for template docs like tweets/articles that don\'t need agent content). If workspace is provided, the doc is automatically added to it (workspace is created if it doesn\'t exist). If container is also provided, the doc is placed inside that container (created if it doesn\'t exist).',
    schema: {
      title: z.string().optional().describe('Title for the new document. Defaults to "Untitled".'),
      path: z.string().optional().describe('Absolute file path to create the document at (e.g. "C:/projects/doc.md"). If omitted, creates in ~/.openwriter/.'),
      workspace: z.string().optional().describe('Workspace title to add this doc to. Creates the workspace if it doesn\'t exist.'),
      container: z.string().optional().describe('Container name within the workspace (e.g. "Chapters", "Notes", "References"). Creates the container if it doesn\'t exist. Requires workspace.'),
      empty: z.boolean().optional().describe('If true, skip the writing spinner and switch to the doc immediately. No need to call populate_document. Use for template docs (tweets, articles) that start empty.'),
    },
    handler: async ({ title, path, workspace, container, empty }: { title?: string; path?: string; workspace?: string; container?: string; empty?: boolean }) => {
      // Resolve workspace/container up front so spinner renders in the right place
      let wsTarget: { wsFilename: string; containerId: string | null } | undefined;
      if (workspace) {
        const ws = findOrCreateWorkspace(workspace);
        let containerId: string | null = null;
        if (container) {
          const c = findOrCreateContainer(ws.filename, container);
          containerId = c.containerId;
        }
        wsTarget = { wsFilename: ws.filename, containerId };
        broadcastWorkspacesChanged(); // Browser sees container structure before spinner
      }

      if (!empty) {
        broadcastWritingStarted(title || 'Untitled', wsTarget);
        // Yield so the browser receives and renders the spinner before heavy work
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      try {
        // Lock browser doc-updates: prevents race where browser sends a doc-update
        // for the previous document but server has already switched active doc.
        setAgentLock();
        const result = createDocument(title, undefined, path);

        // Auto-add to workspace if specified
        let wsInfo = '';
        if (wsTarget) {
          addDoc(wsTarget.wsFilename, wsTarget.containerId, result.filename, result.title);
          wsInfo = ` → workspace "${workspace}"${container ? ` / ${container}` : ''}`;
        }

        if (empty) {
          // Immediate switch — no spinner, no populate_document needed
          save();
          broadcastDocumentsChanged();
          broadcastWorkspacesChanged();
          broadcastDocumentSwitched(getDocument(), getTitle(), getActiveFilename());
          return {
            content: [{
              type: 'text',
              text: `Created "${result.title}" (${result.filename})${wsInfo} — ready.`,
            }],
          };
        }

        // Two-step flow: spinner persists until populate_document is called
        setMetadata({ agentCreated: true });
        save(); // Persist agentCreated flag to frontmatter
        broadcastDocumentsChanged();
        broadcastDocumentSwitched(getDocument(), getTitle(), getActiveFilename());
        return {
          content: [{
            type: 'text',
            text: `Created "${result.title}" (${result.filename})${wsInfo} — empty. Call populate_document to add content.`,
          }],
        };
      } catch (err) {
        if (!empty) broadcastWritingFinished();
        throw err;
      }
    },
  },
  {
    name: 'populate_document',
    description: 'Populate the active document with content. Use after create_document (without content) to complete the two-step creation flow. Content appears as pending decorations for user review. Clears the sidebar creation spinner and shows the document.',
    schema: {
      content: z.any().describe('Document content: markdown string (preferred) or TipTap JSON doc object.'),
    },
    handler: async ({ content }: { content: any }) => {
      try {
        let doc: any;

        if (typeof content === 'string') {
          doc = { type: 'doc', content: parseMarkdownContent(content) };
        } else if (content?.type === 'doc' && Array.isArray(content.content)) {
          doc = content;
        } else {
          broadcastWritingFinished();
          return {
            content: [{ type: 'text', text: 'Error: content must be a markdown string or TipTap JSON { type: "doc", content: [...] }' }],
          };
        }

        setAgentLock(); // Block browser doc-updates during population
        markAllNodesAsPending(doc, 'insert');
        updateDocument(doc);
        updatePendingCacheForActiveDoc();
        save();

        // Broadcast sidebar updates first (deferred from create_document) so the doc
        // entry and spinner removal arrive in the same render cycle
        broadcastDocumentsChanged();
        broadcastWorkspacesChanged();
        broadcastDocumentSwitched(doc, getTitle(), getActiveFilename());
        broadcastPendingDocsChanged();
        broadcastWritingFinished();

        const wordCount = getWordCount();
        return {
          content: [{
            type: 'text',
            text: `Populated "${getTitle()}" — ${wordCount.toLocaleString()} words`,
          }],
        };
      } catch (err) {
        broadcastWritingFinished();
        throw err;
      }
    },
  },
  {
    name: 'open_file',
    description: 'Open an existing .md file from any location on disk. Saves the current document first, then loads the file and sets it as active. The file appears in the sidebar and edits save back to the original path.',
    schema: {
      path: z.string().describe('Absolute path to the .md file to open (e.g. "C:/projects/blog/post.md")'),
    },
    handler: async ({ path }: { path: string }) => {
      const result = openFile(path);
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      const compact = toCompactFormat(result.document, result.title, getWordCount(), getPendingChangeCount());
      return { content: [{ type: 'text', text: `Opened "${result.title}" from ${path}\n\n${compact}` }] };
    },
  },
  {
    name: 'delete_document',
    description: 'Delete a document file. Moves to OS trash (Recycle Bin / macOS Trash). If deleting the active document, automatically switches to the most recent remaining doc. Cannot delete the last document. IMPORTANT: Always confirm with the user before calling this tool.',
    schema: {
      filename: z.string().describe('Filename of the document to delete (e.g. "My Essay.md")'),
    },
    handler: async ({ filename }: { filename: string }) => {
      const result = await deleteDocument(filename);
      if (result.switched && result.newDoc) {
        broadcastDocumentSwitched(result.newDoc.document, result.newDoc.title, result.newDoc.filename);
      }
      broadcastDocumentsChanged();
      let text = `Deleted "${filename}" (moved to trash)`;
      if (result.switched && result.newDoc) {
        text += `. Switched to "${result.newDoc.filename}"`;
      }
      return { content: [{ type: 'text', text }] };
    },
  },
  {
    name: 'get_metadata',
    description: 'Get the JSON frontmatter metadata for the active document. Returns all key-value pairs stored in frontmatter (title, summary, characters, tags, etc.). Useful for understanding document context without reading full content.',
    schema: {},
    handler: async () => {
      const metadata = getMetadata();
      return { content: [{ type: 'text', text: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '{}' }] };
    },
  },
  {
    name: 'set_metadata',
    description: 'Update frontmatter metadata on the active document. Merges with existing metadata — only provided keys are changed. Use for summaries, character lists, tags, arc notes, or any organizational data. Saves to disk immediately.',
    schema: {
      metadata: z.record(z.any()).describe('Key-value pairs to merge into frontmatter. Set a key to null to remove it.'),
    },
    handler: async ({ metadata: updates }: { metadata: Record<string, any> }) => {
      const setKeys: string[] = [];
      const removed: string[] = [];

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined) {
          removed.push(key);
        } else {
          setKeys.push(key);
        }
      }

      const cleaned: Record<string, any> = {};
      for (const key of setKeys) cleaned[key] = updates[key];
      if (Object.keys(cleaned).length > 0) setMetadata(cleaned);

      const meta = getMetadata();
      for (const key of removed) delete meta[key];
      save();

      broadcastMetadataChanged(getMetadata());

      if (cleaned.title) {
        broadcastTitleChanged(cleaned.title);
        broadcastDocumentsChanged();
      }

      const keys = Object.keys(cleaned);
      const parts: string[] = [];
      if (keys.length > 0) parts.push(`set: ${keys.join(', ')}`);
      if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`);
      return { content: [{ type: 'text', text: `Metadata updated (${parts.join('; ')})` }] };
    },
  },
  {
    name: 'list_workspaces',
    description: 'List all workspaces. Returns filename, title, and doc count.',
    schema: {},
    handler: async () => {
      const workspaces = listWorkspaces();
      const lines = workspaces.map((w) => `  ${w.filename} — "${w.title}" — ${w.docCount} docs`);
      return { content: [{ type: 'text', text: `workspaces:\n${lines.join('\n') || '  (none)'}` }] };
    },
  },
  {
    name: 'create_workspace',
    description: 'Create a new workspace. Workspaces are flexible containers for documents — add containers and tags after creation.',
    schema: {
      title: z.string().describe('Workspace title'),
      voiceProfileId: z.string().optional().describe('Author\'s Voice profile ID (future use)'),
    },
    handler: async ({ title, voiceProfileId }: { title: string; voiceProfileId?: string }) => {
      const info = createWorkspace({ title, voiceProfileId });
      broadcastWorkspacesChanged();
      return { content: [{ type: 'text', text: `Created workspace "${info.title}" (${info.filename})` }] };
    },
  },
  {
    name: 'delete_workspace',
    description: 'Delete a workspace and all its document files. Files go to OS trash (Recycle Bin / macOS Trash). IMPORTANT: Always confirm with the user before calling this tool.',
    schema: {
      filename: z.string().describe('Workspace manifest filename (e.g. "my-novel-a1b2c3d4.json")'),
    },
    handler: async ({ filename }: { filename: string }) => {
      const result = await deleteWorkspace(filename);
      broadcastWorkspacesChanged();
      broadcastDocumentsChanged();
      let text = `Deleted workspace "${filename}" and ${result.deletedFiles.length} files: ${result.deletedFiles.join(', ')}`;
      if (result.skippedExternal.length > 0) {
        text += `\nSkipped ${result.skippedExternal.length} external files (not owned by OpenWriter): ${result.skippedExternal.join(', ')}`;
      }
      return { content: [{ type: 'text', text }] };
    },
  },
  {
    name: 'get_workspace_structure',
    description: 'Get the full structure of a workspace: tree of containers and docs, per-doc tags, plus context (characters, settings, rules). Use to understand workspace organization before writing.',
    schema: {
      filename: z.string().describe('Workspace manifest filename (e.g. "my-novel-a1b2c3d4.json")'),
    },
    handler: async ({ filename }: { filename: string }) => {
      const ws = getWorkspace(filename);

      function renderTree(nodes: WorkspaceNode[], indent: string): string[] {
        const lines: string[] = [];
        for (const node of nodes) {
          if (node.type === 'doc') {
            const tags = getDocTagsByFilename(node.file);
            const tagStr = tags.length > 0 ? `  [${tags.join(', ')}]` : '';
            lines.push(`${indent}${getDocTitle(node.file)}  (${node.file})${tagStr}`);
          } else {
            lines.push(`${indent}[container] ${node.name}  (id:${node.id})`);
            lines.push(...renderTree(node.items, indent + '  '));
          }
        }
        return lines;
      }

      const treeLines = renderTree(ws.root, '  ');
      let text = `workspace: "${ws.title}"\nstructure:\n${treeLines.join('\n') || '  (empty)'}`;

      if (ws.context && Object.keys(ws.context).length > 0) {
        text += `\ncontext:\n${JSON.stringify(ws.context, null, 2)}`;
      }
      return { content: [{ type: 'text', text }] };
    },
  },
  {
    name: 'get_item_context',
    description: 'Get progressive disclosure context for a document in a workspace: workspace-level context (characters, settings, rules) and tags. Use before writing to understand context.',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      docFile: z.string().describe('Document filename within the workspace'),
    },
    handler: async ({ workspaceFile, docFile }: { workspaceFile: string; docFile: string }) => {
      return { content: [{ type: 'text', text: JSON.stringify(getItemContext(workspaceFile, docFile), null, 2) }] };
    },
  },
  {
    name: 'add_doc',
    description: 'Add a document to a workspace. Optionally place it inside a container.',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      docFile: z.string().describe('Document filename to add (e.g. "Chapter 1.md")'),
      containerId: z.string().optional().describe('Container ID to add into (null = root level)'),
      title: z.string().optional().describe('Display title for the doc'),
    },
    handler: async ({ workspaceFile, docFile, containerId, title }: any) => {
      addDoc(workspaceFile, containerId ?? null, docFile, title || docFile.replace(/\.md$/, ''));
      broadcastWorkspacesChanged();
      return {
        content: [{ type: 'text', text: `Added "${docFile}" to workspace${containerId ? ` in container ${containerId}` : ''}` }],
      };
    },
  },
  {
    name: 'update_workspace_context',
    description: 'Update a workspace\'s context section (characters, settings, rules). Merges with existing context — only provided keys are changed.',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      context: z.object({
        characters: z.record(z.string()).optional().describe('Character name → description'),
        settings: z.record(z.string()).optional().describe('Setting name → description'),
        rules: z.array(z.string()).optional().describe('Writing rules for this workspace'),
      }).describe('Context fields to merge'),
    },
    handler: async ({ workspaceFile, context }: any) => {
      updateWorkspaceContext(workspaceFile, context);
      const keys = Object.keys(context).filter((k: string) => context[k] !== undefined);
      return { content: [{ type: 'text', text: `Workspace context updated (${keys.join(', ')})` }] };
    },
  },
  {
    name: 'create_container',
    description: 'Create a container (folder) inside a workspace. Max nesting depth: 3.',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      name: z.string().describe('Container name (e.g. "Chapters", "Research")'),
      parentContainerId: z.string().optional().describe('Parent container ID for nesting (null = root level)'),
    },
    handler: async ({ workspaceFile, name, parentContainerId }: any) => {
      const result = addContainerToWorkspace(workspaceFile, parentContainerId ?? null, name);
      broadcastWorkspacesChanged();
      return { content: [{ type: 'text', text: `Created container "${name}" (id:${result.containerId})` }] };
    },
  },
  {
    name: 'tag_doc',
    description: 'Add a tag to a document. Tags are stored in the document\'s frontmatter — they travel with the file. A doc can have multiple tags.',
    schema: {
      docFile: z.string().describe('Document filename (e.g. "Chapter 1.md")'),
      tag: z.string().describe('Tag name to add'),
    },
    handler: async ({ docFile, tag }: any) => {
      addDocTag(docFile, tag);
      broadcastDocumentsChanged();
      return { content: [{ type: 'text', text: `Tagged "${docFile}" with [${tag}]` }] };
    },
  },
  {
    name: 'untag_doc',
    description: 'Remove a tag from a document.',
    schema: {
      docFile: z.string().describe('Document filename'),
      tag: z.string().describe('Tag name to remove'),
    },
    handler: async ({ docFile, tag }: any) => {
      removeDocTag(docFile, tag);
      broadcastDocumentsChanged();
      return { content: [{ type: 'text', text: `Removed tag [${tag}] from "${docFile}"` }] };
    },
  },
  {
    name: 'move_doc',
    description: 'Move a document to a different container within the same workspace, or to root level.',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      docFile: z.string().describe('Document filename to move'),
      targetContainerId: z.string().optional().describe('Target container ID (omit for root level)'),
      afterFile: z.string().optional().describe('Place after this file (omit for beginning)'),
    },
    handler: async ({ workspaceFile, docFile, targetContainerId, afterFile }: any) => {
      moveDoc(workspaceFile, docFile, targetContainerId ?? null, afterFile ?? null);
      broadcastWorkspacesChanged();
      return { content: [{ type: 'text', text: `Moved "${docFile}"${targetContainerId ? ` to container ${targetContainerId}` : ' to root'}` }] };
    },
  },
  {
    name: 'edit_text',
    description: 'Apply fine-grained text edits within a node. Find text by exact match and replace it, or add/remove marks on matched text. More precise than rewriting the whole node.',
    schema: {
      nodeId: z.string().describe('ID of the node to edit'),
      edits: z.array(z.object({
        find: z.string().describe('Exact text to find within the node'),
        replace: z.string().optional().describe('Replacement text (omit to keep text, just change marks)'),
        addMark: z.object({
          type: z.string(),
          attrs: z.record(z.any()).optional(),
        }).optional().describe('Mark to add to the matched text (e.g. link, bold)'),
        removeMark: z.string().optional().describe('Mark type to remove from matched text'),
      })).describe('Array of text edits to apply'),
    },
    handler: async ({ nodeId, edits }: { nodeId: string; edits: any[] }) => {
      return { content: [{ type: 'text', text: JSON.stringify(applyTextEdits(nodeId, edits)) }] };
    },
  },
  {
    name: 'import_gdoc',
    description: 'Import a structured Google Doc into OpenWriter. Pass the raw JSON from the Google Docs API (the object with body.content). Converts headings, bold/italic, links, lists, and tables to markdown. Docs with 2+ HEADING_1 sections auto-split into chapter files with a workspace and "Chapters" container. Single-section docs become one file.',
    schema: {
      document: z.any().describe('Raw Google Doc JSON object from the Docs API (must have body.content)'),
      title: z.string().optional().describe('Book/document title. Defaults to the Google Doc title.'),
    },
    handler: async ({ document, title }: { document: any; title?: string }) => {
      const result = importGoogleDoc(document, title);
      broadcastDocumentsChanged();
      broadcastWorkspacesChanged();
      const lines = result.files.map((f: any, i: number) =>
        `  ${i + 1}. ${f.filename} (${f.wordCount.toLocaleString()} words)`
      );
      let text = `Imported "${result.title}" — ${result.files.length} file(s), mode: ${result.mode}`;
      if (result.workspaceFilename) text += `\nWorkspace manifest: ${result.workspaceFilename}`;
      text += `\n\n${lines.join('\n')}`;
      return { content: [{ type: 'text', text }] };
    },
  },
  {
    name: 'generate_image',
    description: 'Generate an image using Gemini Imagen 4. Saves to ~/.openwriter/_images/. Optionally sets it as the active article\'s cover image atomically. Requires GEMINI_API_KEY env var.',
    schema: {
      prompt: z.string().max(1000).describe('Image generation prompt (max 1000 chars)'),
      aspect_ratio: z.string().optional().describe('Aspect ratio (default "16:9"). Supported: 1:1, 9:16, 16:9, 4:3, 3:4.'),
      set_cover: z.boolean().optional().describe('If true, atomically set the generated image as the article cover (articleContext.coverImage in metadata).'),
    },
    handler: async ({ prompt, aspect_ratio, set_cover }: { prompt: string; aspect_ratio?: string; set_cover?: boolean }) => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return { content: [{ type: 'text', text: 'Error: GEMINI_API_KEY environment variable is not set.' }] };
      }

      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: (aspect_ratio || '16:9') as any,
        },
      });

      const image = response.generatedImages?.[0];
      if (!image?.image?.imageBytes) {
        return { content: [{ type: 'text', text: 'Error: Gemini returned no image data.' }] };
      }

      // Save to ~/.openwriter/_images/
      ensureDataDir();
      const imagesDir = join(DATA_DIR, '_images');
      if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });

      const filename = `${randomUUID().slice(0, 8)}.png`;
      const filePath = join(imagesDir, filename);
      writeFileSync(filePath, Buffer.from(image.image.imageBytes, 'base64'));

      const src = `/_images/${filename}`;

      // Optionally set as article cover
      if (set_cover) {
        const meta = getMetadata();
        const articleContext = (meta.articleContext as Record<string, any>) || {};
        articleContext.coverImage = src;
        setMetadata({ articleContext });
        save();
        broadcastMetadataChanged(getMetadata());
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, src, ...(set_cover ? { coverSet: true } : {}) }),
        }],
      };
    },
  },
];

/** Register MCP tools from plugins. Tools added after startMcpServer() won't be visible to existing MCP sessions. */
export function registerPluginTools(tools: import('./plugin-types.js').PluginMcpTool[]): void {
  for (const tool of tools) {
    TOOL_REGISTRY.push({
      name: tool.name,
      description: tool.description,
      schema: {},
      handler: async (args: any) => {
        const result = await tool.handler(args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    });
  }
}

/** Remove MCP tools by name. Existing MCP stdio sessions won't see removal until reconnect. */
export function removePluginTools(names: string[]): void {
  const nameSet = new Set(names);
  for (let i = TOOL_REGISTRY.length - 1; i >= 0; i--) {
    if (nameSet.has(TOOL_REGISTRY[i].name)) {
      TOOL_REGISTRY.splice(i, 1);
    }
  }
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'openwriter',
    version: '0.2.0',
  });

  for (const tool of TOOL_REGISTRY) {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
