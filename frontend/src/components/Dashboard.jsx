import { useCallback, useEffect, useMemo, useState } from 'react';
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
  if (!res.ok) throw new Error(await errorDetail(res, url));
  return res.json();
}

async function postJson(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(await errorDetail(res, url));
  return res.json();
}

async function errorDetail(res, url) {
  try {
    const payload = await res.json();
    if (payload?.detail) return typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail);
  } catch {
    /* response was not JSON */
  }
  return `Request to ${url} failed (${res.status}).`;
}

const POLL_INTERVAL_MS = 4000;

// The backend registers the job and hands back the n8n webhook address; the browser starts the run.
async function triggerWorkflow(dispatch) {
  if (!dispatch?.url) return;
  const res = await fetch(dispatch.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dispatch.payload),
  });
  if (!res.ok) throw new Error(`The n8n workflow could not be started (${res.status}).`);
}

// One suggestion per review comment, refreshed until the fix agent finishes.
function useFixSuggestions(repoId, prNumber, enabled) {
  const { getToken } = useAuth();
  const [byComment, setByComment] = useState({});
  const [busyComment, setBusyComment] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const token = await getToken();
    const list = await fetchJson(
      `/api/reviews/suggestions?repository_id=${repoId}&pr_number=${prNumber}`,
      token,
    );
    // The API returns newest first, so the first entry per comment is the current one.
    const map = {};
    for (const item of list) {
      if (!map[item.comment_id]) map[item.comment_id] = item;
    }
    setByComment(map);
  }, [getToken, repoId, prNumber]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    refresh().catch((err) => {
      if (!cancelled) setError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!Object.values(byComment).some((s) => s.status === 'processing')) return undefined;
    const timer = setTimeout(() => {
      refresh().catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [enabled, byComment, refresh]);

  const requestFix = useCallback(
    async (comment) => {
      setError('');
      setBusyComment(comment.id);
      try {
        const token = await getToken();
        const suggestion = await postJson('/api/reviews/suggestions', token, {
          repository_id: repoId,
          pr_number: prNumber,
          comment_id: comment.id,
          path: comment.path,
          line: comment.line ?? null,
          severity: comment.severity,
          category: comment.category,
          body: comment.body,
        });
        setByComment((current) => ({ ...current, [comment.id]: suggestion }));
        await triggerWorkflow(suggestion.dispatch);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusyComment('');
      }
    },
    [getToken, repoId, prNumber],
  );

  const approveFix = useCallback(
    async (suggestion) => {
      setError('');
      setBusyComment(suggestion.comment_id);
      try {
        const token = await getToken();
        const applied = await postJson(`/api/reviews/suggestions/${suggestion.id}/approve`, token);
        setByComment((current) => ({ ...current, [applied.comment_id]: applied }));
      } catch (err) {
        setError(err.message);
      } finally {
        setBusyComment('');
      }
    },
    [getToken],
  );

  return { byComment, busyComment, error, requestFix, approveFix };
}

function useBuildCheck(repoId, prNumber, enabled) {
  const { getToken } = useAuth();
  const [check, setCheck] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const token = await getToken();
    setCheck(await fetchJson(`/api/reviews/build-check?repository_id=${repoId}&pr_number=${prNumber}`, token));
  }, [getToken, repoId, prNumber]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    refresh().catch((err) => {
      if (!cancelled) setError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || check?.status !== 'processing') return undefined;
    const timer = setTimeout(() => {
      refresh().catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [enabled, check, refresh]);

  const runCheck = useCallback(async () => {
    setError('');
    setRunning(true);
    try {
      const token = await getToken();
      const started = await postJson('/api/reviews/build-check', token, {
        repository_id: repoId,
        pr_number: prNumber,
      });
      setCheck(started);
      await triggerWorkflow(started.dispatch);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }, [getToken, repoId, prNumber]);

  return { check, running, error, runCheck };
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

function SuggestedFileBlock({ file }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="suggested-file">
      <button type="button" className="suggested-file-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="comment-path">{file.path}</span>
        <span>{open ? 'Hide proposed file ▾' : 'Show proposed file ▸'}</span>
      </button>
      {open && <pre className="suggested-file-code">{file.content}</pre>}
    </div>
  );
}

function FixSuggestionPanel({ comment, suggestion, busy, onRequest, onApprove }) {
  if (!suggestion) {
    return (
      <div className="fix-panel-actions">
        <button type="button" className="suggest-fix-button" disabled={busy} onClick={() => onRequest(comment)}>
          {busy ? 'Starting…' : '✨ Suggest a fix'}
        </button>
      </div>
    );
  }

  if (suggestion.status === 'processing') {
    return <p className="fix-panel-status">⏳ The fix agent is writing a patch for this comment…</p>;
  }

  if (suggestion.status === 'error' || suggestion.status === 'empty') {
    return (
      <div className="fix-panel">
        <p className="fix-panel-status">
          {suggestion.status === 'empty'
            ? 'The fix agent could not produce a safe code change for this comment.'
            : 'The fix agent failed to generate a suggestion.'}
        </p>
        {suggestion.explanation && <p className="comment-body">{suggestion.explanation}</p>}
        <div className="fix-panel-actions">
          <button type="button" className="suggest-fix-button" disabled={busy} onClick={() => onRequest(comment)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fix-panel">
      <div className="fix-panel-header">
        <strong>Proposed fix</strong>
        <span className="fix-panel-files">
          {suggestion.files.length} file{suggestion.files.length === 1 ? '' : 's'}
        </span>
      </div>
      {suggestion.explanation && <p className="comment-body">{suggestion.explanation}</p>}
      {suggestion.files.map((file) => (
        <SuggestedFileBlock key={file.path} file={file} />
      ))}
      {suggestion.status === 'applied' ? (
        <div className="fix-panel-actions">
          <span className="badge badge-clean">PR created</span>
          <a className="pr-link" href={suggestion.fix_pr_url} target="_blank" rel="noreferrer">
            {suggestion.fix_branch} → {suggestion.head_branch} ↗
          </a>
        </div>
      ) : (
        <div className="fix-panel-actions">
          <button type="button" className="primary-button small" disabled={busy} onClick={() => onApprove(suggestion)}>
            {busy ? 'Opening PR…' : `Approve & open PR into ${suggestion.head_branch}`}
          </button>
          <button type="button" className="suggest-fix-button" disabled={busy} onClick={() => onRequest(comment)}>
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}

function CommentCard({ comment, showAgent, fix }) {
  return (
    <li className={`comment-card comment-card-${comment.severity}`}>
      <div className="comment-card-header">
        <PriorityBadge severity={comment.severity} />
        {showAgent && (
          <span className="comment-agent">
            <span className="agent-dot" style={{ background: AGENT_COLOR[comment.category] || '#64748b' }} />
            {agentForCategory(comment.category)}
          </span>
        )}
        <span className="comment-path">
          {comment.path}
          {typeof comment.line === 'number' ? `:${comment.line}` : ''}
        </span>
      </div>
      <p className="comment-body">{comment.body}</p>
      {comment.html_url && (
        <a className="pr-link" href={comment.html_url} target="_blank" rel="noreferrer">
          View comment on GitHub ↗
        </a>
      )}
      {fix && (
        <FixSuggestionPanel
          comment={comment}
          suggestion={fix.suggestion}
          busy={fix.busy}
          onRequest={fix.onRequest}
          onApprove={fix.onApprove}
        />
      )}
    </li>
  );
}

const FINAL_TAB_ID = 'final';

// Per-PR tabs: one tab per review agent plus the master triage result posted on the PR.
function PrCommentTabs({ pr, sortedComments, fixes }) {
  const [activeTab, setActiveTab] = useState(categoryOrder[0]);

  // The triage agent can emit a category outside the four known agents; keep those visible too.
  const categories = useMemo(() => {
    const extra = sortedComments.map((c) => c.category).filter((c) => c && !categoryOrder.includes(c));
    return [...categoryOrder, ...new Set(extra)];
  }, [sortedComments]);

  const byCategory = useMemo(
    () =>
      Object.fromEntries(
        categories.map((category) => [category, sortedComments.filter((c) => c.category === category)]),
      ),
    [categories, sortedComments],
  );
  const shortlisted = useMemo(
    () => sortedComments.filter((c) => c.severity === 'blocker'),
    [sortedComments],
  );

  const activeComments = activeTab === FINAL_TAB_ID ? shortlisted : byCategory[activeTab] || [];

  return (
    <div className="pr-comment-tabs">
      <nav className="agent-tabs">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={`agent-tab ${activeTab === category ? 'agent-tab-active' : ''}`}
            style={activeTab === category ? { borderBottomColor: AGENT_COLOR[category] || '#2563eb' } : undefined}
            onClick={() => setActiveTab(category)}
          >
            <span className="agent-dot" style={{ background: AGENT_COLOR[category] || '#64748b' }} />
            {agentForCategory(category)}
            <span className="agent-tab-count">{byCategory[category].length}</span>
          </button>
        ))}
        <button
          type="button"
          className={`agent-tab agent-tab-final ${activeTab === FINAL_TAB_ID ? 'agent-tab-active' : ''}`}
          onClick={() => setActiveTab(FINAL_TAB_ID)}
        >
          🔴 Final review
          <span className="agent-tab-count">{shortlisted.length}</span>
        </button>
      </nav>

      {activeTab === FINAL_TAB_ID && (
        <div className="final-review-panel">
          <p className="tab-intro">
            High priority findings shortlisted by the Master Triage Agent and posted on this pull request.
          </p>
          {pr.summary && <p className="pr-summary-text">{pr.summary}</p>}
        </div>
      )}

      {activeComments.length === 0 ? (
        <p className="empty-note">
          {activeTab === FINAL_TAB_ID
            ? 'No blocker-level comments were shortlisted for this PR.'
            : `No comments from the ${agentForCategory(activeTab)} on this PR.`}
        </p>
      ) : (
        <ul className="comment-list">
          {activeComments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              showAgent={activeTab === FINAL_TAB_ID}
              fix={{
                suggestion: fixes.byComment[comment.id],
                busy: fixes.busyComment === comment.id,
                onRequest: fixes.requestFix,
                onApprove: fixes.approveFix,
              }}
            />
          ))}
        </ul>
      )}
      {fixes.error && <p className="form-message form-message-error">{fixes.error}</p>}
    </div>
  );
}

const CONFIDENCE_LABEL = { high: 'high confidence', medium: 'medium confidence', low: 'low confidence' };

function BuildCheckPanel({ repoId, prNumber, enabled }) {
  const { check, running, error, runCheck } = useBuildCheck(repoId, prNumber, enabled);
  const processing = running || check?.status === 'processing';

  return (
    <div className={`build-panel ${check && check.status === 'completed' ? (check.will_build ? 'build-panel-pass' : 'build-panel-fail') : ''}`}>
      <div className="build-panel-header">
        <strong>Build check</strong>
        {check?.status === 'completed' && (
          <span className={`badge ${check.will_build ? 'badge-clean' : 'badge-blocker'}`}>
            {check.will_build ? 'Build should pass' : 'Build will fail'}
          </span>
        )}
        {check?.status === 'completed' && (
          <span className="build-panel-meta">
            {check.build_command} · {CONFIDENCE_LABEL[check.confidence] || check.confidence}
          </span>
        )}
        <button type="button" className="suggest-fix-button" disabled={processing} onClick={runCheck}>
          {processing ? 'Analysing…' : check ? 'Re-check build' : 'Check build'}
        </button>
      </div>

      {!check && !processing && (
        <p className="empty-note">
          Predict whether <code>npm run build</code> will succeed on this PR head before the pipeline runs it.
        </p>
      )}
      {processing && <p className="fix-panel-status">⏳ Analysing the PR head for build-breaking changes…</p>}
      {check?.status === 'error' && <p className="form-message form-message-error">{check.summary}</p>}
      {check?.status === 'completed' && check.summary && <p className="comment-body">{check.summary}</p>}
      {check?.status === 'completed' && check.issues.length > 0 && (
        <ul className="build-issue-list">
          {check.issues.map((issue, index) => (
            <li key={`${issue.path}-${issue.line}-${index}`} className={`build-issue build-issue-${issue.severity}`}>
              <span className={`badge badge-${issue.severity === 'warning' ? 'warning' : 'blocker'}`}>{issue.severity}</span>
              <span className="comment-path">
                {issue.path}
                {typeof issue.line === 'number' ? `:${issue.line}` : ''}
              </span>
              <span className="comment-body">{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="form-message form-message-error">{error}</p>}
    </div>
  );
}

function PrCard({ pr, isOpen, onToggle }) {
  const sortedComments = useMemo(() => {
    const rank = Object.fromEntries(severityOrder.map((s, i) => [s, i]));
    return [...pr.comments].sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [pr]);
  const counts = severityCounts(pr.comments);
  const fixes = useFixSuggestions(pr.repoId, pr.number, isOpen);


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
          <div className="pr-card-actions">
            <a className="pr-link" href={pr.url} target="_blank" rel="noreferrer">
              View on GitHub ↗
            </a>
          </div>

          <BuildCheckPanel repoId={pr.repoId} prNumber={pr.number} enabled={isOpen} />

          {pr.comments.length === 0 ? (
            <p className="empty-note">No AI review comments have been posted on this PR yet.</p>
          ) : (
            <PrCommentTabs pr={pr} sortedComments={sortedComments} fixes={fixes} />
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

function HighPriorityPrGroup({ pr, comments }) {
  const fixes = useFixSuggestions(pr.repoId, pr.number, true);

  return (
    <div className="high-priority-group">
      <a className="pr-link" href={pr.url} target="_blank" rel="noreferrer">
        {pr.repo} #{pr.number} — {pr.title} ↗
      </a>
      <ul className="comment-list">
        {comments.map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            showAgent
            fix={{
              suggestion: fixes.byComment[comment.id],
              busy: fixes.busyComment === comment.id,
              onRequest: fixes.requestFix,
              onApprove: fixes.approveFix,
            }}
          />
        ))}
      </ul>
      {fixes.error && <p className="form-message form-message-error">{fixes.error}</p>}
    </div>
  );
}

function HighPriorityTab({ allPrs, repoCount }) {
  const groups = allPrs
    .map((pr) => ({ pr, comments: pr.comments.filter((c) => c.severity === 'blocker') }))
    .filter((g) => g.comments.length > 0)
    .sort((a, b) => new Date(b.pr.createdAt) - new Date(a.pr.createdAt));

  const total = groups.reduce((sum, g) => sum + g.comments.length, 0);

  if (total === 0) {
    return <p className="empty-note">No high priority (blocker) comments are currently open. 🎉</p>;
  }

  return (
    <div className="high-priority-tab">
      <p className="tab-intro">
        {total} blocker comment{total === 1 ? '' : 's'} currently open across {repoCount} repositories. Generate a
        fix on any of them and approve it to open a PR into the reviewed branch.
      </p>
      {groups.map((g) => (
        <HighPriorityPrGroup key={g.pr.id} pr={g.pr} comments={g.comments} />
      ))}
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
