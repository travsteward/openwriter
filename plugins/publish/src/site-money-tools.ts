import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, pick, SITE_PARAM } from './site-tools.js';

const COMP_DURATIONS = ['7d', '30d', '90d', '6mo', '1yr', 'forever'];
const OFFER_PLANS = ['monthly', 'annual'];

const AMOUNTS = 'Amounts are in cents (500 is 5.00).';

function planSchema(what: string, flexible = false) {
  return {
    type: 'object',
    description: what,
    properties: {
      amount: { type: 'number', description: 'Price in cents.' },
      benefits: { type: 'string', description: 'What readers get on this plan, shown on the subscribe page.' },
      ...(flexible ? { flexible: { type: 'boolean', description: 'Readers may pay more than the amount, which becomes the least they can pay.' } } : {}),
    },
    required: ['amount'],
  };
}

/** Paid plans: the writer's Stripe, prices, comps, offers. Revenue is in get_site_stats. */
export function siteMoneyTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'connect_stripe',
      description:
        'Start connecting the writer\'s own Stripe account so readers can pay for the site. Returns a link the writer opens to sign in to Stripe and approve OpenWriter. ' +
        'Readers then pay through Stripe Checkout straight to the writer\'s Stripe, less a 5% OpenWriter fee.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/stripe/connect', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not start connecting Stripe');
        const { url } = (await res.json()) as { url: string };
        return {
          url,
          next:
            'Open this link and approve OpenWriter in Stripe. Stripe then returns you to OpenWriter and the connection finishes; ' +
            'get_site shows stripe_connected once it has. Then set prices with set_site_plans.',
        };
      },
    },

    {
      name: 'disconnect_stripe',
      description:
        'Disconnect the writer\'s Stripe account. New paid signups stop at once; existing subscriptions stay on the writer\'s Stripe. ' +
        'Only call this when the writer has asked to disconnect, and pass confirm: true.',
      inputSchema: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', description: 'Must be true: the writer has agreed that new paid signups stop.' },
          ...SITE_PARAM,
        },
        required: ['confirm'],
      },
      handler: async (params) => {
        if (params.confirm !== true) {
          return { error: 'Disconnecting Stripe stops new paid signups. Pass confirm: true once the writer has agreed.' };
        }
        const res = await publishFetch(config, '/sites/stripe', onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not disconnect Stripe');
        const { payments } = (await res.json()) as { payments: unknown };
        return {
          success: true,
          note: 'New paid signups are stopped. Existing subscriptions keep running on the writer\'s Stripe; manage or cancel them there.',
          payments,
        };
      },
    },

    {
      name: 'get_site_plans',
      description: `Whether Stripe is connected, the 7-day free trial setting, and the paid plans (monthly, annual, founding) with prices and benefits. ${AMOUNTS}`,
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/plans', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load plans');
        return ((await res.json()) as { payments: object }).payments;
      },
    },

    {
      name: 'set_site_plans',
      description:
        'Set the paid plans. This replaces the whole set: pass monthly and annual every time, and founding to keep a founding plan (leaving it out removes it). ' +
        `Needs Stripe connected. Minimums are 5.00 a month and 30.00 a year; founding must cost more than annual. ${AMOUNTS} ` +
        'Changing a price applies to new subscribers; existing ones keep what they pay.',
      inputSchema: {
        type: 'object',
        properties: {
          monthly: planSchema('Monthly plan.'),
          annual: planSchema('Annual plan.'),
          founding: planSchema('Optional founding member plan, billed yearly.', true),
          currency: { type: 'string', enum: ['usd', 'eur', 'gbp', 'cad', 'aud'], description: 'Currency for every plan. Defaults to usd.' },
          trial_7_day: { type: 'boolean', description: 'New subscribers get 7 days free, once per reader. Defaults to off.' },
          ...SITE_PARAM,
        },
        required: ['monthly', 'annual'],
      },
      handler: async (params) => {
        const body = pick(params, ['monthly', 'annual', 'founding', 'currency', 'trial_7_day']);
        const res = await publishFetch(config, '/sites/plans', onSite(params.site, { method: 'PUT', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not save plans');
        return { success: true, ...((await res.json()) as { payments: object }).payments };
      },
    },

    {
      name: 'list_comps',
      description: 'Readers the writer has given free paid access (comps), soonest to end first. A comp with no end date lasts forever.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/comps', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load comps');
        return (await res.json()) as object;
      },
    },

    {
      name: 'grant_comp',
      description:
        'Give a reader free paid access for a while or forever. Pass email or membership_id. An email that is not a subscriber yet becomes one. ' +
        'A new comp replaces any comp the reader has; it never changes what a paying reader pays.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Reader\'s email.' },
          name: { type: 'string', description: 'Reader\'s name, with email only.' },
          membership_id: { type: 'string', description: 'An existing subscriber\'s membership id, instead of email.' },
          duration: { type: 'string', enum: COMP_DURATIONS, description: 'How long the comp lasts.' },
          founding: { type: 'boolean', description: 'Give founding member access instead of paid.' },
          ...SITE_PARAM,
        },
        required: ['duration'],
      },
      handler: async (params) => {
        const body = pick(params, ['email', 'name', 'membership_id', 'duration', 'founding']);
        const res = await publishFetch(config, '/sites/comps', onSite(params.site, { method: 'POST', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not grant the comp');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'end_comp',
      description: 'End a reader\'s comp now. They fall back to what they pay for, or to free.',
      inputSchema: {
        type: 'object',
        properties: { membership_id: { type: 'string', description: 'The comped reader\'s membership id, from list_comps.' }, ...SITE_PARAM },
        required: ['membership_id'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/comps/${encodeURIComponent(params.membership_id as string)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not end the comp');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'list_offers',
      description: 'Every offer with its shareable link, whether the link works now (state), and how many readers used it.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/offers', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load offers');
        return (await res.json()) as object;
      },
    },

    {
      name: 'create_offer',
      description:
        'Make an offer link for the monthly and/or annual plan: a free trial of some days, or a discount. ' +
        'A discount is percent_off or amount_off (cents), for one payment (once), some months (repeating, with duration_months) or forever. ' +
        'Returns the link to share. Needs Stripe connected.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['trial', 'discount'], description: 'Free trial or discount.' },
          trial_days: { type: 'number', description: 'Trial only: days free, 1 to 730.' },
          percent_off: { type: 'number', description: 'Discount only: percent off, 1 to 100. Pass this or amount_off.' },
          amount_off: { type: 'number', description: 'Discount only: amount off in cents. Pass this or percent_off.' },
          duration: { type: 'string', enum: ['once', 'repeating', 'forever'], description: 'Discount only: how long it applies.' },
          duration_months: { type: 'number', description: 'Discount with duration repeating only: months it applies, 1 to 36.' },
          plans: { type: 'array', items: { type: 'string', enum: OFFER_PLANS }, description: 'Plans it applies to. Defaults to both.' },
          code: { type: 'string', description: 'Code in the link, 3 to 40 letters, digits or dashes. Made up when not given.' },
          name: { type: 'string', description: 'Label for the offer, up to 40 characters.' },
          expires_at: { type: 'string', description: 'ISO date-time when the link stops working.' },
          max_redemptions: { type: 'number', description: 'How many readers can use it.' },
          ...SITE_PARAM,
        },
        required: ['kind'],
      },
      handler: async (params) => {
        const body = pick(params, [
          'kind', 'trial_days', 'percent_off', 'amount_off', 'duration', 'duration_months', 'plans', 'code', 'name', 'expires_at',
          'max_redemptions',
        ]);
        const res = await publishFetch(config, '/sites/offers', onSite(params.site, { method: 'POST', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not create the offer');
        const { offer } = (await res.json()) as { offer: any };
        const result: Record<string, unknown> = { success: true, link: offer.url, offer };
        if (!offer.url) result.note = 'The site has no name yet, so the link does not work. Claim one with claim_site_name.';
        return result;
      },
    },

    {
      name: 'end_offer',
      description: 'End an offer. Its link stops working; readers who already used it keep their trial or discount.',
      inputSchema: {
        type: 'object',
        properties: { offer_id: { type: 'string', description: 'Offer id, from list_offers.' }, ...SITE_PARAM },
        required: ['offer_id'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/offers/${encodeURIComponent(params.offer_id as string)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not end the offer');
        return { success: true, ...((await res.json()) as object) };
      },
    },
  ];
}
