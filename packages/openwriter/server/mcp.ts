/**
 * MCP stdio server: tool registry + stdio transport.
 * Uses compact wire format for token efficiency.
 * Exports TOOL_REGISTRY for HTTP proxy (multi-session support).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
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
  type NodeChange,
} from './state.js';
import { listDocuments, switchDocument, createDocument, openFile, getActiveFilename } from './documents.js';
import { broadcastDocumentSwitched, broadcastDocumentsChanged, broadcastWorkspacesChanged, broadcastTitleChanged, broadcastPendingDocsChanged } from './ws.js';
import { listWorkspaces, getWorkspace, getDocTitle, getItemContext, addDoc, updateWorkspaceContext, createWorkspace, addContainerToWorkspace, tagDoc, untagDoc, moveDoc } from './workspaces.js';
import type { WorkspaceNode } from './workspace-types.js';
import { importGoogleDoc } from './gdoc-import.js';
import { toCompactFormat, compactNodes, parseMarkdownContent } from './compact.js';
import { markdownToTiptap } from './markdown.js';

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
    description: 'Preferred tool for all document edits. Send 3-8 changes per call for responsive feel. Multiple rapid calls better than one monolithic call. Content can be a markdown string (preferred) or TipTap JSON. Markdown strings are auto-converted. Changes appear as pending decorations the user accepts or rejects.',
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
      const appliedCount = applyChanges(processed as NodeChange[]);
      broadcastPendingDocsChanged();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: appliedCount > 0,
            appliedCount,
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
      return { content: [{ type: 'text', text: JSON.stringify(getStatus()) }] };
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
      const result = switchDocument(filename);
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      const compact = toCompactFormat(result.document, result.title, getWordCount(), getPendingChangeCount());
      return { content: [{ type: 'text', text: `Switched to "${result.title}"\n\n${compact}` }] };
    },
  },
  {
    name: 'create_document',
    description: 'Create a new document and switch to it. Always provide a title — documents without one show as "Untitled". Saves the current document first. Accepts optional content as markdown string or TipTap JSON — if provided, the document is created with that content. Without content, creates an empty document. Use `path` to create the file at a specific location instead of ~/.openwriter/.',
    schema: {
      title: z.string().optional().describe('Title for the new document. Defaults to "Untitled".'),
      content: z.any().optional().describe('Initial content: markdown string (preferred) or TipTap JSON doc object. If omitted, document starts empty.'),
      path: z.string().optional().describe('Absolute file path to create the document at (e.g. "C:/projects/doc.md"). If omitted, creates in ~/.openwriter/.'),
    },
    handler: async ({ title, content, path }: { title?: string; content?: any; path?: string }) => {
      const result = createDocument(title, content, path);
      if (content) {
        const doc = getDocument();
        markAllNodesAsPending(doc, 'insert');
        updateDocument(doc);
        save();
      }
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      broadcastPendingDocsChanged();
      const wordCount = getWordCount();
      return {
        content: [{
          type: 'text',
          text: `Created "${result.title}" (${result.filename})${wordCount > 0 ? ` — ${wordCount} words` : ''}`,
        }],
      };
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
    name: 'replace_document',
    description: 'Only for importing external content into a new/blank document. Never use to edit a document you already wrote — use write_to_pad instead. Accepts markdown string (preferred) or TipTap JSON. Optionally updates the title.',
    schema: {
      content: z.any().describe('New document content: markdown string (preferred) or TipTap JSON { type: "doc", content: [...] }'),
      title: z.string().optional().describe('New title for the document. If omitted, title is unchanged (or extracted from markdown frontmatter).'),
    },
    handler: async ({ content, title }: { content: any; title?: string }) => {
      let doc: any;
      let newTitle = title;

      if (typeof content === 'string') {
        const parsed = markdownToTiptap(content);
        doc = parsed.document;
        if (!newTitle && parsed.title !== 'Untitled') newTitle = parsed.title;
      } else if (content?.type === 'doc' && Array.isArray(content.content)) {
        doc = content;
      } else {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'content must be a markdown string or TipTap JSON { type: "doc", content: [...] }' }) }],
        };
      }

      const status = getWordCount() === 0 ? 'insert' : 'rewrite';
      markAllNodesAsPending(doc, status);
      updateDocument(doc);
      if (newTitle) setMetadata({ title: newTitle });
      save();

      broadcastDocumentSwitched(doc, newTitle || getTitle(), getActiveFilename());
      broadcastPendingDocsChanged();

      return {
        content: [{
          type: 'text',
          text: `Document replaced — ${getWordCount().toLocaleString()} words${newTitle ? `, title: "${newTitle}"` : ''}`,
        }],
      };
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
    name: 'get_workspace_structure',
    description: 'Get the full structure of a workspace: tree of containers and docs, tags index, plus context (characters, settings, rules). Use to understand workspace organization before writing.',
    schema: {
      filename: z.string().describe('Workspace manifest filename (e.g. "my-novel-a1b2c3d4.json")'),
    },
    handler: async ({ filename }: { filename: string }) => {
      const ws = getWorkspace(filename);

      function renderTree(nodes: WorkspaceNode[], indent: string): string[] {
        const lines: string[] = [];
        for (const node of nodes) {
          if (node.type === 'doc') {
            lines.push(`${indent}${getDocTitle(node.file)}  (${node.file})`);
          } else {
            lines.push(`${indent}[container] ${node.name}  (id:${node.id})`);
            lines.push(...renderTree(node.items, indent + '  '));
          }
        }
        return lines;
      }

      const treeLines = renderTree(ws.root, '  ');
      let text = `workspace: "${ws.title}"\nstructure:\n${treeLines.join('\n') || '  (empty)'}`;

      const tagEntries = Object.entries(ws.tags);
      if (tagEntries.length > 0) {
        text += '\ntags:';
        for (const [tag, files] of tagEntries) {
          text += `\n  ${tag}: ${files.join(', ')}`;
        }
      }

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
    description: 'Add a tag to a document in a workspace. Tags are cross-cutting — a doc can have multiple tags.',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      docFile: z.string().describe('Document filename'),
      tag: z.string().describe('Tag name to add'),
    },
    handler: async ({ workspaceFile, docFile, tag }: any) => {
      tagDoc(workspaceFile, docFile, tag);
      broadcastWorkspacesChanged();
      return { content: [{ type: 'text', text: `Tagged "${docFile}" with [${tag}]` }] };
    },
  },
  {
    name: 'untag_doc',
    description: 'Remove a tag from a document in a workspace.',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      docFile: z.string().describe('Document filename'),
      tag: z.string().describe('Tag name to remove'),
    },
    handler: async ({ workspaceFile, docFile, tag }: any) => {
      untagDoc(workspaceFile, docFile, tag);
      broadcastWorkspacesChanged();
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
    description: 'Import a Google Doc into OpenWriter. Accepts raw Google Doc JSON (from Google Docs API). If the doc has multiple HEADING_1 sections, splits into chapter files and creates a book manifest. Otherwise imports as a single document.',
    schema: {
      document: z.any().describe('Raw Google Doc JSON object (must have body.content)'),
      title: z.string().optional().describe('Book title. Defaults to the Google Doc title.'),
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
];

/** Register MCP tools from plugins. Call before startMcpServer(). */
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

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'open-writer',
    version: '0.2.0',
  });

  for (const tool of TOOL_REGISTRY) {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
