// Static mappings shared by the dashboard components (severity/category are produced by the
// CodeGuards AI PR Review Pipeline: severity is 'blocker' | 'warning' | 'suggestion',
// category is 'architecture' | 'regression' | 'code-quality' | 'alignment').

const AGENT_BY_CATEGORY = {
  architecture: 'Architecture Agent',
  regression: 'Regression Agent',
  'code-quality': 'Code Quality Agent',
  alignment: 'Alignment Agent',
};

export function agentForCategory(category) {
  return AGENT_BY_CATEGORY[category] || 'Review Agent';
}

export const severityOrder = ['blocker', 'warning', 'suggestion'];
export const categoryOrder = ['architecture', 'regression', 'code-quality', 'alignment'];

const REVIEW_EVENT_BY_STATE = {
  APPROVED: 'APPROVE',
  CHANGES_REQUESTED: 'REQUEST_CHANGES',
  COMMENTED: 'COMMENT',
};

export function normalizeReviewEvent(state) {
  return REVIEW_EVENT_BY_STATE[state] || 'COMMENT';
}
