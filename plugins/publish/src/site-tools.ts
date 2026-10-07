import type { PluginMcpTool } from './helpers.js';
import { documentToEmail, extractLocalImages, getServerModules, publishFetch } from './helpers.js';
import { placeWall } from './site-wall.js';

const AUDIENCES = ['everyone', 'subscribers', 'paid', 'founding'];
const COMMENTS = [...AUDIENCES, 'off'];

/** Doc metadata key holding the post this doc was published as. */
const POST_KEY = 'sitePost';

export async function apiError(res: Response, what: string): Promise<{ error: string }> {
  const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return { error: `${what}: ${err.message || err.error || res.statusText}` };
}

/** The optional site parameter every site tool takes. */
export const SITE_PARAM = {
  site: {
    type: 'string',
    description: 'Site to act on, by name or id, for a site you are on the team of (list_my_sites). Leave out for the active profile\'s own site.',
  },
};

/** Request options that act on the given site (the X-Site header), or on the active profile's own site when none is given. */
export function onSite(site: unknown, options: RequestInit = {}): RequestInit {
  const s = typeof site === 'string' ? site.trim() : '';
  return s ? { ...options, headers: { ...(options.headers as Record<string, string>), 'X-Site': s } } : options;
}

/** Send only the fields the caller gave; the API refuses unknown keys and keeps what is left out. */
export function pick(params: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (params[k] !== undefined) out[k] = params[k];
  return out;
}

/**
 * Pictures stored on this computer that the post uses, in the body and as the cover,
 * sent with the request. The API uploads them and points the post at the copies.
 */
export function postImages(html: string, coverUrl: unknown, dataDir?: string) {
  const cover = typeof coverUrl === 'string' && coverUrl.startsWith('/_images/') ? coverUrl : '';
  return extractLocalImages(cover ? `${html} ${cover}` : html, dataDir);
}

function postUrl(siteSlug: string | null | undefined, postSlug: string): string | null {
  return siteSlug ? `https://${siteSlug}.openwriter.io/p/${postSlug}` : null;
}

/** A section given by id, slug or name: its id, null for the main publication (empty string), or an error. */
async function resolveSection(config: Record<string, string>, site: unknown, section: string): Promise<string | null | { error: string }> {
  if (!section.trim()) return null;
  const res = await publishFetch(config, '/sites/sections', onSite(site));
  if (!res.ok) return apiError(res, 'Could not load sections');
  const { sections } = (await res.json()) as { sections: { id: string; slug: string; name: string }[] };
  const want = section.trim().toLowerCase();
  const found = sections.find((s) => s.id === section || s.slug === want || s.name.toLowerCase() === want);
  if (found) return found.id;
  const names = sections.map((s) => s.name).join(', ');
  return { error: `No section "${section}". ${names ? `Sections: ${names}.` : 'The site has no sections yet; make one with save_site_section.'}` };
}

