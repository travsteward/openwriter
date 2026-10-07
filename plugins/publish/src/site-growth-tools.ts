import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, pick, SITE_PARAM } from './site-tools.js';

const REWARD_COMPS = ['7d', '30d', '90d', '6mo', '1yr'];

/** Ways readers bring in readers: gifts, group subscriptions, referrals, recommendations. */
export function siteGrowthTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'get_site_gifts',
      description:
        'Whether readers can buy the site as a gift (1 month or 1 year, at the monthly and annual prices, on the site\'s /gift page), and the gifts bought so far, newest first.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/gifts', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load gifts');
        return (await res.json()) as object;
      },
    },

    {
      name: 'set_site_gifts',
      description: 'Turn gift purchases on or off. Gifts already bought are still delivered. Needs Stripe connected.',
      inputSchema: {
        type: 'object',
        properties: { enabled: { type: 'boolean', description: 'Readers can buy gifts.' }, ...SITE_PARAM },
        required: ['enabled'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/gifts/settings', onSite(params.site, {
          method: 'PUT',
          body: JSON.stringify({ enabled: params.enabled }),
        }));
        if (!res.ok) return apiError(res, 'Could not change gift settings');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'get_site_groups',
      description:
        'Group subscriptions: a reader buys two or more seats of the annual plan for a team and fills them with emails. ' +
        'Returns the discount new groups get and each group with its seats filled and what it pays a year.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/groups', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load groups');
        return (await res.json()) as object;
      },
    },

    {
      name: 'set_site_group_discount',
      description: 'Set the discount on the annual price for new group subscriptions. Existing groups keep theirs. Needs Stripe connected.',
      inputSchema: {
        type: 'object',
        properties: {
          discount_percent: { type: 'number', description: 'Whole percent off, 0 to 90. 0 means no discount.' },
          ...SITE_PARAM,
        },
        required: ['discount_percent'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/groups/settings', onSite(params.site, {
          method: 'PUT',
          body: JSON.stringify({ discount_percent: params.discount_percent }),
        }));
        if (!res.ok) return apiError(res, 'Could not change the group discount');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'get_site_referrals',
      description:
        'The referral program: settings, whether it is live (it is off while the site is private), how many readers subscribed through referral links, the top referrers, and rewards given. ' +
        'Every subscriber gets a referral link while the program is on.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/referrals', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load referrals');
        return (await res.json()) as object;
      },
    },

    {
      name: 'update_site_referrals',
      description:
        'Change the referral program. Only the fields you pass change. Rewards have three tiers by number of referrals: ' +
        'on a site selling paid plans the reward is free paid access (comp); otherwise it is a reward_text emailed to the referrer. ' +
        'Rewards already given are kept, and readers who now reach a tier (after a lowered threshold) get it right away.',
      inputSchema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Turn the program on or off.' },
          show_leaderboard: { type: 'boolean', description: 'Show a public leaderboard of top referrers (/leaderboard).' },
          email_line: { type: 'boolean', description: 'End post emails with a line asking readers to share their referral link.' },
          tiers: {
            type: 'array',
            description: 'All three tiers, lowest first, each needing more referrals than the one before.',
            items: {
              type: 'object',
              properties: {
                threshold: { type: 'number', description: 'Referrals needed, 1 to 100000.' },
                comp: { type: 'string', enum: REWARD_COMPS, description: 'Paid sites: free paid access for this long. Leave out for none.' },
                reward_text: { type: 'string', description: 'Sites without paid plans: what the referrer gets, emailed to them. Leave out for none.' },
              },
              required: ['threshold'],
            },
          },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = pick(params, ['enabled', 'show_leaderboard', 'email_line', 'tiers']);
        if (!Object.keys(body).length) return { error: 'Pass at least one setting to change.' };
        const res = await publishFetch(config, '/sites/referrals/settings', onSite(params.site, { method: 'PUT', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not change referral settings');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'list_site_recommendations',
      description:
        'Sites this one recommends, with how many subscribers it sent each, and sites recommending this one, with how many subscribers they brought. ' +
        'Recommendations are offered to new subscribers and shown on the site\'s /recommendations page.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/recommendations', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load recommendations');
        return (await res.json()) as object;
      },
    },

    {
      name: 'recommend_site',
      description:
        'Recommend another OpenWriter site, or change a recommendation. Its writer is emailed the first time. Up to 50 recommendations.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'The other site\'s name, the part before .openwriter.io.' },
          blurb: { type: 'string', description: 'Why readers should subscribe, up to 300 characters. An empty string clears it.' },
          show_on_home: { type: 'boolean', description: 'Also show it on this site\'s homepage. Defaults to on.' },
          ...SITE_PARAM,
        },
        required: ['slug'],
      },
      handler: async (params) => {
        const body = pick(params, ['slug', 'blurb', 'show_on_home']);
        const res = await publishFetch(config, '/sites/recommendations', onSite(params.site, { method: 'POST', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not save the recommendation');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'remove_site_recommendation',
      description: 'Stop recommending a site.',
      inputSchema: {
        type: 'object',
        properties: { slug: { type: 'string', description: 'The recommended site\'s name, from list_site_recommendations.' }, ...SITE_PARAM },
        required: ['slug'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/recommendations/${encodeURIComponent(params.slug as string)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not remove the recommendation');
        return { success: true, ...((await res.json()) as object) };
      },
    },
  ];
}
