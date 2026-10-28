/**
 * Home: the site at a glance. Its address and sending status (with Request review while new
 * sites are limited), subscribers, paid subscribers, monthly revenue and views, the last posts
 * with how they did, and the two ways forward: write a post, or publish the open document.
 */
import { owApi, useApp } from '../bridge';
import { count, day, host, money, percent, run, useTool } from '../api';
import ClaimName from '../ClaimName';
import { close, go } from '../nav';
import { useSite } from '../SiteApp';
import { ActionBtn, Btn, Empty, Failed, Loading, Notice, Page, Row, Rows, Section, Stat, Stats } from '../ui';

function Sending() {
  const { info, refresh } = useSite();
  const s = info.sending;
  const manager = info.role !== 'contributor';
  if (s.status === 'suspended') return <Notice kind="error">Sending is paused for this site. Reply to any OpenWriter email to ask why.</Notice>;
  if (s.status !== 'review') return null;
  return (
    <Notice kind="warn">
      <span>Sending limit: {count(s.daily_cap, 'email')} a day while we review your new site.</span>{' '}
      {s.review_requested_at
        ? <span>You asked for review on {day(s.review_requested_at)}; we email you when it is done.</span>
        : manager && (
          <ActionBtn kind="quiet" label="Request review" doing="Asking..."
            run={() => run('request_site_review')} done={(r) => { refresh(); return r?.message || 'Review requested.'; }} />
        )}
    </Notice>
  );
}

export default function Home() {
  const { info } = useSite();
  const app = useApp();
  const manager = info.role !== 'contributor';
  const stats = useTool<any>('get_site_stats');
  const posts = useTool<{ posts: any[] }>('list_site_posts', { status: 'published', limit: 5 });

  if (!info.address) {
    return (
      <Page title="Your site">
        <ClaimName />
      </Page>
    );
  }

  const tiers = stats.data?.members?.active_by_tier || {};
  const total = Object.values(tiers).reduce((a: number, b: any) => a + (b || 0), 0) as number;
  const paid = (tiers.paid || 0) + (tiers.founding || 0);
  const revenue = stats.data?.site?.revenue;
  const onSite = app.metadata?.sitePost as { status?: string } | undefined;
  const missingAddress = manager && !info.site?.settings?.mailing_address;

  const write = () => { close(); owApi().app.createDocument(); };

  return (
    <Page title={info.site?.name || host(info.address)} sub={<a href={info.address} target="_blank" rel="noopener noreferrer">{host(info.address)}</a>}
      actions={<>
        <Btn onClick={write}>Write a post</Btn>
        {app.filename && <Btn kind="primary" onClick={() => go('publish')}>{onSite?.status === 'published' ? 'Update' : 'Publish'} "{app.title || 'Untitled'}"</Btn>}
      </>}>
      <Sending />
      {missingAddress && (
        <Notice kind="warn"><span>Add a mailing address before your first email; the law requires one in every newsletter.</span> <Btn kind="quiet" onClick={() => go('settings')}>Add it in Settings</Btn></Notice>
      )}
      {manager && (
        stats.error ? <Failed error={stats.error} retry={stats.reload} /> : (
          <Stats>
            <Stat label="Subscribers" value={stats.data ? total.toLocaleString() : '...'} sub={stats.data ? `${(stats.data.site?.members_gained_30d ?? 0).toLocaleString()} new in 30 days` : undefined} />
            <Stat label="Paid subscribers" value={stats.data ? paid.toLocaleString() : '...'} sub={tiers.comp ? `${tiers.comp} complimentary` : undefined} />
            <Stat label="Monthly revenue" value={stats.data ? money(revenue?.mrr ?? 0, revenue?.currency) : '...'} sub={revenue?.writer_net !== undefined ? `${money(revenue.writer_net, revenue.currency)} after the 5% fee` : undefined} />
            <Stat label="Views" value={stats.data ? (stats.data.site?.views_30d ?? 0).toLocaleString() : '...'} sub="last 30 days" />
          </Stats>
        )
      )}
      <Section title="Latest posts" aside={<button type="button" className="ows-link" onClick={() => go('posts')}>All posts</button>}>
        {posts.loading && !posts.data && <Loading what="posts" />}
        {posts.error && <Failed error={posts.error} retry={posts.reload} />}
        {posts.data && posts.data.posts.length === 0 && <Empty>Nothing published yet. Write a post, then Publish sends it to your site and your subscribers.</Empty>}
        {posts.data && posts.data.posts.length > 0 && (
          <Rows>
            {posts.data.posts.map((p) => {
              const e = p.stats?.email;
              return (
                <Row key={p.id} title={p.title || 'Untitled'}
                  meta={[day(p.published_at), p.audience === 'paid' ? 'Paid' : null, p.pinned ? 'Pinned' : null].filter(Boolean).join(' · ')}
                  aside={p.stats ? (
                    <span className="ows-row-stats">
                      {`${(p.stats.views ?? 0).toLocaleString()} views`}
                      {e ? ` · ${percent(e.opens, e.recipients)} opened` : ''}
                    </span>
                  ) : undefined}
                  actions={p.url ? <a className="ows-btn ows-btn--quiet" href={p.url} target="_blank" rel="noopener noreferrer">View</a> : undefined} />
              );
            })}
          </Rows>
        )}
      </Section>
    </Page>
  );
}
