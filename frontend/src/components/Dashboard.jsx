import { useEffect, useMemo, useState } from 'react';
import { useAuth, UserButton } from '@clerk/clerk-react';
import { agentForCategory, categoryOrder, normalizeReviewEvent, severityOrder } from '../lib/reviewMeta.js';
import './Dashboard.css';

const SEVERITY_LABEL = { blocker: 'Blocker', warning: 'Warning', suggestion: 'Suggestion' };
const SEVERITY_COLOR = { blocker: '#dc2626', warning: '#d97706', suggestion: '#2563eb' };
const AGENT_COLOR = {
  architecture: '#7c3aed',
  regression: '#0891b2',
  'code-quality': '#059669',
  alignment: '#ea580c',
};

function emptySeverityMap() {
  return { blocker: 0, warning: 0, suggestion: 0 };
}

function severityCounts(comments) {
  return comments.reduce((acc, c) => {
    acc[c.severity] = (acc[c.severity] || 0) + 1;
    return acc;
  }, emptySeverityMap());
}

function categoryCounts(comments) {
  return comments.reduce((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + 1;
    return acc;
  }, {});
}

function formatDate(iso) {
  if (!iso) return 'unknown date';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Builds a real last-7-days activity trend from each comment's created_at timestamp.
function buildActivityTrend(allComments) {
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: d.toISOString().slice(0, 10), date: d.toISOString(), blocker: 0, warning: 0, suggestion: 0 });
  }
  const byKey = Object.fromEntries(days.map((d) => [d.key, d]));
  for (const comment of allComments) {
    if (!comment.created_at) continue;
    const key = comment.created_at.slice(0, 10);
    const bucket = byKey[key];
    if (bucket && comment.severity in bucket) bucket[comment.severity] += 1;
  }
  return days;
}

