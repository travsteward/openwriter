import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, pick, SITE_PARAM } from './site-tools.js';

const DNS_NEXT =
  'Add these records at the domain\'s DNS host. The TXT record proves the domain is yours; the CNAME points it at the site. ' +
  'Then run check_site_domain until status is active. Until then the site stays on <name>.openwriter.io.';

/** Where the site lives and how it is organized: a custom domain, sections, tags. */
export function siteStructureTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'get_site_domain',
      description:
        'The site\'s custom domain, if it has one: its status, the DNS records it needs (a CNAME to sites.openwriter.io and a _cf-custom-hostname TXT proving ownership), ' +
        'whether ownership is verified, and any errors. apex is true for a bare domain (example.com), which needs a DNS host that can flatten a CNAME at the root.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/domain', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load the domain');
        const { domain } = (await res.json()) as { domain: unknown };
        return domain ? { domain } : { domain: null, note: 'No custom domain. Add one with set_site_domain.' };
      },
    },

    {
      name: 'set_site_domain',
      description:
        'Serve the site on the writer\'s own domain, like www.example.com or example.com. Needs a claimed site name, and a site has one custom domain. ' +
        'Returns the DNS records the writer adds at their DNS host.',
      inputSchema: {
        type: 'object',
        properties: {
          hostname: { type: 'string', description: 'The domain, without https://. A subdomain such as www is the easiest to set up.' },
          ...SITE_PARAM,
        },
        required: ['hostname'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/domain', onSite(params.site, {
          method: 'PUT',
          body: JSON.stringify({ hostname: params.hostname }),
        }));
        if (!res.ok) return apiError(res, 'Could not add the domain');
        const { domain } = (await res.json()) as { domain: any };
        const result: Record<string, unknown> = { success: true, domain, next: DNS_NEXT };
        if (domain?.apex) {
          result.note = 'This is a bare domain: the DNS host must support a CNAME at the root (often called CNAME flattening or ALIAS). If it does not, use www instead.';
        }
        return result;
      },
    },

    {
      name: 'check_site_domain',
      description: 'Check the custom domain now: asks again whether the DNS records are in place and returns the updated status and any errors.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/domain/check', onSite(params.site, { method: 'POST' }));
        if (!res.ok) return apiError(res, 'Could not check the domain');
        const { domain } = (await res.json()) as { domain: any };
        return domain?.status === 'active' ? { domain, note: 'The site is live on this domain.' } : { domain, next: DNS_NEXT };
      },
    },

    {
      name: 'remove_site_domain',
      description:
        'Remove the custom domain. The site goes back to <name>.openwriter.io at once and links to the old domain stop working. Only the site owner can do this. ' +
        'Only call this when the writer has asked, and pass confirm: true.',
      inputSchema: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', description: 'Must be true: the writer has agreed that the domain stops serving the site.' },
          ...SITE_PARAM,
        },
        required: ['confirm'],
      },
      handler: async (params) => {
        if (params.confirm !== true) {
          return { error: 'Removing the domain takes the site off it at once. Pass confirm: true once the writer has agreed.' };
        }
        const res = await publishFetch(config, '/sites/domain', onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not remove the domain');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'list_site_sections',
      description:
        'The site\'s sections, in navigation order. A section is a separate stream of posts with its own page (/s/<slug>) that readers can switch on or off in their email settings. ' +
        'Posts with no section are in the main publication.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/sections', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load sections');
        return (await res.json()) as object;
      },
    },

    {
      name: 'save_site_section',
      description:
        'Make a section, or change one by passing section_id. Only the fields you pass change. Put posts in it with publish_to_site\'s section.',
      inputSchema: {
        type: 'object',
        properties: {
          section_id: { type: 'string', description: 'Section to change, from list_site_sections. Leave out to make a new one.' },
          name: { type: 'string', description: 'Section name, up to 100 characters. Needed for a new section.' },
          slug: { type: 'string', description: 'URL slug (/s/<slug>). Defaults to one made from the name.' },
          description: { type: 'string', description: 'Shown on the section page. An empty string clears it.' },
          hide_from_home: { type: 'boolean', description: 'Keep its posts off the homepage and archive; the section page still lists them.' },
          add_new_by_default: { type: 'boolean', description: 'New subscribers get this section\'s emails.' },
          show_in_nav: { type: 'boolean', description: 'Show it in the site\'s navigation.' },
          position: { type: 'number', description: 'Order in the navigation, lowest first.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = pick(params, ['name', 'slug', 'description', 'hide_from_home', 'add_new_by_default', 'show_in_nav', 'position']);
        const id = params.section_id as string | undefined;
        if (!id && !body.name) return { error: 'A new section needs a name.' };
        if (id && !Object.keys(body).length) return { error: 'Pass at least one field to change.' };
        const res = id
          ? await publishFetch(config, `/sites/sections/${encodeURIComponent(id)}`, onSite(params.site, { method: 'PATCH', body: JSON.stringify(body) }))
          : await publishFetch(config, '/sites/sections', onSite(params.site, { method: 'POST', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, id ? 'Could not change the section' : 'Could not make the section');
        return { success: true, action: id ? 'updated' : 'created', ...((await res.json()) as object) };
      },
    },

    {
      name: 'delete_site_section',
      description:
        'Delete a section. Its posts move to the main publication and readers\' choices for it are dropped. ' +
        'Only call this when the writer has asked, and pass confirm: true.',
      inputSchema: {
        type: 'object',
        properties: {
          section_id: { type: 'string', description: 'Section to delete, from list_site_sections.' },
          confirm: { type: 'boolean', description: 'Must be true: the writer has agreed to delete it.' },
          ...SITE_PARAM,
        },
        required: ['section_id', 'confirm'],
      },
      handler: async (params) => {
        if (params.confirm !== true) return { error: 'Deleting a section cannot be undone. Pass confirm: true once the writer has agreed.' };
        const res = await publishFetch(config, `/sites/sections/${encodeURIComponent(params.section_id as string)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not delete the section');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'add_subscribers_to_section',
      description:
        'Sign every current subscriber up for a section\'s emails, without emailing them about it. Readers who switched the section off stay off.',
      inputSchema: {
        type: 'object',
        properties: { section_id: { type: 'string', description: 'Section, from list_site_sections.' }, ...SITE_PARAM },
        required: ['section_id'],
      },
      handler: async (params) => {
        const res = await publishFetch(
          config,
          `/sites/sections/${encodeURIComponent(params.section_id as string)}/add-subscribers`,
          onSite(params.site, { method: 'POST' }),
        );
        if (!res.ok) return apiError(res, 'Could not add subscribers');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'list_site_tags',
      description: 'The site\'s tags. Each tag has a page (/t/<slug>) listing its posts. Tag posts with publish_to_site\'s tags.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/tags', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load tags');
        return (await res.json()) as object;
      },
    },

    {
      name: 'save_site_tag',
      description:
        'Make a tag, or change one by passing tag_id: rename it, change its slug, or show it in the navigation. Tagging a post with a new name also makes the tag.',
      inputSchema: {
        type: 'object',
        properties: {
          tag_id: { type: 'string', description: 'Tag to change, from list_site_tags. Leave out to make a new one.' },
          name: { type: 'string', description: 'Tag name, up to 60 characters. Needed for a new tag.' },
          slug: { type: 'string', description: 'URL slug (/t/<slug>). Defaults to one made from the name.' },
          show_in_nav: { type: 'boolean', description: 'Show it in the site\'s navigation.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = pick(params, ['name', 'slug', 'show_in_nav']);
        const id = params.tag_id as string | undefined;
        if (!id && !body.name) return { error: 'A new tag needs a name.' };
        if (id && !Object.keys(body).length) return { error: 'Pass at least one field to change.' };
        const res = id
          ? await publishFetch(config, `/sites/tags/${encodeURIComponent(id)}`, onSite(params.site, { method: 'PATCH', body: JSON.stringify(body) }))
          : await publishFetch(config, '/sites/tags', onSite(params.site, { method: 'POST', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, id ? 'Could not change the tag' : 'Could not make the tag');
        return { success: true, action: id ? 'updated' : 'created', ...((await res.json()) as object) };
      },
    },

    {
      name: 'delete_site_tag',
      description: 'Delete a tag and take it off every post. Only call this when the writer has asked, and pass confirm: true.',
      inputSchema: {
        type: 'object',
        properties: {
          tag_id: { type: 'string', description: 'Tag to delete, from list_site_tags.' },
          confirm: { type: 'boolean', description: 'Must be true: the writer has agreed to delete it.' },
          ...SITE_PARAM,
        },
        required: ['tag_id', 'confirm'],
      },
      handler: async (params) => {
        if (params.confirm !== true) return { error: 'Deleting a tag takes it off every post. Pass confirm: true once the writer has agreed.' };
        const res = await publishFetch(config, `/sites/tags/${encodeURIComponent(params.tag_id as string)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not delete the tag');
        return { success: true, ...((await res.json()) as object) };
      },
    },
  ];
}
