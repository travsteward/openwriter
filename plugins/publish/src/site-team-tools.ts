import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, pick, SITE_PARAM } from './site-tools.js';

const TEAM_ROLES = ['admin', 'contributor', 'byline'];
const ROLES =
  'Roles: admin runs the site like the owner, except its name, Stripe and removing the custom domain; ' +
  'contributor writes, edits, publishes and emails posts; byline is named on posts and the About page but cannot use OpenWriter on the site.';

/** People on a site: sites you are on, the team, and subscribe requests on a private site. */
export function siteTeamTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'list_my_sites',
      description:
        'Every site you can act on: your profiles\' own sites (owner) and sites you joined as admin or contributor. ' +
        'Pass a site\'s name or id as site to any site tool to act on it.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const res = await publishFetch(config, '/sites/mine');
        if (!res.ok) return apiError(res, 'Could not load your sites');
        return (await res.json()) as object;
      },
    },

    {
      name: 'list_site_team',
      description: `The site's owner (author id "owner") and everyone invited, with role and whether they accepted. Ids are what publish_to_site's authors take. ${ROLES}`,
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/team', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load the team');
        return (await res.json()) as object;
      },
    },

    {
      name: 'invite_to_team',
      description:
        `Invite someone to the site's team by email. They get an email with an invite code and join with accept_team_invite from their own OpenWriter account. ${ROLES}`,
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Their email.' },
          role: { type: 'string', enum: TEAM_ROLES, description: 'What they can do on the site.' },
          name: { type: 'string', description: 'Their name as shown on posts, up to 100 characters.' },
          public: { type: 'boolean', description: 'List them on the About page.' },
          ...SITE_PARAM,
        },
        required: ['email', 'role'],
      },
      handler: async (params) => {
        const body = pick(params, ['email', 'role', 'name', 'public']);
        const res = await publishFetch(config, '/sites/team', onSite(params.site, { method: 'POST', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not send the invite');
        const { member, invite_token } = (await res.json()) as { member: unknown; invite_token: string };
        return {
          success: true,
          member,
          invite_code: invite_token,
          note: 'The invite was emailed. The code can also be shared directly; they join with accept_team_invite.',
        };
      },
    },

    {
      name: 'accept_team_invite',
      description: 'Join a site\'s team with the invite code from the email. The site then shows up in list_my_sites.',
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string', description: 'The invite code.' } },
        required: ['code'],
      },
      handler: async (params) => {
        // The invite names the site, so no X-Site.
        const res = await publishFetch(config, '/sites/team/accept', { method: 'POST', body: JSON.stringify({ token: params.code }) });
        if (!res.ok) return apiError(res, 'Could not accept the invite');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'update_team_member',
      description: `Change a team member's role, name or whether they are on the About page. Only the fields you pass change. ${ROLES}`,
      inputSchema: {
        type: 'object',
        properties: {
          member_id: { type: 'string', description: 'Team member id, from list_site_team.' },
          role: { type: 'string', enum: TEAM_ROLES, description: 'New role.' },
          name: { type: 'string', description: 'Their name as shown on posts, up to 100 characters.' },
          public: { type: 'boolean', description: 'List them on the About page.' },
          ...SITE_PARAM,
        },
        required: ['member_id'],
      },
      handler: async (params) => {
        const body = pick(params, ['role', 'name', 'public']);
        if (!Object.keys(body).length) return { error: 'Pass at least one field to change.' };
        const res = await publishFetch(config, `/sites/team/${encodeURIComponent(params.member_id as string)}`, onSite(params.site, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }));
        if (!res.ok) return apiError(res, 'Could not change the team member');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'remove_team_member',
      description:
        'Take someone off the team, or withdraw an invite. They lose access at once; posts left with no author become the owner\'s. ' +
        'Only call this when the writer has asked, and pass confirm: true.',
      inputSchema: {
        type: 'object',
        properties: {
          member_id: { type: 'string', description: 'Team member id, from list_site_team.' },
          confirm: { type: 'boolean', description: 'Must be true: the writer has agreed to remove them.' },
          ...SITE_PARAM,
        },
        required: ['member_id', 'confirm'],
      },
      handler: async (params) => {
        if (params.confirm !== true) return { error: 'Removing a team member takes away their access. Pass confirm: true once the writer has agreed.' };
        const res = await publishFetch(config, `/sites/team/${encodeURIComponent(params.member_id as string)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not remove the team member');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'list_subscribe_requests',
      description:
        'Readers asking to subscribe to a private site (update_site_settings private). Shows pending requests unless another status is asked for.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'approved', 'denied'], description: 'Which requests. Defaults to pending.' },
          limit: { type: 'number', description: 'How many, up to 500. Defaults to 100.' },
          offset: { type: 'number', description: 'Skip this many, for the next page.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const query = new URLSearchParams();
        for (const k of ['status', 'limit', 'offset']) if (params[k] !== undefined) query.set(k, String(params[k]));
        const qs = query.toString();
        const res = await publishFetch(config, `/sites/subscribe-requests${qs ? `?${qs}` : ''}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load subscribe requests');
        return (await res.json()) as object;
      },
    },

    {
      name: 'decide_subscribe_request',
      description: 'Approve or deny a request to subscribe to a private site. An approved reader becomes a subscriber and gets the welcome email; a denied one is sent nothing.',
      inputSchema: {
        type: 'object',
        properties: {
          request_id: { type: 'string', description: 'Request id, from list_subscribe_requests.' },
          decision: { type: 'string', enum: ['approve', 'deny'], description: 'Approve or deny.' },
          ...SITE_PARAM,
        },
        required: ['request_id', 'decision'],
      },
      handler: async (params) => {
        if (params.decision !== 'approve' && params.decision !== 'deny') return { error: 'decision must be approve or deny.' };
        const res = await publishFetch(
          config,
          `/sites/subscribe-requests/${encodeURIComponent(params.request_id as string)}/${params.decision}`,
          onSite(params.site, { method: 'POST' }),
        );
        if (!res.ok) return apiError(res, 'Could not decide the request');
        return { success: true, ...((await res.json()) as object) };
      },
    },
  ];
}
