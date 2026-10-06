import type { OpenWriterPlugin, PluginMcpTool, PluginRouteContext } from './helpers.js';
import { getServerModules, publishFetch } from './helpers.js';
import { newsletterTools } from './newsletter-tools.js';
import { siteTools } from './site-tools.js';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { Request, Response } from 'express';

/** Extract docId from raw markdown frontmatter (JSON or YAML) */
function extractDocId(rawContent: string): string | null {
  // JSON frontmatter: "docId":"abc123"
  const jsonMatch = rawContent.match(/"docId"\s*:\s*"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  // YAML frontmatter: docId: abc123
  const yamlMatch = rawContent.match(/^docId:\s*["']?(\S+?)["']?\s*$/m);
  if (yamlMatch) return yamlMatch[1];
  return null;
}

/** Server-side backstop for the transform size guard. Mirrors the client-side
 *  cap in packages/openwriter/src/sidebar/transform-guard.ts (same 5000-word unit)
 *  so an oversized doc can't reach the model/publish worker even when a caller
 *  bypasses the UI guard (agent, script, stale client). */
const MAX_TRANSFORM_WORDS = 5000;

/** Word count of a doc's body. Strips a leading YAML frontmatter block so the
 *  count matches the body-only wordCount the sidebar measures client-side. */
function countBodyWords(rawContent: string): number {
  const body = rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return (body.match(/\S+/g) || []).length;
}

/** Map transform action to variant content type */
const ACTION_VARIANT_TYPE: Record<string, string> = {
  vary: 'document',
  shrinkify: 'document',
  expandify: 'document',
  threadify: 'tweet',
  storify: 'document',
  emailify: 'newsletter',
  postify: 'tweet',
};

/** Simple HTML → markdown conversion for document creation */
function htmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
  md = md.replace(/<p[^>]*>/gi, '');
  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<[^>]+>/g, '');
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

const plugin: OpenWriterPlugin = {
  name: '@openwriter/plugin-publish',
  version: '0.1.0',
  description: 'OpenWriter Publish — newsletter, custom domains, publishing',
  category: 'publishing',

  configSchema: {
    'api-url': {
      type: 'string',
      description: 'Publish API URL',
      env: 'PUBLISH_API_URL',
    },
    'api-key': {
      type: 'string',
      required: true,
      description: 'API key (ow_live_...)',
      env: 'PUBLISH_API_KEY',
    },
  },

  mcpTools(config: Record<string, string>): PluginMcpTool[] {
    const baseUrl = config['api-url'] || 'https://publish.openwriter.io';

    return [
      {
        name: 'request_login_code',
        description:
          'Request a 6-digit verification code sent to the given email. First step of authentication — works for both new signups and key recovery.',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email address to send the verification code to' },
          },
          required: ['email'],
        },
        handler: async (params) => {
          const email = params.email as string;
          const res = await fetch(`${baseUrl}/auth/request-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { error: `Failed to request code: ${(err as any).error || res.statusText}` };
          }

          const data = await res.json() as { sent: boolean; email: string; expires_in_seconds: number };
          return {
            success: true,
            email: data.email,
            expires_in_seconds: data.expires_in_seconds,
            message: `Verification code sent to ${data.email}. Ask the user for the 6-digit code from their inbox, then call verify_login.`,
          };
        },
      },

      {
        name: 'verify_login',
        description:
          'Verify a 6-digit code and obtain an API key. Second step of authentication. On success, the API key is automatically saved to plugin config.',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email address the code was sent to' },
            code: { type: 'string', description: '6-digit verification code from email' },
          },
          required: ['email', 'code'],
        },
        handler: async (params) => {
          const email = params.email as string;
          const code = params.code as string;

          const res = await fetch(`${baseUrl}/auth/verify-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { error: `Verification failed: ${(err as any).error || res.statusText}` };
          }

          const data = await res.json() as { apiKey: string; userId: string };

          try {
            const configRes = await fetch('http://127.0.0.1:5050/api/plugins/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: '@openwriter/plugin-publish',
                config: { 'api-key': data.apiKey },
              }),
            });

            if (configRes.ok) {
              return {
                success: true,
                userId: data.userId,
                message: 'Authenticated and API key saved to plugin config. You can now use all Publish tools.',
              };
            }
          } catch {
            // Config save failed — fall back to returning key
          }

          return {
            success: true,
            userId: data.userId,
            apiKey: data.apiKey,
            message: 'Authenticated but could not auto-save API key. Please save this key to the plugin config manually.',
          };
        },
      },

      // Newsletter tools (send, subscribers, issues, analytics)
      ...newsletterTools(config),

      // Site tools (<name>.openwriter.io: claim, settings, publish posts, stats)
      ...siteTools(config),

      // --- Domain tools ---

      {
        name: 'setup_custom_domain',
        description:
          'Set up a custom sending domain for newsletters. Automatically handles SendGrid domain auth, DNS records (auto-added for Cloudflare domains), and sender verification. Follow the next_action field in the response.',
        inputSchema: {
          type: 'object',
          properties: {
            domain: { type: 'string', description: 'Domain to set up (e.g. "yourdomain.com")' },
            from_email: {
              type: 'string',
              description: 'From email address (e.g. "newsletter@yourdomain.com")',
            },
            from_name: {
              type: 'string',
              description: 'From display name (e.g. "Your Newsletter")',
            },
            physical_address: {
              type: 'string',
              description: 'Physical mailing address for CAN-SPAM compliance (required before sending). E.g. "123 Main St, Portland, OR 97201"',
            },
          },
          required: ['domain', 'from_email'],
        },
        handler: async (params) => {
          const res = await publishFetch(config, '/newsletter/domains', {
            method: 'POST',
            body: JSON.stringify({
              domain: params.domain,
              from_email: params.from_email,
              from_name: params.from_name || undefined,
              physical_address: params.physical_address || undefined,
            }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { error: `Failed to setup domain: ${(err as any).error || res.statusText}` };
          }

          const data = await res.json() as {
            domain: any;
            dnsRecords: any[];
            cloudflare_managed: boolean;
            dns_auto_added: boolean;
            sender_verification_sent: boolean;
            next_action: string;
          };
          return {
            success: true,
            domainId: data.domain.id,
            domain: data.domain.domain,
            dnsRecords: data.dnsRecords,
            cloudflare_managed: data.cloudflare_managed,
            dns_auto_added: data.dns_auto_added,
            sender_verification_sent: data.sender_verification_sent,
            next_action: data.next_action,
          };
        },
      },

      {
        name: 'check_domain_status',
        description:
          'Check if a custom domain is fully ready (DNS verified + sender verified). If domain_id omitted, lists all domains with their status.',
        inputSchema: {
          type: 'object',
          properties: {
            domain_id: {
              type: 'string',
              description: 'Domain ID to check (from setup_custom_domain). Omit to list all domains.',
            },
          },
        },
        handler: async (params) => {
          if (!params.domain_id) {
            const res = await publishFetch(config, '/newsletter/domains');
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              return { error: `Failed to list domains: ${(err as any).error || res.statusText}` };
            }
            const data = await res.json() as { domains: any[] };
            return {
              domains: data.domains.map((d: any) => ({
                id: d.id,
                domain: d.domain,
                fromEmail: d.from_email,
                status: d.status,
                senderStatus: d.sender_status,
                cloudflareManaged: d.cloudflare_managed,
                hasPhysicalAddress: !!d.physical_address,
              })),
            };
          }

          const res = await publishFetch(config, `/newsletter/domains/${params.domain_id}/verify`, {
            method: 'POST',
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { error: `Status check failed: ${(err as any).error || res.statusText}` };
          }

          const data = await res.json() as {
            domain: string;
            dns_verified: boolean;
            sender_verified: boolean;
            fully_ready: boolean;
            next_action: string;
          };
          return {
            domain: data.domain,
            dns_verified: data.dns_verified,
            sender_verified: data.sender_verified,
            fully_ready: data.fully_ready,
            next_action: data.next_action,
          };
        },
      },

      {
        name: 'resend_domain_verification',
        description:
          'Resend the SendGrid sender verification email for a custom domain. Use when the user did not receive or cannot find the original verification email.',
        inputSchema: {
          type: 'object',
          properties: {
            domain_id: {
              type: 'string',
              description: 'Domain ID to resend verification for.',
            },
          },
          required: ['domain_id'],
        },
        handler: async (params) => {
          const res = await publishFetch(config, `/newsletter/domains/${params.domain_id}/resend-verification`, {
            method: 'POST',
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { error: `Resend failed: ${(err as any).error || res.statusText}` };
          }

          const data = await res.json() as { success: boolean; message: string };
          return {
            success: true,
            message: data.message,
          };
        },
      },

      // --- Connection tools ---

      {
        name: 'list_connections',
        description: 'List all connected accounts (X, LinkedIn, newsletter domains) for the active profile.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const server = await getServerModules();
          const res = await server.platformFetch('/connections/unified');
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { error: `Failed to list connections: ${(err as any).error || res.statusText}` };
          }
          const data = await res.json() as { connections: any[] };
          return {
            connections: data.connections.map((c: any) => ({
              id: c.id,
              provider: c.provider,
              display_name: c.display_name,
              status: c.status,
            })),
          };
        },
      },

      {
        name: 'post_to_x',
        description: 'Post content to X (Twitter) via a connected account. Requires an active X connection.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Tweet text (max 280 characters)' },
            connection_id: { type: 'string', description: 'X connection ID. If omitted, uses the first active X connection.' },
            autoplug: { type: 'boolean', description: 'Eligible for engagement autoplugs (default true). Pass false to opt this post out of autoplug tracking.' },
          },
          required: ['content'],
        },
        handler: async (params) => {
          const connectionId = params.connection_id as string | undefined;
          let id = connectionId;

          if (!id) {
            const server = await getServerModules();
            const listRes = await server.platformFetch('/connections');
            if (listRes.ok) {
              const data = await listRes.json() as { connections: any[] };
              const xConn = data.connections.find((c: any) => c.provider === 'x' && c.status === 'active');
              if (xConn) id = xConn.id;
            }
          }

          if (!id) return { error: 'No active X connection found. Connect an X account first.' };

          const server = await getServerModules();
          const res = await server.platformFetch(`/connections/${id}/post`, {
            method: 'POST',
            body: JSON.stringify({ content: params.content, no_autoplug: params.autoplug === false }),
          });

          const data = await res.json();
          if (!res.ok) return { error: `Post failed: ${(data as any).error || res.statusText}` };
          return data;
        },
      },

      {
        name: 'post_to_linkedin',
        description: 'Post content to LinkedIn via a connected account. Requires an active LinkedIn connection.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Post text' },
            connection_id: { type: 'string', description: 'LinkedIn connection ID. If omitted, uses the first active LinkedIn connection.' },
          },
          required: ['content'],
        },
        handler: async (params) => {
          const connectionId = params.connection_id as string | undefined;
          let id = connectionId;

          if (!id) {
            const server = await getServerModules();
            const listRes = await server.platformFetch('/connections');
            if (listRes.ok) {
              const data = await listRes.json() as { connections: any[] };
              const liConn = data.connections.find((c: any) => c.provider === 'linkedin' && c.status === 'active');
              if (liConn) id = liConn.id;
            }
          }

          if (!id) return { error: 'No active LinkedIn connection found. Connect a LinkedIn account first.' };

          const server = await getServerModules();
          const res = await server.platformFetch(`/connections/${id}/post`, {
            method: 'POST',
            body: JSON.stringify({ content: params.content }),
          });

          const data = await res.json();
          if (!res.ok) return { error: `Post failed: ${(data as any).error || res.statusText}` };
          return data;
        },
      },

      // --- Scheduler tools ---

      {
        name: 'schedule_post',
        description: 'Schedule the current document for posting. Reads content and content_type from the active document automatically. Default mode: queue (next available slot).',
        inputSchema: {
          type: 'object',
          properties: {
            connection_id: { type: 'string', description: 'Target connection ID (use list_connections to find). If omitted, infers from content_type.' },
            mode: { type: 'string', enum: ['queue', 'now', 'custom'], description: 'Scheduling mode (default: queue)' },
            scheduled_at: { type: 'string', description: 'ISO datetime for custom mode' },
            slot_id: { type: 'string', description: 'Specific slot ID to target (overrides automatic slot selection)' },
          },
        },
        handler: async (params) => {
          const server = await getServerModules();
          const doc = server.getDocument();
          const metadata = server.getMetadata();
          const docId = server.getDocId();

          if (!doc || !doc.content) return { error: 'No active document. Switch to a document first.' };

          // --- Helpers ---
          const extractText = (nodes: any[]): string => {
            const walk = (node: any): string => {
              if (node.type === 'text') return node.text || '';
              if (node.type === 'hardBreak') return '\n';
              if (!node.content) return '';
              const inner = node.content.map(walk).join('');
              if (node.type === 'paragraph') return inner + '\n\n';
              return inner;
            };
            return nodes.map(walk).join('').trim();
          };

          const extractImages = (nodes: any[]): string[] => {
            const srcs: string[] = [];
            const walk = (node: any) => {
              if (node.type === 'image' && node.attrs?.src) srcs.push(node.attrs.src);
              if (node.content) node.content.forEach(walk);
            };
            nodes.forEach(walk);
            return srcs.slice(0, 4); // X limit: 4 images per tweet
          };

          const mimeMap: Record<string, string> = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png', '.webp': 'image/webp',
            '.gif': 'image/gif', '.bmp': 'image/bmp',
          };

          const uploadImages = async (srcs: string[], connId: string): Promise<string[]> => {
            const ids: string[] = [];
            const dataDir = server.getDataDir();
            for (const src of srcs) {
              if (!src.startsWith('/_images/')) continue;
              const filename = src.replace('/_images/', '');
              const filePath = join(dataDir, '_images', filename);
              if (!existsSync(filePath)) continue;
              const ext = extname(filename).toLowerCase();
              const mediaType = mimeMap[ext] || 'image/jpeg';
              const mediaBase64 = readFileSync(filePath).toString('base64');
              const res = await server.platformFetch(`/connections/${connId}/upload-media`, {
                method: 'POST',
                body: JSON.stringify({ media_base64: mediaBase64, media_type: mediaType }),
              });
              if (res.ok) {
                const data = await res.json() as any;
                if (data.mediaId) ids.push(data.mediaId);
              }
            }
            return ids;
          };

          // --- Split doc at horizontalRule nodes (thread detection) ---
          const docNodes = doc.content || [];
          const tweetGroups: any[][] = [[]];
          for (const node of docNodes) {
            if (node.type === 'horizontalRule') {
              tweetGroups.push([]);
            } else {
              tweetGroups[tweetGroups.length - 1].push(node);
            }
          }
          // Filter empty groups
          const tweets = tweetGroups.filter(g => g.length > 0);
          const isThread = tweets.length > 1;

          // Derive content_type from metadata
          const contentType = metadata?.content_type || 'tweet';

          // Auto-find connection
          let connectionId = params.connection_id as string | undefined;
          if (!connectionId) {
            const provider = contentType === 'linkedin' ? 'linkedin' : 'x';
            const listRes = await server.platformFetch('/connections');
            if (listRes.ok) {
              const data = await listRes.json() as { connections: any[] };
              const conn = data.connections.find((c: any) => c.provider === provider && c.status === 'active');
              if (conn) connectionId = conn.id;
            }
            if (!connectionId) return { error: `No active ${provider} connection found.` };
          }

          // --- Build content: single tweet or thread ---
          let queueContent: Record<string, any>;
          let totalMedia = 0;

          if (isThread) {
            const tweetData: { text: string; mediaIds?: string[] }[] = [];
            for (const group of tweets) {
              const text = extractText(group);
              if (!text) continue;
              const images = extractImages(group);
              const mediaIds = images.length > 0 ? await uploadImages(images, connectionId) : [];
              totalMedia += mediaIds.length;
              tweetData.push(mediaIds.length > 0 ? { text, mediaIds } : { text });
            }
            if (tweetData.length === 0) return { error: 'Document is empty.' };
            queueContent = { tweets: tweetData };
          } else {
            const text = extractText(docNodes);
            if (!text) return { error: 'Document is empty.' };
            const images = extractImages(docNodes);
            const mediaIds = images.length > 0 ? await uploadImages(images, connectionId) : [];
            totalMedia = mediaIds.length;
            queueContent = mediaIds.length > 0 ? { text, mediaIds } : { text };
          }

          // Honor the doc's autoplug opt-out — rides inside the content JSONB so
          // the platform cron skips enrollment for this scheduled post.
          if (metadata?.autoplug === false) queueContent.no_autoplug = true;

          // --- Queue it ---
          const body: Record<string, any> = {
            content: queueContent,
            content_type: isThread ? 'thread' : contentType,
            connection_id: connectionId,
            mode: params.mode || 'queue',
            doc_id: docId,
          };
          if (params.scheduled_at) body.scheduled_at = params.scheduled_at;
          if (params.slot_id) body.slot_id = params.slot_id;

          const res = await publishFetch(config, '/scheduler/queue', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          const data = await res.json() as any;
          if (!res.ok) return { error: `Schedule failed: ${data.error || res.statusText}` };
          return {
            success: true,
            docId,
            scheduled_at: data.item?.scheduled_at,
            connection: connectionId,
            mode: params.mode || 'queue',
            type: isThread ? 'thread' : 'tweet',
            tweetCount: isThread ? tweets.length : 1,
            mediaCount: totalMedia,
          };
        },
      },

      {
        name: 'list_schedule',
        description: 'Show upcoming queued items with slot times.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const res = await publishFetch(config, '/scheduler/queue');
          const data = await res.json();
          if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
          return data;
        },
      },

      {
        name: 'manage_schedule',
        description: 'Cancel or reschedule a queued item.',
        inputSchema: {
          type: 'object',
          properties: {
            item_id: { type: 'string', description: 'Queue item ID' },
            action: { type: 'string', enum: ['cancel', 'reschedule'], description: 'Action to take' },
            scheduled_at: { type: 'string', description: 'New ISO datetime (for reschedule)' },
          },
          required: ['item_id', 'action'],
        },
        handler: async (params) => {
          const itemId = params.item_id as string;
          const action = params.action as string;

          if (action === 'cancel') {
            const res = await publishFetch(config, `/scheduler/queue/${itemId}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) return { error: `Cancel failed: ${(data as any).error || res.statusText}` };
            return { success: true, message: 'Item cancelled' };
          }

          if (action === 'reschedule') {
            if (!params.scheduled_at) return { error: 'scheduled_at required for reschedule' };
            const res = await publishFetch(config, `/scheduler/queue/${itemId}`, {
              method: 'PATCH',
              body: JSON.stringify({ scheduled_at: params.scheduled_at }),
            });
            const data = await res.json();
            if (!res.ok) return { error: `Reschedule failed: ${(data as any).error || res.statusText}` };
            return { success: true, item: (data as any).item };
          }

          return { error: `Unknown action: ${action}` };
        },
      },

      {
        name: 'list_slots',
        description: 'Show all slot templates with filters.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const res = await publishFetch(config, '/scheduler/slots');
          const data = await res.json();
          if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
          return data;
        },
      },

      {
        name: 'create_slot',
        description: 'Create a scheduling slot template.',
        inputSchema: {
          type: 'object',
          properties: {
            time: { type: 'string', description: 'Time in HH:MM format' },
            days: { type: 'array', items: { type: 'string' }, description: 'Days array (mon, tue, etc.) or ["default"] for every day' },
            filter_type: { type: 'string', enum: ['any', 'content_type', 'connection', 'category'], description: 'Slot filter type (default: any)' },
            filter_value: { type: 'string', description: 'Filter value (content type name or connection ID)' },
            timezone: { type: 'string', description: 'IANA timezone (default: America/New_York)' },
          },
          required: ['time', 'days'],
        },
        handler: async (params) => {
          const body = { ...params };
          if (typeof body.days === 'string') {
            try { body.days = JSON.parse(body.days as string); } catch { /* leave as-is */ }
          }
          const res = await publishFetch(config, '/scheduler/slots', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
          return { success: true, slot: (data as any).slot };
        },
      },

      {
        name: 'edit_slot',
        description: 'Edit a slot template.',
        inputSchema: {
          type: 'object',
          properties: {
            slot_id: { type: 'string', description: 'Slot ID to edit' },
            time: { type: 'string', description: 'New time in HH:MM format' },
            days: { type: 'array', items: { type: 'string' }, description: 'New days array' },
            filter_type: { type: 'string', enum: ['any', 'content_type', 'connection', 'category'] },
            filter_value: { type: 'string' },
            timezone: { type: 'string' },
          },
          required: ['slot_id'],
        },
        handler: async (params) => {
          const { slot_id, ...changes } = params as any;
          const res = await publishFetch(config, `/scheduler/slots/${slot_id}`, {
            method: 'PATCH',
            body: JSON.stringify(changes),
          });
          const data = await res.json();
          if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
          return { success: true, ...data };
        },
      },

      // --- Autoplug tools ---

      {
        name: 'manage_autoplugs',
        description: 'Manage autoplug goals, rules, and pool messages. Autoplugs automatically reply to your tweets when they hit engagement thresholds, promoting your content.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list_goals', 'create_goal', 'update_goal', 'delete_goal', 'list_pool', 'add_pool_message', 'delete_pool_message', 'create_rule', 'update_rule', 'delete_rule', 'sync_av_key'],
              description: 'Action to perform',
            },
            goal_id: { type: 'string', description: 'Goal ID (for pool/rule operations, update_goal, delete_goal)' },
            rule_id: { type: 'string', description: 'Rule ID (for update_rule, delete_rule)' },
            message_id: { type: 'string', description: 'Pool message ID (for delete_pool_message)' },
            name: { type: 'string', description: 'Goal name (for create_goal, update_goal)' },
            link: { type: 'string', description: 'Promo link (for create_goal, update_goal)' },
            description: { type: 'string', description: 'Goal description for LLM context (for create_goal, update_goal)' },
            enabled: { type: 'boolean', description: 'Enable/disable (for update_goal, update_rule)' },
            content: { type: 'string', description: 'Pool message text (for add_pool_message). Use {{link}} as placeholder.' },
            metric: { type: 'string', enum: ['likes', 'retweets', 'views'], description: 'Trigger metric (for create_rule, update_rule)' },
            threshold: { type: 'number', description: 'Trigger threshold (for create_rule, update_rule)' },
            delay_minutes: { type: 'number', description: 'Delay after threshold met (for create_rule, update_rule)' },
            mode: { type: 'string', enum: ['static', 'llm', 'hybrid'], description: 'Reply mode (for create_rule, update_rule)' },
            av_api_key: { type: 'string', description: 'Author\'s Voice API key (for sync_av_key)' },
          },
          required: ['action'],
        },
        handler: async (params) => {
          const action = params.action as string;

          if (action === 'list_goals') {
            const res = await publishFetch(config, '/scheduler/autoplugs/goals');
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return data;
          }

          if (action === 'create_goal') {
            if (!params.name) return { error: 'name is required' };
            const res = await publishFetch(config, '/scheduler/autoplugs/goals', {
              method: 'POST',
              body: JSON.stringify({ name: params.name, link: params.link, description: params.description }),
            });
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return { success: true, goal: (data as any).goal };
          }

          if (action === 'update_goal') {
            if (!params.goal_id) return { error: 'goal_id is required' };
            const changes: any = {};
            if (params.name !== undefined) changes.name = params.name;
            if (params.link !== undefined) changes.link = params.link;
            if (params.description !== undefined) changes.description = params.description;
            if (params.enabled !== undefined) changes.enabled = params.enabled;
            const res = await publishFetch(config, `/scheduler/autoplugs/goals/${params.goal_id}`, {
              method: 'PATCH',
              body: JSON.stringify(changes),
            });
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return { success: true, goal: (data as any).goal };
          }

          if (action === 'delete_goal') {
            if (!params.goal_id) return { error: 'goal_id is required' };
            const res = await publishFetch(config, `/scheduler/autoplugs/goals/${params.goal_id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return { success: true, message: 'Goal deleted' };
          }

          if (action === 'list_pool') {
            if (!params.goal_id) return { error: 'goal_id is required' };
            const res = await publishFetch(config, `/scheduler/autoplugs/goals/${params.goal_id}/pool`);
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return data;
          }

          if (action === 'add_pool_message') {
            if (!params.goal_id) return { error: 'goal_id is required' };
            if (!params.content) return { error: 'content is required' };
            const res = await publishFetch(config, `/scheduler/autoplugs/goals/${params.goal_id}/pool`, {
              method: 'POST',
              body: JSON.stringify({ content: params.content }),
            });
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return { success: true, message: (data as any).message };
          }

          if (action === 'delete_pool_message') {
            if (!params.message_id) return { error: 'message_id is required' };
            const res = await publishFetch(config, `/scheduler/autoplugs/pool/${params.message_id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return { success: true, message: 'Pool message deleted' };
          }

          if (action === 'create_rule') {
            if (!params.goal_id) return { error: 'goal_id is required' };
            if (!params.metric) return { error: 'metric is required' };
            if (!params.threshold) return { error: 'threshold is required' };
            const res = await publishFetch(config, '/scheduler/autoplugs/rules', {
              method: 'POST',
              body: JSON.stringify({
                goal_id: params.goal_id,
                metric: params.metric,
                threshold: params.threshold,
                delay_minutes: params.delay_minutes ?? 30,
                mode: params.mode || 'static',
              }),
            });
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return { success: true, rule: (data as any).rule };
          }

          if (action === 'update_rule') {
            if (!params.rule_id) return { error: 'rule_id is required' };
            const changes: any = {};
            if (params.metric !== undefined) changes.metric = params.metric;
            if (params.threshold !== undefined) changes.threshold = params.threshold;
            if (params.delay_minutes !== undefined) changes.delay_minutes = params.delay_minutes;
            if (params.mode !== undefined) changes.mode = params.mode;
            if (params.enabled !== undefined) changes.enabled = params.enabled;
            const res = await publishFetch(config, `/scheduler/autoplugs/rules/${params.rule_id}`, {
              method: 'PATCH',
              body: JSON.stringify(changes),
            });
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return { success: true, rule: (data as any).rule };
          }

          if (action === 'delete_rule') {
            if (!params.rule_id) return { error: 'rule_id is required' };
            const res = await publishFetch(config, `/scheduler/autoplugs/rules/${params.rule_id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return { success: true, message: 'Rule deleted' };
          }

          if (action === 'sync_av_key') {
            if (!params.av_api_key) return { error: 'av_api_key is required' };
            const res = await publishFetch(config, '/scheduler/autoplugs/av-key', {
              method: 'POST',
              body: JSON.stringify({ av_api_key: params.av_api_key }),
            });
            const data = await res.json();
            if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
            return { success: true, message: 'AV API key synced to platform for LLM autoplugs' };
          }

          return { error: `Unknown action: ${action}` };
        },
      },

      {
        name: 'list_autoplug_tracking',
        description: 'List tracked tweets with engagement metrics and autoplug status. Shows which tweets are being monitored, their current metrics, and whether autoplugs have fired.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const res = await publishFetch(config, '/scheduler/autoplugs/tracking');
          const data = await res.json();
          if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
          return data;
        },
      },

      {
        name: 'delete_slot',
        description: 'Delete a slot template.',
        inputSchema: {
          type: 'object',
          properties: {
            slot_id: { type: 'string', description: 'Slot ID to delete' },
          },
          required: ['slot_id'],
        },
        handler: async (params) => {
          const res = await publishFetch(config, `/scheduler/slots/${params.slot_id}`, { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok) return { error: `Failed: ${(data as any).error || res.statusText}` };
          return { success: true, ...data };
        },
      },

      {
        name: 'naturalize_slots',
        description: 'Scramble slot times so posts don\'t look scheduled. Splits multi-day slots into per-day slots with jittered times (+/- 15 min). Each day gets a slightly different minute offset. Run after creating slots at clean macro times.',
        inputSchema: {
          type: 'object',
          properties: {
            jitter_minutes: { type: 'number', description: 'Max jitter in minutes (default: 15). Each slot shifts by a random amount within this range.' },
          },
        },
        handler: async (params) => {
          const jitter = (params as any).jitter_minutes || 15;
          const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

          // Fetch current slots
          const listRes = await publishFetch(config, '/scheduler/slots');
          const listData = await listRes.json() as any;
          if (!listRes.ok) return { error: `Failed to list slots: ${listData.error || listRes.statusText}` };
          const slots = listData.slots || [];
          if (!slots.length) return { error: 'No slots to naturalize' };

          // Parse HH:MM:SS or HH:MM to total minutes
          const parseTime = (t: string): number => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
          };
          // Format total minutes back to HH:MM
          const formatTime = (mins: number): string => {
            const clamped = ((mins % 1440) + 1440) % 1440;
            const h = Math.floor(clamped / 60);
            const m = clamped % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          };
          // Deterministic-ish jitter per day index and slot index
          const jitterFor = (dayIdx: number, slotIdx: number): number => {
            const seed = (dayIdx * 7 + slotIdx * 13 + 3) % (jitter * 2 + 1);
            return seed - jitter;
          };

          let created = 0;
          let deleted = 0;
          const results: string[] = [];

          for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            const days: string[] = slot.days || ['default'];
            const expandedDays = days.includes('default') ? ALL_DAYS : days;

            // Skip already single-day slots (already naturalized)
            if (expandedDays.length === 1 && !days.includes('default')) {
              // Still jitter the time if it's on a round number
              const mins = parseTime(slot.time);
              if (mins % 5 === 0) {
                const dayIdx = ALL_DAYS.indexOf(expandedDays[0]);
                const newMins = mins + jitterFor(dayIdx, si);
                const editRes = await publishFetch(config, `/scheduler/slots/${slot.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ time: formatTime(newMins) }),
                });
                if (editRes.ok) {
                  results.push(`${expandedDays[0]}: ${slot.time} → ${formatTime(newMins)}`);
                }
              }
              continue;
            }

            // Multi-day slot: delete and create per-day replacements
            const baseMinutes = parseTime(slot.time);
            const delRes = await publishFetch(config, `/scheduler/slots/${slot.id}`, { method: 'DELETE' });
            if (delRes.ok) deleted++;

            for (let di = 0; di < expandedDays.length; di++) {
              const day = expandedDays[di];
              const dayIdx = ALL_DAYS.indexOf(day);
              const offset = jitterFor(dayIdx, si);
              const newTime = formatTime(baseMinutes + offset);

              const createRes = await publishFetch(config, '/scheduler/slots', {
                method: 'POST',
                body: JSON.stringify({
                  time: newTime,
                  days: [day],
                  filter_type: slot.filter_type || 'any',
                  filter_value: slot.filter_value || null,
                  timezone: slot.timezone || 'America/Los_Angeles',
                }),
              });
              if (createRes.ok) {
                created++;
                results.push(`${day}: ${slot.time} → ${newTime}`);
              }
            }
          }

          return {
            success: true,
            deleted,
            created,
            summary: `Naturalized ${deleted} multi-day slots into ${created} per-day slots`,
            details: results,
          };
        },
      },

      // --- Billing tools ---

      {
        name: 'get_billing',
        description: 'Get current subscription plan, capabilities, and billing status. Shows the plan tier (Publish or Publish+Email), which publishing channels are enabled, and whether payment is active.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const res = await publishFetch(config, '/billing');
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { error: `Failed to fetch billing: ${(err as any).error || res.statusText}` };
          }
          return await res.json();
        },
      },

      {
        name: 'upgrade_plan',
        description: 'Get a Stripe Checkout URL to subscribe or upgrade. Opens in browser for payment. Plans (wire value = label): "creator" = Publish ($19/mo, $190/yr) — the scheduler + publishing to X and LinkedIn, plus autoplugs on X (blog publishing via the GitHub plugin is free on every plan); "growth" = Publish+Email ($49/mo, $490/yr) — everything in Publish plus newsletter/email. Period: monthly or annual (2 months free).',
        inputSchema: {
          type: 'object',
          properties: {
            plan: { type: 'string', enum: ['creator', 'growth'], description: 'Plan to subscribe to: "creator" = Publish ($19/mo), "growth" = Publish+Email ($49/mo)' },
            period: { type: 'string', enum: ['monthly', 'annual'], description: 'Billing period (default: monthly). Annual saves 2 months.' },
          },
          required: ['plan'],
        },
        handler: async (params) => {
          const res = await publishFetch(config, '/billing/checkout', {
            method: 'POST',
            body: JSON.stringify({
              plan: params.plan,
              period: params.period || 'monthly',
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { error: `Checkout failed: ${(err as any).error || res.statusText}` };
          }
          const data = await res.json() as { url: string };
          const planLabel = params.plan === 'growth' ? 'Publish+Email' : 'Publish';
          return {
            url: data.url,
            message: `Open this URL to complete your ${planLabel} subscription: ${data.url}`,
          };
        },
      },

      {
        name: 'manage_billing',
        description: 'Get a Stripe Customer Portal URL to manage subscription — update payment method, view invoices, change plan, or cancel.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const res = await publishFetch(config, '/billing/portal', {
            method: 'POST',
            body: JSON.stringify({}),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return { error: `Portal failed: ${(err as any).error || res.statusText}` };
          }
          const data = await res.json() as { url: string };
          return {
            url: data.url,
            message: `Open this URL to manage your billing: ${data.url}`,
          };
        },
      },
    ];
  },

  registerRoutes(ctx: PluginRouteContext) {
    // Sidebar action handler for document transforms
    ctx.app.post('/api/publish/sidebar-action', async (req: Request, res: Response) => {
      try {
        const { action, filename, title, instructions, content } = req.body;
        console.log(`[Publish Plugin] Sidebar action: ${action} on "${title}"`);

        if (!content) {
          res.status(400).json({ error: 'Document content is required' });
          return;
        }

        // Size backstop — mirror the client-side transform guard. Block before the
        // worker model call so an oversized doc can't run up unbounded cost + time,
        // even when a caller bypasses the UI guard.
        const transformWords = countBodyWords(content);
        if (transformWords > MAX_TRANSFORM_WORDS) {
          console.warn(`[Publish Plugin] Transform blocked — doc too large: ${transformWords} words (max ${MAX_TRANSFORM_WORDS})`);
          res.status(413).json({ error: `Document too large to transform: ${transformWords.toLocaleString()} words (max ${MAX_TRANSFORM_WORDS.toLocaleString()}).` });
          return;
        }

        // Call publish worker /transforms endpoint
        const transformRes = await publishFetch(ctx.config, '/transforms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, content, title, instructions }),
        });

        if (!transformRes.ok) {
          const errData = await transformRes.json().catch(() => ({}));
          console.error('[Publish Plugin] Transform failed:', transformRes.status, errData);
          res.status(transformRes.status).json(errData);
          return;
        }

        const transformResult = await transformRes.json() as {
          success: boolean;
          html: string;
          newTitle: string;
          thread?: { tweets: { text: string }[] };
          rawResponse?: string;
          metadata: Record<string, any>;
        };

        // Convert HTML output to markdown for document creation
        let markdownContent = htmlToMarkdown(transformResult.html);

        // Extract source doc's docId for variant relationship
        const masterDocId = extractDocId(content);
        const variantType = ACTION_VARIANT_TYPE[action] || 'document';

        // Build document creation payload
        const createBody: Record<string, any> = {
          title: transformResult.newTitle,
          content: markdownContent,
          markPending: true,
          agentCreated: true,
          ...(masterDocId ? { masterDocId, variantType } : {}),
        };

        if (action === 'threadify') {
          // Build TipTap JSON directly — markdown parser converts "- item" lines
          // to bulletList nodes the tweet editor can't render. Using paragraph +
          // hardBreak nodes keeps all tweet text as plain text.
          if (transformResult.thread?.tweets?.length) {
            const docContent: any[] = [];
            transformResult.thread.tweets.forEach((t: { text: string }, i: number) => {
              const lines = t.text.split('\n');
              const nodes: any[] = [];
              lines.forEach((line: string, j: number) => {
                if (j > 0) nodes.push({ type: 'hardBreak' });
                if (line) nodes.push({ type: 'text', text: line });
              });
              if (nodes.length) {
                docContent.push({ type: 'paragraph', content: nodes });
              }
              if (i < transformResult.thread!.tweets.length - 1) {
                docContent.push({ type: 'horizontalRule' });
              }
            });
            createBody.content = { type: 'doc', content: docContent };
          }
          createBody.metadata = { tweetContext: { mode: 'tweet' } };
        }

        // Create new document via internal HTTP call
        const host = req.get('host') || 'localhost:5050';
        const protocol = req.protocol || 'http';
        const createUrl = `${protocol}://${host}/api/documents`;
        const createRes = await fetch(createUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });

        if (!createRes.ok) {
          const errData = await createRes.json().catch(() => ({}));
          console.error('[Publish Plugin] Document creation failed:', errData);
          res.status(500).json({ error: 'Failed to create result document' });
          return;
        }

        const docResult = await createRes.json() as { filename: string };

        res.json({
          success: true,
          action,
          filename: docResult.filename,
          title: transformResult.newTitle,
          metadata: transformResult.metadata,
        });
      } catch (err: any) {
        console.error('[Publish Plugin] Sidebar action error:', err?.message || err);
        res.status(500).json({ error: 'Sidebar action failed' });
      }
    });
  },

  sidebarMenuItems() {
    return [
      { label: 'Vary', action: 'publish:vary', promptForFocus: true },
      { label: 'Shrinkify', action: 'publish:shrinkify', promptForFocus: true },
      { label: 'Expandify', action: 'publish:expandify', promptForFocus: true },
      { label: 'Threadify', action: 'publish:threadify', promptForFocus: true },
      { label: 'Storify', action: 'publish:storify', promptForFocus: true },
      { label: 'Emailify', action: 'publish:emailify', promptForFocus: true },
      { label: 'Postify', action: 'publish:postify', promptForFocus: true },
    ];
  },
};

export default plugin;