async function fetchJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Request to ${url} failed (${res.status}).`);
  return res.json();
}

function useReviewsData(getToken) {
  const [state, setState] = useState({ loading: true, error: '', repos: [], prs: [] });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const token = await getToken();
        const [repoList, reviewList] = await Promise.all([
          fetchJson('/api/repositories', token),
          fetchJson('/api/reviews', token),
        ]);
        if (cancelled) return;

        const reviewsByRepoId = Object.fromEntries(reviewList.map((r) => [r.repository_id, r]));

        const repos = repoList.map((repo) => ({
          id: repo.id,
          fullName: repo.full_name,
          status: repo.status,
          webhookRegistered: repo.webhook_registered,
          registeredAt: repo.created_at,
        }));

        const prs = repoList.flatMap((repo) => {
          const review = reviewsByRepoId[repo.id];
          if (!review) return [];
          return review.pull_requests.map((pr) => ({
            id: `${repo.id}-${pr.number}`,
            repoId: repo.id,
            repo: repo.full_name,
            number: pr.number,
            title: pr.title,
            author: pr.author,
            branch: pr.branch,
            baseBranch: pr.base_branch,
            url: pr.html_url,
            createdAt: pr.created_at,
            reviewEvent: normalizeReviewEvent(pr.review_event),
            summary: pr.summary,
            comments: pr.comments,
          }));
        });

        setState({ loading: false, error: '', repos, prs });
      } catch (err) {
        if (!cancelled) {
          setState({ loading: false, error: err.message || 'Failed to load dashboard data.', repos: [], prs: [] });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return state;
}

function PriorityBadge({ severity }) {
  return <span className={`badge badge-${severity}`}>{SEVERITY_LABEL[severity] || severity}</span>;
}

function ReviewEventBadge({ event }) {
  const tone = event === 'REQUEST_CHANGES' ? 'blocker' : event === 'COMMENT' ? 'warning' : 'suggestion';
  const label = event === 'REQUEST_CHANGES' ? 'Changes requested' : event === 'COMMENT' ? 'Commented' : 'Approved';
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

function StatCard({ label, value, tone, hint }) {
  return (
    <div className={`stat-card ${tone ? `stat-card-${tone}` : ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

// CSS conic-gradient donut chart, no charting library required.
function DonutChart({ segments, centerLabel, centerValue }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  let cursor = 0;
  const stops = segments
    .map((s) => {
      const start = (cursor / total) * 360;
      cursor += s.value;
      const end = (cursor / total) * 360;
      return `${s.color} ${start}deg ${end}deg`;
    })
    .join(', ');

  return (
    <div className="donut-wrap">
      <div className="donut-chart" style={{ background: total ? `conic-gradient(${stops})` : '#e2e8f0' }}>
        <div className="donut-hole">
          <span className="donut-value">{centerValue}</span>
          <span className="donut-label">{centerLabel}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="legend-dot" style={{ background: s.color }} />
            {s.label}
            <span className="legend-count">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BarList({ rows }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bar-chart">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="bar-label">{r.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </div>
          <span className="bar-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function TrendChart({ data }) {
  const max = Math.max(...data.map((d) => d.blocker + d.warning + d.suggestion), 1);
  return (
    <div className="trend-chart">
      {data.map((d) => (
        <div className="trend-col" key={d.key} title={formatShortDate(d.date)}>
          <div className="trend-stack">
            {severityOrder.map((sev) => {
              const h = (d[sev] / max) * 100;
              return h > 0 ? (
                <div key={sev} className="trend-segment" style={{ height: `${h}%`, background: SEVERITY_COLOR[sev] }} />
              ) : null;
            })}
          </div>
          <span className="trend-date">{formatShortDate(d.date)}</span>
        </div>
      ))}
    </div>
  );
}

function CommentCard({ comment }) {
  return (
    <li className={`comment-card comment-card-${comment.severity}`}>
      <div className="comment-card-header">
        <PriorityBadge severity={comment.severity} />
        <span className="comment-path">
          {comment.path}
          {typeof comment.line === 'number' ? `:${comment.line}` : ''}
        </span>
      </div>
      <p className="comment-body">{comment.body}</p>
    </li>
  );
}

function AgentColumns({ comments }) {
  const grouped = categoryOrder
    .map((category) => ({ category, items: comments.filter((c) => c.category === category) }))
    .filter((g) => g.items.length > 0);

  if (grouped.length === 0) {
    return <p className="empty-note">No comments from any agent on this PR.</p>;
  }

  return (
    <div className="agent-columns">
      {grouped.map((g) => (
        <div className="agent-column" key={g.category}>
          <div className="agent-column-header" style={{ borderColor: AGENT_COLOR[g.category] }}>
            <span className="agent-dot" style={{ background: AGENT_COLOR[g.category] }} />
            <span>{agentForCategory(g.category)}</span>
            <span className="agent-column-count">{g.items.length}</span>
          </div>
          <ul className="comment-list">
            {g.items.map((comment) => (
              <CommentCard key={comment.id} comment={comment} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PrCard({ pr, isOpen, onToggle }) {
  const sortedComments = useMemo(() => {
    const rank = Object.fromEntries(severityOrder.map((s, i) => [s, i]));
    return [...pr.comments].sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [pr]);
  const counts = severityCounts(pr.comments);
  const highPriority = pr.comments.filter((c) => c.severity === 'blocker');

  return (
    <div className="pr-card">
      <button className="pr-card-header" onClick={() => onToggle(pr.id)}>
        <div className="pr-card-title">
          <span className="pr-number">#{pr.number}</span>
          <span>{pr.title}</span>
        </div>
        <div className="pr-list-item-meta">
          <span>{pr.author}</span>
          <span>·</span>
          <span>{pr.branch} → {pr.baseBranch}</span>
          <span>·</span>
          <span>{formatDate(pr.createdAt)}</span>
        </div>
        <div className="pr-card-badges">
          <ReviewEventBadge event={pr.reviewEvent} />
          {counts.blocker > 0 && <PriorityBadge severity="blocker" />}
          {counts.warning > 0 && <PriorityBadge severity="warning" />}
          {counts.suggestion > 0 && <PriorityBadge severity="suggestion" />}
        </div>
        <span className="pr-card-caret">{isOpen ? '▾' : '▸'}</span>
      </button>

      {isOpen && (
        <div className="pr-card-body">
          {pr.summary && <p className="pr-summary-text">{pr.summary}</p>}
          <div className="pr-card-actions">
            <a className="pr-link" href={pr.url} target="_blank" rel="noreferrer">
              View on GitHub ↗
            </a>
          </div>

          {highPriority.length > 0 && (
            <div className="high-priority-inline">
              <h4>🔴 High priority ({highPriority.length})</h4>
              <ul className="comment-list">
                {highPriority.map((c) => (
                  <CommentCard key={c.id} comment={c} />
                ))}
              </ul>
            </div>
          )}

          <h4>Comments by agent</h4>
          {pr.comments.length === 0 ? (
            <p className="empty-note">No AI review comments have been posted on this PR yet.</p>
          ) : (
            <AgentColumns comments={sortedComments} />
          )}
        </div>
      )}
    </div>
  );
}

function RepoSection({ repo, prs, openPrId, onTogglePr }) {
  const counts = severityCounts(prs.flatMap((p) => p.comments));

  return (
    <div className="repo-section">
      <div className="repo-section-header">
        <div>
          <h3>{repo.fullName}</h3>
          <div className="pr-list-item-meta">
            <span>{repo.webhookRegistered ? 'Webhook active' : 'Webhook not registered'}</span>
            <span>·</span>
            <span>Registered {formatDate(repo.registeredAt)}</span>
          </div>
        </div>
        <div className="repo-section-stats">
          <span className="repo-open-count">{prs.length} open PR{prs.length === 1 ? '' : 's'}</span>
          {counts.blocker > 0 && <PriorityBadge severity="blocker" />}
          {counts.warning > 0 && <PriorityBadge severity="warning" />}
          {counts.suggestion > 0 && <PriorityBadge severity="suggestion" />}
        </div>
      </div>

      {prs.length === 0 ? (
        <p className="empty-note">No open pull requests for this repository.</p>
      ) : (
        <div className="pr-card-list">
          {prs.map((pr) => (
            <PrCard key={pr.id} pr={pr} isOpen={openPrId === pr.id} onToggle={onTogglePr} />
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ repos, allComments, allPrs }) {
  const bySeverity = severityCounts(allComments);
  const byCategory = categoryCounts(allComments);
  const blockerPrs = allPrs.filter((pr) => pr.comments.some((c) => c.severity === 'blocker')).length;
  const activityTrend = useMemo(() => buildActivityTrend(allComments), [allComments]);

  const donutSegments = severityOrder.map((s) => ({
    label: SEVERITY_LABEL[s],
    value: bySeverity[s] || 0,
    color: SEVERITY_COLOR[s],
  }));

  const agentRows = categoryOrder.map((c) => ({
    label: agentForCategory(c),
    value: byCategory[c] || 0,
    color: AGENT_COLOR[c],
  }));

  return (
    <div className="overview-tab">
      <div className="stat-grid">
        <StatCard label="Registered repos" value={repos.length} />
        <StatCard label="Open PRs" value={allPrs.length} />
        <StatCard label="Total comments" value={allComments.length} />
        <StatCard
          label="Blocker comments"
          value={bySeverity.blocker}
          tone="blocker"
          hint={`${blockerPrs} PR${blockerPrs === 1 ? '' : 's'} affected`}
        />
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3>Comments by priority</h3>
          <DonutChart segments={donutSegments} centerLabel="Total" centerValue={allComments.length} />
        </div>
        <div className="chart-card">
          <h3>Comments by agent</h3>
          <BarList rows={agentRows} />
        </div>
        <div className="chart-card chart-card-wide">
          <h3>Activity — last 7 days</h3>
          <TrendChart data={activityTrend} />
          <ul className="trend-legend">
            {severityOrder.map((s) => (
              <li key={s}>
                <span className="legend-dot" style={{ background: SEVERITY_COLOR[s] }} />
                {SEVERITY_LABEL[s]}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="repo-summary-grid">
        {repos.map((repo) => {
          const prs = allPrs.filter((p) => p.repoId === repo.id);
          const counts = severityCounts(prs.flatMap((p) => p.comments));
          const clean = counts.blocker + counts.warning + counts.suggestion === 0;
          return (
            <div className="repo-summary-card" key={repo.id}>
              <h4>{repo.fullName}</h4>
              <div className="pr-list-item-meta">
                <span>{prs.length} open PR{prs.length === 1 ? '' : 's'}</span>
              </div>
              <div className="repo-summary-badges">
                {counts.blocker > 0 && <PriorityBadge severity="blocker" />}
                {counts.warning > 0 && <PriorityBadge severity="warning" />}
                {counts.suggestion > 0 && <PriorityBadge severity="suggestion" />}
                {clean && <span className="badge badge-clean">All clear</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReposTab({ repos, prs, openPrId, onTogglePr }) {
  if (repos.length === 0) {
    return <p className="empty-note">No repositories registered yet.</p>;
  }
  return (
    <div className="repos-tab">
      {repos.map((repo) => (
        <RepoSection
          key={repo.id}
          repo={repo}
          prs={prs.filter((p) => p.repoId === repo.id)}
          openPrId={openPrId}
          onTogglePr={onTogglePr}
        />
      ))}
    </div>
  );
}

function HighPriorityTab({ allPrs, repoCount }) {
  const items = allPrs
    .flatMap((pr) => pr.comments.filter((c) => c.severity === 'blocker').map((c) => ({ pr, comment: c })))
    .sort((a, b) => new Date(b.pr.createdAt) - new Date(a.pr.createdAt));

  if (items.length === 0) {
    return <p className="empty-note">No high priority (blocker) comments are currently open. 🎉</p>;
  }

  return (
    <div className="high-priority-tab">
      <p className="tab-intro">
        {items.length} blocker comment{items.length === 1 ? '' : 's'} currently open across {repoCount}{' '}
        repositories.
      </p>
      <ul className="comment-list">
        {items.map(({ pr, comment }) => (
          <li className="comment-card comment-card-blocker" key={comment.id}>
            <div className="comment-card-header">
              <PriorityBadge severity="blocker" />
              <span className="comment-agent">{agentForCategory(comment.category)}</span>
              <span className="comment-path">
                {comment.path}
                {typeof comment.line === 'number' ? `:${comment.line}` : ''}
              </span>
            </div>
            <p className="comment-body">{comment.body}</p>
            <a className="pr-link" href={pr.url} target="_blank" rel="noreferrer">
              {pr.repo} #{pr.number} — {pr.title} ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'repos', label: 'Repositories & PRs' },
  { id: 'high-priority', label: 'High Priority' },
];

export default function Dashboard({ onManageRepos, onOpenChat }) {
  const { getToken } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [openPrId, setOpenPrId] = useState(null);
  const { loading, error, repos, prs } = useReviewsData(getToken);

  const allComments = useMemo(() => prs.flatMap((pr) => pr.comments), [prs]);
  const blockerCount = allComments.filter((c) => c.severity === 'blocker').length;

  const togglePr = (id) => setOpenPrId((current) => (current === id ? null : id));

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-header-row">
          <div>
            <h1>PR Review Dashboard</h1>
            <p>Live comments posted by the CodeGuards AI review pipeline, across all registered repositories.</p>
          </div>
          {onManageRepos && (
            <>
              <button className="secondary-button" type="button" onClick={onManageRepos}>
                Manage repositories
              </button>
              <button className="primary-button" type="button" onClick={onOpenChat} style={{ marginLeft: '12px' }}>
                Ask AI
              </button>
            </>
          )}
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>

      {loading && <p className="empty-note">Loading dashboard data…</p>}
      {!loading && error && <p className="form-message form-message-error">{error}</p>}

      {!loading && !error && (
        <>
          <nav className="dashboard-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`tab-button ${activeTab === tab.id ? 'tab-button-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                {tab.id === 'high-priority' && blockerCount > 0 && <span className="tab-count">{blockerCount}</span>}
              </button>
            ))}
          </nav>

          {activeTab === 'overview' && <OverviewTab repos={repos} allComments={allComments} allPrs={prs} />}
          {activeTab === 'repos' && (
            <ReposTab repos={repos} prs={prs} openPrId={openPrId} onTogglePr={togglePr} />
          )}
          {activeTab === 'high-priority' && <HighPriorityTab allPrs={prs} repoCount={repos.length} />}
        </>
      )}
    </div>
  );
}