export function siteTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'claim_site_name',
      description:
        'Claim the free site address <name>.openwriter.io for the active profile, or rename it if one is already claimed. Reserved and taken names are refused.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name before .openwriter.io: lowercase letters, numbers and hyphens.' },
          ...SITE_PARAM,
        },
        required: ['name'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/slug', onSite(params.site, {
          method: 'PUT',
          body: JSON.stringify({ slug: params.name }),
        }));
        if (!res.ok) return apiError(res, 'Could not claim that name');
        const { site } = (await res.json()) as { site: any };
        return { success: true, address: `https://${site.slug}.openwriter.io`, site };
      },
    },

    {
      name: 'get_site',
      description:
        'Show the active profile\'s site: address, name, tagline, about, logo, cover, review status, and publication settings (default audience, auto-paywall, double opt-in, welcome page and email, comments, mailing address), ' +
        'and payments: whether Stripe is connected, the 7-day trial, and the paid plans (amounts in cents). ' +
        'role is your role on the site (owner, admin or contributor); payments are shown to the owner and admins.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load the site');
        const { site, role, payments } = (await res.json()) as { site: any; role?: string; payments?: unknown };
        return { address: site.slug ? `https://${site.slug}.openwriter.io` : null, role, site, payments };
      },
    },

    {
      name: 'update_site',
      description: 'Update the site\'s details. Only the fields you pass change; an empty string clears an optional field.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Publication name shown on the site and in emails.' },
          tagline: { type: 'string', description: 'One-line description under the name.' },
          about: { type: 'string', description: 'About page content as HTML.' },
          logo_url: { type: 'string', description: 'Logo image, an http(s) URL.' },
          cover_url: { type: 'string', description: 'Cover image, an http(s) URL.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = pick(params, ['name', 'tagline', 'about', 'logo_url', 'cover_url']);
        if (!Object.keys(body).length) return { error: 'Pass at least one field to change.' };
        const res = await publishFetch(config, '/sites', onSite(params.site, { method: 'PATCH', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not update the site');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'update_site_settings',
      description:
        'Update publication settings. Only the fields you pass change. A mailing address is required before the first email goes out. ' +
        'A private site is readable by approved subscribers only: readers ask to subscribe, and the writer approves or denies each request (list_subscribe_requests).',
      inputSchema: {
        type: 'object',
        properties: {
          default_audience: { type: 'string', enum: AUDIENCES, description: 'Audience new posts get when publish_to_site is not given one.' },
          auto_wall_after_days: { type: 'number', description: 'Public posts older than this many days become paid-only. 0 turns it off.' },
          double_opt_in: { type: 'boolean', description: 'New subscribers confirm by email before they are added.' },
          welcome_page: { type: 'boolean', description: 'Show first-time visitors a welcome page with a subscribe form.' },
          welcome_email: { type: 'string', description: 'Text of the email new subscribers receive. An empty string clears it.' },
          comments_enabled: { type: 'boolean', description: 'Default for comments on new posts.' },
          mailing_address: { type: 'string', description: 'Postal address printed in every email.' },
          private: { type: 'boolean', description: 'Only approved subscribers can read the site; readers ask to subscribe and wait for approval.' },
          notify_subscribe_requests: { type: 'boolean', description: 'Email the writer when a reader asks to subscribe to a private site.' },
          author_name: { type: 'string', description: 'The owner\'s name as a post author and on the About page. An empty string clears it.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = pick(params, [
          'default_audience', 'auto_wall_after_days', 'double_opt_in', 'welcome_page', 'welcome_email', 'comments_enabled',
          'mailing_address', 'private', 'notify_subscribe_requests', 'author_name',
        ]);
        if (!Object.keys(body).length) return { error: 'Pass at least one setting to change.' };
        const res = await publishFetch(config, '/sites/settings', onSite(params.site, { method: 'PATCH', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not update settings');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'publish_to_site',
      description:
        'Publish the active document as a post on the site, or update the post it was published as before. ' +
        'A line `<!-- paywall -->` in the document places the paywall: everything above it is the free preview for readers without access. ' +
        'At most one paywall per document; with none, a walled post shows nothing past the title to readers without access. ' +
        'Pass publish_at to schedule instead of publishing now, and send_email to also email it to subscribers (a post is emailed once). ' +
        'On an update, settings you leave out keep their current values. ' +
        'A document published to a team site keeps going to that site; pass site to publish it somewhere else.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Post title. A new post defaults to the document title; an update keeps the current title.' },
          subtitle: { type: 'string', description: 'Subtitle under the title. An empty string clears it.' },
          slug: { type: 'string', description: 'URL slug (/p/<slug>). Defaults to one made from the title on first publish.' },
          cover_url: {
            type: 'string',
            description: 'Cover and social image: an http(s) URL or a picture in this OpenWriter (/_images/...). An empty string clears it.',
          },
          audience: {
            type: 'string',
            enum: AUDIENCES,
            description: 'Who can read past the paywall: everyone, subscribers (free or paid), paid, or founding. Defaults to the site setting.',
          },
          web_only: { type: 'boolean', description: 'Publish on the site only; never email it.' },
          email_only: { type: 'boolean', description: 'Email only; keep it off the site.' },
          comments_audience: { type: 'string', enum: COMMENTS, description: 'Who may comment, or off.' },
          publish_at: { type: 'string', description: 'ISO date-time in the future to schedule the post instead of publishing now.' },
          send_email: { type: 'boolean', description: 'Also email the post to subscribers when it publishes. Each audience gets its own version.' },
          send_free_preview: {
            type: 'boolean',
            description: 'With send_email on a paid or founding post: also email free subscribers the preview above the paywall.',
          },
          section: {
            type: 'string',
            description: 'Section the post belongs to, by name, slug or id (list_site_sections). An empty string puts it in the main publication.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tag names, up to 20, replacing the post\'s tags. Names that are not tags yet become new tags.',
          },
          authors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Who the post is by, up to 10: "owner" for the site owner, or ids of team members who accepted (list_site_team). New posts by a team member default to them.',
          },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const server = await getServerModules();
        const meta = server.getMetadata() || {};
        const site = (params.site as string | undefined) ?? meta[POST_KEY]?.site;
        const { html, subject } = await documentToEmail();
        if (!html.trim()) return { error: 'The document is empty.' };
        const wall = placeWall(html);
        if (!wall.ok) return { error: wall.error };
        const images = await postImages(wall.html, params.cover_url);

        let section: Record<string, unknown> = {};
        if (typeof params.section === 'string') {
          const id = await resolveSection(config, site, params.section);
          if (id && typeof id === 'object') return id;
          section = { section_id: id };
        }

        // Update the post this doc was published as, unless it has since been deleted.
        let existingId: string | null = meta[POST_KEY]?.id ?? null;
        if (existingId) {
          const check = await publishFetch(config, `/sites/posts/${existingId}`, onSite(site));
          if (check.status === 404) existingId = null;
          else if (!check.ok) return apiError(check, 'Could not load the existing post');
        }

        const fields: Record<string, unknown> = {
          // A new post takes the doc title; an update keeps the post's title unless one is passed.
          ...(params.title || !existingId ? { title: (params.title as string) || subject } : {}),
          body_html: wall.html,
          wall_at: wall.wall_at,
          ...pick(params, ['subtitle', 'slug', 'cover_url', 'audience', 'web_only', 'email_only', 'comments_audience', 'tags', 'authors']),
          ...section,
          ...(params.publish_at ? { status: 'scheduled', publish_at: params.publish_at } : { status: 'published' }),
          ...(images.length ? { images } : {}),
        };
        const res = existingId
          ? await publishFetch(config, `/sites/posts/${existingId}`, onSite(site, { method: 'PATCH', body: JSON.stringify(fields) }))
          : await publishFetch(config, '/sites/posts', onSite(site, { method: 'POST', body: JSON.stringify(fields) }));
        if (!res.ok) return apiError(res, existingId ? 'Update failed' : 'Publish failed');
        const { post } = (await res.json()) as { post: any };

        const siteRes = await publishFetch(config, '/sites', onSite(site));
        const siteSlug = siteRes.ok ? ((await siteRes.json()) as { site: any }).site.slug : null;
        const url = postUrl(siteSlug, post.slug);

        server.setMetadata({ [POST_KEY]: { id: post.id, slug: post.slug, status: post.status, url, ...(site ? { site } : {}) } });
        server.save();
        server.broadcastMetadataChanged(server.getMetadata());

        const result: Record<string, unknown> = {
          success: true,
          action: existingId ? 'updated' : 'created',
          post_id: post.id,
          status: post.status,
          publish_at: post.publish_at,
          audience: post.audience,
          wall_at: post.wall_at,
          section_id: post.section_id,
          tags: post.tags,
          authors: post.authors,
          url,
        };
        if (site) result.site = site;
        if (!siteSlug) result.note = 'The site has no name yet, so it is not served. Claim one with claim_site_name.';
        else if (wall.wall_at !== null && post.audience === 'everyone') {
          result.note = 'The paywall marker has no effect while the audience is everyone.';
        }

        if (params.send_email) {
          const send = await publishFetch(config, `/sites/posts/${post.id}/send`, onSite(site, {
            method: 'POST',
            body: JSON.stringify(pick(params, ['send_free_preview'])),
          }));
          if (!send.ok) {
            result.email = (await apiError(send, 'Post saved, but the email was not sent')).error;
          } else {
            const s = (await send.json()) as {
              scheduled?: boolean; recipients?: number; issue_id?: string; free_preview?: boolean; send_free_preview?: boolean;
            };
            const preview = s.free_preview || s.send_free_preview ? ' Free subscribers get the preview.' : '';
            result.email = (s.scheduled ? 'Will be emailed when the post publishes.' : `Sending to ${s.recipients} subscribers.`) + preview;
            if (s.issue_id) result.issue_id = s.issue_id;
          }
        }
        return result;
      },
    },

    {
      name: 'unpublish_site_post',
      description: 'Take the active document\'s site post off the site (it becomes a draft). Emails already sent are not recalled.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'Post to unpublish. Defaults to the post the active document was published as.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const server = await getServerModules();
        const meta = server.getMetadata() || {};
        const id = (params.post_id as string) || meta[POST_KEY]?.id;
        if (!id) return { error: 'This document has not been published to the site. Pass post_id to unpublish another post.' };
        // The doc's own post lives on the site it was published to.
        const site = params.site ?? (params.post_id ? undefined : meta[POST_KEY]?.site);
        const res = await publishFetch(config, `/sites/posts/${id}/unpublish`, onSite(site, { method: 'POST' }));
        if (!res.ok) return apiError(res, 'Unpublish failed');
        const { post } = (await res.json()) as { post: any };
        if (meta[POST_KEY]?.id === id) {
          server.setMetadata({ [POST_KEY]: { ...meta[POST_KEY], status: post.status } });
          server.save();
          server.broadcastMetadataChanged(server.getMetadata());
        }
        return { success: true, post_id: post.id, status: post.status };
      },
    },

    {
      name: 'get_site_stats',
      description:
        'Site numbers: subscriber counts by type and status, site totals, revenue, and stats (views, recipients, opens, clicks, subscribers gained) for the active document\'s post if it has one. ' +
        'Revenue (site.revenue) gives paid members by plan, how many are in a free trial, comps, monthly recurring revenue, ' +
        'OpenWriter\'s 5% fee and what the writer keeps, in cents of the plans\' currency.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const server = await getServerModules();
        const docPost = server.getMetadata()?.[POST_KEY];
        // The doc's post counts only when it lives on the site asked about.
        const postId = (docPost?.site ?? '') === ((params.site as string | undefined) ?? '') ? (docPost?.id as string | undefined) : undefined;
        const [stats, counts, post] = await Promise.all([
          publishFetch(config, '/sites/stats', onSite(params.site)),
          publishFetch(config, '/sites/members/counts', onSite(params.site)),
          postId ? publishFetch(config, `/sites/posts/${postId}/stats`, onSite(params.site)) : Promise.resolve(null),
        ]);
        if (!stats.ok) return apiError(stats, 'Could not load site stats');
        if (!counts.ok) return apiError(counts, 'Could not load member counts');
        const out: Record<string, unknown> = {
          site: ((await stats.json()) as { stats: unknown }).stats,
          members: ((await counts.json()) as { counts: unknown }).counts,
        };
        if (post?.ok) out.post = { post_id: postId, ...((await post.json()) as { stats: object }).stats };
        return out;
      },
    },
  ];
}
