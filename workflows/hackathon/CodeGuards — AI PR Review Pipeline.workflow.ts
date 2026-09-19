import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : CodeGuards — AI PR Review Pipeline
// Nodes   : 42  |  Connections: 29
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// GithubPrWebhook                    webhook
// Bootstrapper                       code
// IntentGetter                       httpRequest
// RulesGetter                        httpRequest                [onError→regular]
// DiffGetter                         httpRequest
// ResolveConfig                      code
// ArchRulesDocGetter                 httpRequest                [onError→regular]
// TechStackDocGetter                 httpRequest                [onError→regular]
// CredentialsGetter                  httpRequest
// MergeContext                       code
// IfArchitecture                     if
// IfRegression                       if
// IfCodeQuality                      if
// IfAlignment                        if
// ArchitectureAgent                  agent                      [AI]
// ArchIndexSearcher                  httpRequestTool            [ai_tool]
// ArchContextProvider                httpRequestTool            [ai_tool]
// ArchGeminiPro                      lmChatGoogleGemini         [creds] [ai_languageModel]
// ArchGeminiFallback                 lmChatGoogleGemini         [creds] [ai_languageModel]
// RegressionAgent                    agent                      [AI]
// RegIndexSearcher                   httpRequestTool            [ai_tool]
// RegContextProvider                 httpRequestTool            [ai_tool]
// FlashModelRegression               lmChatGoogleGemini         [creds] [ai_languageModel]
// RegGeminiFallback                  lmChatGoogleGemini         [creds] [ai_languageModel]
// CodeQualityAgent                   agent                      [AI]
// QualIndexSearcher                  httpRequestTool            [ai_tool]
// QualContextProvider                httpRequestTool            [ai_tool]
// FlashModelQuality                  lmChatGoogleGemini         [creds] [ai_languageModel]
// QualGeminiFallback                 lmChatGoogleGemini         [creds] [ai_languageModel]
// AlignmentAgent                     agent                      [AI]
// AlignIndexSearcher                 httpRequestTool            [ai_tool]
// AlignContextProvider               httpRequestTool            [ai_tool]
// FlashModelAlignment                lmChatGoogleGemini         [creds] [ai_languageModel]
// AlignGeminiFallback                lmChatGoogleGemini         [creds] [ai_languageModel]
// CollectAgentOutputs                merge
// MergeAgentResults                  code
// MasterTriageAgent                  agent                      [AI]
// TriageGeminiPro                    lmChatGoogleGemini         [creds] [ai_languageModel]
// TriageGeminiFallback               lmChatGoogleGemini         [creds] [ai_languageModel]
// TriageOutputParser                 outputParserStructured     [ai_outputParser]
// FormatComments                     code
// GithubCommentWriter                httpRequest                [creds]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// GithubPrWebhook
//    → Bootstrapper
//      → CredentialsGetter
//        → IntentGetter
//          → RulesGetter
//            → ResolveConfig
//              → DiffGetter
//                → ArchRulesDocGetter
//                  → TechStackDocGetter
//                    → MergeContext
//                      → IfArchitecture
//                        → ArchitectureAgent
//                          → CollectAgentOutputs
//                            → MergeAgentResults
//                              → MasterTriageAgent
//                                → FormatComments
//                                  → GithubCommentWriter
//                       .out(1) → CollectAgentOutputs (↩ loop)
//                      → IfRegression
//                        → RegressionAgent
//                          → CollectAgentOutputs.in(1) (↩ loop)
//                       .out(1) → CollectAgentOutputs.in(1) (↩ loop)
//                      → IfCodeQuality
//                        → CodeQualityAgent
//                          → CollectAgentOutputs.in(2) (↩ loop)
//                       .out(1) → CollectAgentOutputs.in(2) (↩ loop)
//                      → IfAlignment
//                        → AlignmentAgent
//                          → CollectAgentOutputs.in(3) (↩ loop)
//                       .out(1) → CollectAgentOutputs.in(3) (↩ loop)
//
// AI CONNECTIONS
// ArchitectureAgent.uses({ ai_languageModel: [ArchGeminiPro, ArchGeminiFallback], ai_tool: [ArchIndexSearcher, ArchContextProvider] })
// RegressionAgent.uses({ ai_languageModel: [FlashModelRegression, RegGeminiFallback], ai_tool: [RegIndexSearcher, RegContextProvider] })
// CodeQualityAgent.uses({ ai_languageModel: [FlashModelQuality, QualGeminiFallback], ai_tool: [QualIndexSearcher, QualContextProvider] })
// AlignmentAgent.uses({ ai_languageModel: [FlashModelAlignment, AlignGeminiFallback], ai_tool: [AlignIndexSearcher, AlignContextProvider] })
// MasterTriageAgent.uses({ ai_languageModel: [TriageGeminiPro, TriageGeminiFallback], ai_outputParser: TriageOutputParser })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'UyKKlZDnuYx7IiOR',
    name: 'CodeGuards — AI PR Review Pipeline',
    active: true,
    isArchived: false,
    projectId: 'qNuy2v6q0zPtP2Zd',
    settings: { executionOrder: 'v1', binaryMode: 'separate' },
})
export class CodeguardsAiPrReviewPipelineWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: 'db79dfb2-721d-4b33-9743-c53ab386aa1a',
        webhookId: '53fd3a76-894e-4bf5-b230-2208f3541f01',
        name: 'GitHub PR Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2.1,
        position: [-224, 304],
        notes: 'Listens for GitHub PR opened/synchronize events. Set webhook URL in your GitHub repo Settings > Webhooks. Content-Type: application/json.',
        notesInFlow: true,
    })
    GithubPrWebhook = {
        httpMethod: 'POST',
        path: 'pr-review',
        options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 1,
        },
    };

    @node({
        id: 'a425e0d9-d5b5-493e-b639-31e6982f49cd',
        name: 'Bootstrapper',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-16, 304],
        notes: 'Parses the GitHub webhook payload. Extracts repo context and validates the PR event action.',
    })
    Bootstrapper = {
        jsCode: `
const item = $input.first()?.json || {};
const body = item.body || item;

const action = body?.action;
if (!action || !['opened', 'synchronize', 'reopened'].includes(action)) {
  // Gracefully terminate workflow without throwing an error for ping/non-PR events
  return [];
}

const pr = body.pull_request;
const repo = body.repository;

if (!pr || !repo) {
  return [];
}

return [{
  json: {
    owner: repo.owner?.login || repo.owner?.name,
    repo: repo.name,
    pr_number: pr.number,
    pr_title: pr.title,
    pr_body: pr.body || '',
    head_sha: pr.head?.sha,
    base_sha: pr.base?.sha,
    head_branch: pr.head?.ref,
    base_branch: pr.base?.ref,
    default_branch: repo.default_branch,
    html_url: pr.html_url,
  }
}];
`,
    };

    @node({
        id: 'd1233732-fa31-4418-afa0-8c5ea0761ca3',
        name: 'Intent Getter',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [448, 160],
        notes: 'Fetches full PR metadata from GitHub API. Uses the per-repo PAT fetched by Credentials Getter.',
    })
    IntentGetter = {
        url: "=https://api.github.com/repos/{{ $('Bootstrapper').first().json.owner }}/{{ $('Bootstrapper').first().json.repo }}/pulls/{{ $('Bootstrapper').first().json.pr_number }}",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.v3+json',
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
            ],
        },
        options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 1,
        },
    };

    @node({
        id: '84a63e41-f895-4167-afcd-705c54a9f22d',
        name: 'Rules Getter',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [448, 304],
        onError: 'continueRegularOutput',
        notes: 'Loads /PR Reviewer/config.json from the repo via GitHub Contents API. Continues on error (uses defaults if file missing).',
    })
    RulesGetter = {
        url: "=https://api.github.com/repos/{{ $('Bootstrapper').first().json.owner }}/{{ $('Bootstrapper').first().json.repo }}/contents/PR%20Reviewer/config.json?ref={{ $('Bootstrapper').first().json.head_sha }}",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.v3.raw',
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
            ],
        },
        options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 1,
        },
    };

    @node({
        id: 'a3bb8875-a69e-4f9d-bb97-cb79e91054a4',
        name: 'Diff Getter',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [448, 448],
        notes: 'Fetches the raw unified diff for the PR.',
    })
    DiffGetter = {
        url: "=https://api.github.com/repos/{{ $('Bootstrapper').first().json.owner }}/{{ $('Bootstrapper').first().json.repo }}/pulls/{{ $('Bootstrapper').first().json.pr_number }}",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.v3.diff',
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
            ],
        },
        options: {
            response: {
                response: {
                    responseFormat: 'text',
                    outputPropertyName: 'data',
                },
            },
        },
    };

    @node({
        id: 'c1a7f0de-9b3e-4c21-9f77-5a2d61b0e401',
        name: 'Resolve Config',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [672, 448],
        notes: 'Parses PR Reviewer/config.json into agent toggles and rule-document paths.',
    })
    ResolveConfig = {
        jsCode: `
const DEFAULT_ARCHITECTURAL_RULES_PATH = 'PR Reviewer/architecture-rules.md';
const DEFAULT_TECH_STACK_PATH = 'PR Reviewer/tech-stack.md';

let raw = $input.first().json;
if (typeof raw === 'string') {
  try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
} else if (typeof raw.data === 'string') {
  try { raw = JSON.parse(raw.data); } catch (e) { raw = {}; }
}

const rulesData = raw && typeof raw === 'object' ? raw : {};
const agents = rulesData.agents || {};
const rules = rulesData.rules || {};

function enabled(explicit, legacy) {
  if (explicit === true) return true;
  if (explicit === false) return false;
  return legacy !== false;
}

return [{
  json: {
    architecture_enabled: enabled(agents.architecture, rulesData.architecture_enabled),
    regression_enabled: enabled(agents.regression, rulesData.regression_enabled),
    quality_enabled: enabled(agents.code_quality, rulesData.quality_enabled),
    alignment_enabled: enabled(agents.alignment, rulesData.alignment_enabled),
    architectural_rules_path: rules.architectural_rules_path || DEFAULT_ARCHITECTURAL_RULES_PATH,
    tech_stack_path: rules.tech_stack_path || DEFAULT_TECH_STACK_PATH,
  }
}];
`,
    };

    @node({
        id: 'c1a7f0de-9b3e-4c21-9f77-5a2d61b0e402',
        name: 'Arch Rules Doc Getter',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [672, 592],
        onError: 'continueRegularOutput',
        notes: 'Fetches architecture-rules.md up front so every agent gets the rules without spending LLM tool calls.',
    })
    ArchRulesDocGetter = {
        url: "=https://api.github.com/repos/{{ $('Bootstrapper').first().json.owner }}/{{ $('Bootstrapper').first().json.repo }}/contents/{{ encodeURI($('Resolve Config').first().json.architectural_rules_path) }}?ref={{ $('Bootstrapper').first().json.default_branch || 'main' }}",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.v3.raw',
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
            ],
        },
        options: {
            response: {
                response: {
                    responseFormat: 'text',
                    outputPropertyName: 'data',
                },
            },
        },
    };

    @node({
        id: 'c1a7f0de-9b3e-4c21-9f77-5a2d61b0e403',
        name: 'Tech Stack Doc Getter',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [672, 736],
        onError: 'continueRegularOutput',
        notes: 'Fetches tech-stack.md up front so every agent gets stack context without spending LLM tool calls.',
    })
    TechStackDocGetter = {
        url: "=https://api.github.com/repos/{{ $('Bootstrapper').first().json.owner }}/{{ $('Bootstrapper').first().json.repo }}/contents/{{ encodeURI($('Resolve Config').first().json.tech_stack_path) }}?ref={{ $('Bootstrapper').first().json.default_branch || 'main' }}",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.v3.raw',
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
            ],
        },
        options: {
            response: {
                response: {
                    responseFormat: 'text',
                    outputPropertyName: 'data',
                },
            },
        },
    };

    @node({
        id: '7a1e9c3d-2b6f-4a58-9d34-1f6c8b2e5a90',
        name: 'Credentials Getter',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [208, 304],
        notes: "Fetches the registered GitHub username + PAT for this repo from the Portal backend (repo must be registered there first). Sends the shared secret as X-Internal-Token via the httpHeaderAuth credential, which must match the backend's N8N_INTERNAL_TOKEN.",
    })
    CredentialsGetter = {
        url: '=http://192.168.1.104:1806/api/repositories/credentials?full_name={{ encodeURIComponent($json.owner + "/" + $json.repo) }}',
        authentication: 'none',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'X-Internal-Token',
                    value: 'QhxKvWkku+5dPa4KeuzSQGb40YYDgLQsbQmOSupMR8Y=',
                },
            ],
        },
        options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 1,
        },
    };

    @node({
        id: 'ea098e80-04ec-495b-a888-2b874583a3d1',
        name: 'Merge Context',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [672, 304],
        notes: 'Collects outputs from all 4 parallel data extractors (intent, rules, diff, credentials) and merges them into a single context payload.',
    })
    MergeContext = {
        jsCode: `
// The getters run in a sequential chain, so each one is read by node name here.
// Fanning them out in parallel made n8n run this node once per branch with partial data.
function readNode(name) {
  try {
    return $(name).first().json;
  } catch (e) {
    return null;
  }
}

const baseCtx = readNode('Bootstrapper') || {};
const credsData = readNode('Credentials Getter');
const intentData = readNode('Intent Getter');
const diffRaw = readNode('Diff Getter');
const resolved = readNode('Resolve Config') || {};
const archRulesRaw = readNode('Arch Rules Doc Getter');
const techStackRaw = readNode('Tech Stack Doc Getter');

function asText(payload) {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload.data === 'string') return payload.data;
  if (typeof payload.body === 'string') return payload.body;
  return '';
}

const diffText = asText(diffRaw);

// A 404 body is still text, so anything that does not look like the document is discarded.
function asDoc(payload, label) {
  const text = asText(payload).trim();
  if (!text || text.startsWith('{"message"') || text.indexOf('"documentation_url"') !== -1) {
    return '(' + label + ' could not be loaded from the repository. Apply general best practices.)';
  }
  return text.slice(0, 20000);
}

const architecture_rules = asDoc(archRulesRaw, 'architecture-rules.md');
const tech_stack = asDoc(techStackRaw, 'tech-stack.md');

const config = {
  architecture_enabled: resolved.architecture_enabled !== false,
  regression_enabled: resolved.regression_enabled !== false,
  quality_enabled: resolved.quality_enabled !== false,
  alignment_enabled: resolved.alignment_enabled !== false,
  architectural_rules_path: resolved.architectural_rules_path || 'PR Reviewer/architecture-rules.md',
  tech_stack_path: resolved.tech_stack_path || 'PR Reviewer/tech-stack.md',
};

// Per-repo GitHub auth sourced from the Portal backend, used for all read calls.
const github_auth_header = credsData && credsData.github_pat ? ('Bearer ' + credsData.github_pat) : '';

// Reviews are posted by a dedicated account so GitHub never rejects them as a self-review.
const REVIEWER_USERNAME = 'samriddhi-018';
const pr_author = intentData && intentData.user ? (intentData.user.login || '') : '';

if (!diffText) {
  throw new Error('Diff Getter returned no diff for PR #' + (baseCtx.pr_number || '?') + '. Review agents cannot run without a diff.');
}

return [{
  json: {
    owner: baseCtx.owner || '',
    repo: baseCtx.repo || '',
    pr_number: baseCtx.pr_number || 0,
    pr_title: baseCtx.pr_title || (intentData ? intentData.title : ''),
    pr_body: intentData ? (intentData.body || '') : (baseCtx.pr_body || ''),
    head_sha: baseCtx.head_sha || '',
    base_sha: baseCtx.base_sha || '',
    head_branch: baseCtx.head_branch || '',
    base_branch: baseCtx.base_branch || '',
    default_branch: baseCtx.default_branch || 'main',
    html_url: baseCtx.html_url || '',
    diff: diffText,
    config,
    architecture_rules,
    tech_stack,
    github_auth_header,
    pr_author,
    reviewer_username: REVIEWER_USERNAME,
    index_url: 'https://api.github.com/repos/' + baseCtx.owner + '/' + baseCtx.repo + '/contents/PR%20Reviewer/index.json?ref=' + (baseCtx.default_branch || 'main'),
    files_base_url: 'https://api.github.com/repos/' + baseCtx.owner + '/' + baseCtx.repo + '/contents',
  }
}];
`,
    };

    @node({
        id: 'if-arch-1234',
        name: 'If Architecture',
        type: 'n8n-nodes-base.if',
        version: 1,
        position: [900, -736],
        notes: 'Checks if Architecture agent is enabled.',
    })
    IfArchitecture = {
        conditions: {
            options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 1,
            },
            boolean: [
                {
                    value1: '={{ $json.config.architecture_enabled }}',
                    value2: true,
                },
            ],
        },
    };

    @node({
        id: 'if-reg-1234',
        name: 'If Regression',
        type: 'n8n-nodes-base.if',
        version: 1,
        position: [900, -272],
        notes: 'Checks if Regression agent is enabled.',
    })
    IfRegression = {
        conditions: {
            options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 1,
            },
            boolean: [
                {
                    value1: '={{ $json.config.regression_enabled }}',
                    value2: true,
                },
            ],
        },
    };

    @node({
        id: 'if-qual-1234',
        name: 'If Code Quality',
        type: 'n8n-nodes-base.if',
        version: 1,
        position: [900, 144],
        notes: 'Checks if Code Quality agent is enabled.',
    })
    IfCodeQuality = {
        conditions: {
            options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 1,
            },
            boolean: [
                {
                    value1: '={{ $json.config.quality_enabled }}',
                    value2: true,
                },
            ],
        },
    };

    @node({
        id: 'if-align-1234',
        name: 'If Alignment',
        type: 'n8n-nodes-base.if',
        version: 1,
        position: [900, 640],
        notes: 'Checks if Alignment agent is enabled.',
    })
    IfAlignment = {
        conditions: {
            options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 1,
            },
            boolean: [
                {
                    value1: '={{ $json.config.alignment_enabled }}',
                    value2: true,
                },
            ],
        },
    };

    @node({
        id: '5956a8ba-5e77-4214-b91c-3db0bdd3f2af',
        name: 'Architecture Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [1168, -736],
        notes: 'Reviews the diff against structural/architectural rules using Gemini Pro. Has Index Searcher and Context Provider tools.',
    })
    ArchitectureAgent = {
        promptType: 'define',
        text: `=You are a senior software architect performing a code review.

## Your Mission
Review the Pull Request diff STRICTLY against the architectural rules provided. Catch ONLY architectural violations — not general code style or nitpicks.

## Repository Context
- Repo: {{ $json.owner }}/{{ $json.repo }}
- PR #{{ $json.pr_number }}: {{ $json.pr_title }}
- Branch: {{ $json.head_branch }} to {{ $json.base_branch }}

## Architectural Rules (AUTHORITATIVE — already loaded for you)
{{ $json.architecture_rules }}

## Tech Stack
{{ $json.tech_stack }}

## Tools (optional)
The rules above are already provided, so do NOT use tools to fetch them. Only use tools if you must inspect an existing file that is not in the diff.
- Index Searcher: query the repository file tree (index.json)
- Context Provider: read a specific file from the repo by path

## The Diff
{{ $json.diff }}

## Instructions
Walk through the rules section by section and check the diff against each one. Report EVERY distinct violation you find — do not stop at the first one and do not summarise. Cite the rule you are enforcing in the body.
For "line", use a line number that appears on the RIGHT side of the diff for that file.

## Output Format
Return a raw JSON array with no markdown fences. Each item MUST have: path (string), line (number), severity ("blocker"|"warning"|"suggestion"), category ("architecture"), body (string, max 500 chars).
Return [] ONLY if the diff genuinely violates none of the rules.`,
        needsFallback: true,
        options: {
            maxIterations: 4,
            returnIntermediateSteps: false,
        },
    };

    @node({
        id: '32c14885-4478-42bf-b0f7-58161636ee2e',
        name: 'Arch Index Searcher',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1296, -448],
    })
    ArchIndexSearcher = {
        toolDescription:
            'Search the repository file index (index.json). Returns the directory tree. Use to find relevant files in the diff.',
        url: '={{ $json.index_url }}',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.raw+json',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
            ],
        },
        options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 1,
        },
    };

    @node({
        id: '626f0921-cd2f-48be-bf54-56d8bde898f7',
        name: 'Arch Context Provider',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1424, -448],
    })
    ArchContextProvider = {
        toolDescription:
            'Read the full contents of a specific file from the repository. Provide the exact file path as it appears in the index.',
        url: "={{ $json.files_base_url }}/{{ encodeURI($fromAI('filePath', 'Exact repository file path, for example src/store/savingsGoalStore.ts', 'string')) }}?ref={{ $json.head_sha }}",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.raw',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
            ],
        },
        options: {
            ignoreResponseCode: true,
        },
    };

    @node({
        id: 'fa9236dc-5f25-40a7-b503-2dbc3b40433c',
        name: 'Arch Gemini Pro',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [1136, -544],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Gemini 2.5 Pro — high-reasoning model for architecture enforcement.',
    })
    ArchGeminiPro = {
        modelName: 'models/gemini-3.5-flash',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: 'f8a11b61-2a4c-4e89-b5f7-9c8a9a2345b1',
        name: 'Arch Gemini Fallback',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [1232, -544],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Fallback model to handle 503 capacity errors.',
    })
    ArchGeminiFallback = {
        modelName: 'models/gemini-3.5-flash-lite',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: '6404726e-fee7-4c53-8ead-a671e81bc2a5',
        name: 'Regression Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [1184, -272],
        notes: 'Detects breaking changes and downstream impact using Gemini Flash.',
    })
    RegressionAgent = {
        promptType: 'define',
        text: `=You are a senior QA engineer specializing in regression and breaking-change detection.

## Your Mission
Analyze the PR diff for changes that could BREAK existing functionality:
- Changed function/method signatures or return types
- Removed or renamed exports, props, or interfaces
- Breaking API contract changes
- Database schema changes
- Production-impacting configuration changes

## Repository Context
- Repo: {{ $json.owner }}/{{ $json.repo }}
- PR #{{ $json.pr_number }}: {{ $json.pr_title }}

## Architectural Rules (AUTHORITATIVE — already loaded for you)
{{ $json.architecture_rules }}

## Tech Stack
{{ $json.tech_stack }}

## Tools (optional)
The rules above are already provided, so do NOT use tools to fetch them. Only use tools if you must inspect a downstream consumer file.
- Reg Index Searcher: find files that may depend on changed modules
- Reg Context Provider: read those files to verify breakage

## The Diff
{{ $json.diff }}

## Output Format
Return a raw JSON array with no markdown fences. Each item MUST have: path (string), line (number), severity ("blocker"|"warning"|"suggestion"), category ("regression"), body (string, max 500 chars).
For "line", use a line number that appears on the RIGHT side of the diff for that file.
Return [] if no regression risks.`,
        needsFallback: true,
        options: {
            maxIterations: 3,
        },
    };

    @node({
        id: 'e6f9eeee-5735-465e-9328-550d83b3f8ac',
        name: 'Reg Index Searcher',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1328, -32],
    })
    RegIndexSearcher = {
        toolDescription: 'Search the repository file index to find files that may import or depend on changed modules.',
        url: '={{ $json.index_url }}',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.raw+json',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
            ],
        },
        options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 1,
        },
    };

    @node({
        id: '2cfffab8-c195-4a55-a48b-4a9bf7a91c2d',
        name: 'Reg Context Provider',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1456, -32],
    })
    RegContextProvider = {
        toolDescription: 'Read the full contents of a downstream consumer file to verify if a change breaks it.',
        url: "={{ $json.files_base_url }}/{{ encodeURI($fromAI('filePath', 'Exact repository file path, for example src/store/savingsGoalStore.ts', 'string')) }}?ref={{ $json.head_sha }}",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.raw',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
            ],
        },
        options: {
            ignoreResponseCode: true,
        },
    };

    @node({
        id: '1d473618-d536-4a14-9e38-50347233da6b',
        name: 'Flash Model Regression',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [1136, -96],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Gemini 2.5 Flash — fast model for regression scanning.',
    })
    FlashModelRegression = {
        modelName: 'models/gemini-3.5-flash',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: 'f8a11b61-2a4c-4e89-b5f7-9c8a9a2345b2',
        name: 'Reg Gemini Fallback',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [1232, 0],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Fallback model to handle 503 capacity errors.',
    })
    RegGeminiFallback = {
        modelName: 'models/gemini-3.5-flash-lite',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: '436f57db-41a5-4151-b3c0-cb60f9568d1d',
        name: 'Code Quality Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [1168, 144],
        notes: 'Identifies performance anti-patterns and security issues using Gemini Flash.',
    })
    CodeQualityAgent = {
        promptType: 'define',
        text: `=You are an expert code reviewer focused on code quality, performance, and maintainability.

## Your Mission
Review the PR diff for SIGNIFICANT problems only:
- Performance anti-patterns (N+1 queries, unnecessary re-renders, memory leaks)
- Security vulnerabilities (XSS, injection, unvalidated inputs, exposed secrets)
- Error handling gaps (unhandled promises, missing null checks causing crashes)
- Dead code or clearly incorrect logic

DO NOT flag: style preferences, minor naming, or linter-fixable issues.

## Repository Context
- Repo: {{ $json.owner }}/{{ $json.repo }}
- PR #{{ $json.pr_number }}: {{ $json.pr_title }}

## Architectural Rules (AUTHORITATIVE — already loaded for you)
{{ $json.architecture_rules }}

## Tech Stack
{{ $json.tech_stack }}

## The Diff
{{ $json.diff }}

## Instructions
Report EVERY distinct problem you find. Pay particular attention to direct state mutation, "any" usage, swallowed errors, missing accessibility attributes, and persistence calls made outside the service layer.

## Output Format
Return a raw JSON array with no markdown fences. Each item MUST have: path (string), line (number), severity ("blocker"|"warning"|"suggestion"), category ("code-quality"), body (string, max 500 chars).
For "line", use a line number that appears on the RIGHT side of the diff for that file.
Return [] if code is clean.`,
        needsFallback: true,
        options: {
            maxIterations: 3,
        },
    };

    @node({
        id: 'bb9e47a7-0b5a-4f4d-b01c-244dc496a14e',
        name: 'Qual Index Searcher',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1248, 368],
    })
    QualIndexSearcher = {
        toolDescription: 'Search the repository file index for broader code structure context during quality analysis.',
        url: '={{ $json.index_url }}',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.raw+json',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
            ],
        },
        options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 1,
        },
    };

    @node({
        id: 'dc2b57b3-2a9f-426d-b837-8c7d3cec704b',
        name: 'Qual Context Provider',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1376, 368],
    })
    QualContextProvider = {
        toolDescription: 'Read the full contents of a file for code quality context. Provide the exact file path.',
        url: "={{ $json.files_base_url }}/{{ encodeURI($fromAI('filePath', 'Exact repository file path, for example src/store/savingsGoalStore.ts', 'string')) }}?ref={{ $json.head_sha }}",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.raw',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
            ],
        },
        options: {
            ignoreResponseCode: true,
        },
    };

    @node({
        id: '0cf57727-4eb9-4cb1-b496-256fc7a59fe0',
        name: 'Flash Model Quality',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [1088, 368],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Gemini 2.5 Flash — fast model for code quality analysis.',
    })
    FlashModelQuality = {
        modelName: 'models/gemini-3.5-flash',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: 'f8a11b61-2a4c-4e89-b5f7-9c8a9a2345b3',
        name: 'Qual Gemini Fallback',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [1088, 576],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Fallback model to handle 503 capacity errors.',
    })
    QualGeminiFallback = {
        modelName: 'models/gemini-3.5-flash-lite',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: '6ad92ebe-19ee-46da-8d48-7292830224b1',
        name: 'Alignment Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [1136, 640],
        notes: 'Compares written code against original PR intent to detect scope creep.',
    })
    AlignmentAgent = {
        promptType: 'define',
        text: `=You are a technical product manager reviewing code changes for alignment with stated intent.

## Your Mission
Compare what was WRITTEN (the diff) against what was INTENDED (the PR description). Flag:
- Scope creep: changes beyond what was described
- Missing implementation: PR says X was done but it is absent
- Unclear intent: significant undocumented changes

DO NOT flag cosmetic differences.

## Repository Context
- Repo: {{ $json.owner }}/{{ $json.repo }}
- PR #{{ $json.pr_number }}: {{ $json.pr_title }}

## Architectural Rules (AUTHORITATIVE — already loaded for you)
{{ $json.architecture_rules }}

## Tech Stack
{{ $json.tech_stack }}

## PR Description
{{ $json.pr_body }}

## The Diff
{{ $json.diff }}

## Output Format
Return a raw JSON array with no markdown fences. Each item MUST have: path (string), line (number, use a line present on the RIGHT side of the diff), severity ("blocker"|"warning"|"suggestion"), category ("alignment"), body (string, max 500 chars).
Return [] if well-aligned.`,
        needsFallback: true,
        options: {
            maxIterations: 3,
        },
    };

    @node({
        id: 'a5ea0857-33f6-491c-9a5b-a12f588a3eb8',
        name: 'Align Index Searcher',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1280, 928],
    })
    AlignIndexSearcher = {
        toolDescription: 'Search the repository file index to understand project structure when checking alignment.',
        url: '={{ $json.index_url }}',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.raw+json',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
            ],
        },
        options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 1,
        },
    };

    @node({
        id: '0d3a3c20-6ccf-4b29-91b2-8f83a98f638d',
        name: 'Align Context Provider',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1408, 928],
    })
    AlignContextProvider = {
        toolDescription: 'Read the full content of a file to help verify alignment between intent and implementation.',
        url: "={{ $json.files_base_url }}/{{ encodeURI($fromAI('filePath', 'Exact repository file path, for example src/pages/SavingsGoalsPage.tsx', 'string')) }}?ref={{ $json.head_sha }}",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.raw',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $('Credentials Getter').first().json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
            ],
        },
        options: {
            ignoreResponseCode: true,
        },
    };

    @node({
        id: 'e30d505b-d2f5-452b-aa04-f8e84d7747a5',
        name: 'Flash Model Alignment',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [1120, 912],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Gemini 2.5 Flash — fast model for alignment checking.',
    })
    FlashModelAlignment = {
        modelName: 'models/gemini-3.5-flash',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: 'f8a11b61-2a4c-4e89-b5f7-9c8a9a2345b4',
        name: 'Align Gemini Fallback',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [992, 1248],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Fallback model to handle 503 capacity errors.',
    })
    AlignGeminiFallback = {
        modelName: 'models/gemini-3.5-flash-lite',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: 'c1a7f0de-9b3e-4c21-9f77-5a2d61b0e404',
        name: 'Collect Agent Outputs',
        type: 'n8n-nodes-base.merge',
        version: 3.2,
        position: [1900, -288],
        notes: 'Waits for all four agent branches. Without this the downstream chain ran once per branch and posted four separate reviews.',
    })
    CollectAgentOutputs = {
        mode: 'append',
        numberInputs: 4,
    };

    @node({
        id: '92f65f49-fd21-4ce8-b395-538475f9095b',
        name: 'Merge Agent Results',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [2128, -288],
        notes: 'Collects proposed comments from all 4 parallel agent branches into a single unified array.',
    })
    MergeAgentResults = {
        jsCode: `
const allComments = [];

// Agent nodes only output { output: "..." }, dropping the original context fields,
// so the PR/repo context is read from Merge Context by name instead of guessed from inputs.
const contextRef = $('Merge Context').first().json;

for (const item of $input.all()) {
  const d = item.json;

  let payload = d.output !== undefined ? d.output : d.text;

  if (Array.isArray(payload)) {
    allComments.push(...payload);
    continue;
  }

  if (typeof payload !== 'string' || !payload.trim()) continue;

  // Models often wrap the array in a \`\`\`json fence despite being told not to.
  const trimmed = payload.replace(/^s*\`\`\`(?:json)?/i, '').replace(/\`\`\`s*$/, '').trim();
  const startIdx = trimmed.indexOf('[');
  const endIdx = trimmed.lastIndexOf(']');
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) continue;

  try {
    const parsed = JSON.parse(trimmed.substring(startIdx, endIdx + 1));
    if (Array.isArray(parsed)) {
      allComments.push(...parsed.filter((c) => c && typeof c === 'object'));
    }
  } catch (_) {}
}

return [{
  json: {
    owner: contextRef.owner || '',
    repo: contextRef.repo || '',
    pr_number: contextRef.pr_number || 0,
    head_sha: contextRef.head_sha || '',
    diff: contextRef.diff || '',
    proposed_comments: allComments,
    total_proposed: allComments.length,
    github_auth_header: contextRef.github_auth_header || '',
    pr_author: contextRef.pr_author || '',
    reviewer_username: contextRef.reviewer_username || '',
  }
}];
`,
    };

    @node({
        id: 'd38aae1b-796b-4f5f-a3fa-9c6ae1e63750',
        name: 'Master Triage Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [2064, 48],
        notes: 'Deduplicates, merges, and filters all proposed comments. Only high-signal issues survive.',
    })
    MasterTriageAgent = {
        promptType: 'define',
        text: `=You are the Lead Engineering Manager performing final triage on automated PR review comments.

## Your Mission
You received {{ $json.total_proposed }} proposed comments from 4 specialist agents. Produce the final review set.

Rules:
1. MERGE duplicates: if two comments describe the SAME issue at the same place, combine them into one comment and keep the highest severity.
2. DROP only: pure style/formatting nitpicks, linter-fixable trivia, and comments that are vague or state no concrete problem.
3. KEEP every distinct, concrete, actionable finding — especially architecture-rule violations, direct state mutation, \`any\` usage, swallowed errors, persistence calls outside the service layer, accessibility gaps, and missing tests. Multiple different violations in the same file are SEPARATE comments; do not collapse them.
4. Rewrite each surviving comment to be concise, professional, and actionable, naming the rule or risk it addresses.
5. Preserve the original \`path\` and \`line\` values — never invent new ones.

Do NOT return an empty list when concrete findings were proposed. Only return an empty list if every proposal was genuinely noise.

## Proposed Comments
{{ JSON.stringify($json.proposed_comments) }}

## Output Instructions
Return a JSON object with this exact shape:
{
  "comments": [
    { "path": "file/path.ts", "line": 42, "severity": "blocker", "category": "architecture", "body": "Comment text" }
  ],
  "summary": "One paragraph executive summary"
}`,
        hasOutputParser: true,
        needsFallback: true,
        options: {
            maxIterations: 4,
        },
    };

    @node({
        id: '60d732c9-3800-4b98-838c-4db35618583f',
        name: 'Triage Gemini Pro',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [2064, 400],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Gemini 2.5 Pro — high-reasoning model for final triage.',
    })
    TriageGeminiPro = {
        modelName: 'models/gemini-3.5-flash',
        options: {
            temperature: 0,
        },
    };

    @node({
        id: 'f8a11b61-2a4c-4e89-b5f7-9c8a9a2345b5',
        name: 'Triage Gemini Fallback',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [2064, 608],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
        notes: 'Fallback model to handle 503 capacity errors.',
    })
    TriageGeminiFallback = {
        modelName: 'models/gemini-3.5-flash-lite',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: '31b4fd85-5656-4972-88b5-e75b884b1658',
        name: 'Triage Output Parser',
        type: '@n8n/n8n-nodes-langchain.outputParserStructured',
        version: 1.3,
        position: [2208, 400],
        notes: 'Enforces the final review comment JSON schema output from the Triage Agent.',
    })
    TriageOutputParser = {
        jsonSchemaExample:
            '{"comments":[{"path":"src/components/Button.tsx","line":42,"severity":"blocker","category":"architecture","body":"This component breaks the single-responsibility rule. Extract the data-fetching logic into a custom hook."}],"summary":"This PR introduces two architectural blockers and one regression risk. Recommend blocking merge until resolved."}',
    };

    @node({
        id: 'db2ef82d-b3ec-4d07-b202-f67b7185bd72',
        name: 'Format Comments',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [2496, 48],
        notes: 'Transforms triage output into the GitHub Pulls Review API payload.',
    })
    FormatComments = {
        jsCode: `
const item = $input.first().json;

let triageResult;
try {
  const raw = item.output || item.text || '{}';
  triageResult = typeof raw === 'string' ? JSON.parse(raw) : raw;
} catch (e) {
  triageResult = { comments: [], summary: 'Unable to parse triage results.' };
}

function commentableRightLines(diffText) {
    const changed = {};
    let currentFile = null;
    let newLine = 0;

    for (const line of String(diffText || '').split('\\n')) {
        if (line.startsWith('+++ ')) {
            const target = line.slice(4).trim();
            currentFile = target === '/dev/null' ? null : target.replace(/^b\\//, '');
            newLine = 0;
            if (currentFile && !changed[currentFile]) changed[currentFile] = new Set();
            continue;
        }

        const hunk = line.match(/^@@ \\-[0-9]+(?:,[0-9]+)? \\+([0-9]+)(?:,([0-9]+))? @@/);
        if (hunk) {
            newLine = Number(hunk[1]);
            continue;
        }

        if (!currentFile || !newLine) continue;

        // GitHub accepts review comments on any line present in the hunk's RIGHT side,
        // which includes unchanged context lines, not just added ones.
        if (line.startsWith('+')) {
            changed[currentFile].add(newLine);
            newLine += 1;
        } else if (line.startsWith('-')) {
            continue;
        } else if (line.startsWith(' ') || line === '') {
            changed[currentFile].add(newLine);
            newLine += 1;
        }
    }

    return changed;
}

function normalizePath(p) {
    return String(p || '').trim().replace(/^\\.\\//, '').replace(/^[ab]\\//, '');
}

const commentableLines = commentableRightLines($('Merge Agent Results').first().json.diff);
const diffPaths = Object.keys(commentableLines);
const unlocatedFindings = [];
const comments = [];
const seen = new Set();

for (const c of (triageResult.comments || [])) {
    let path = normalizePath(c.path);
    if (path && !commentableLines[path]) {
        // Agents sometimes report a suffix or a slightly different prefix of the real path.
        path = diffPaths.find((p) => p === path || p.endsWith('/' + path) || path.endsWith('/' + p)) || '';
    }

    const severity = String(c.severity || 'warning').toLowerCase();
    const category = String(c.category || 'general').toLowerCase();
    const text = String(c.body || '').slice(0, 1500);
    const body = '[' + severity.toUpperCase() + '] [' + category.toUpperCase() + ']\\n\\n' + text + '\\n\\n_Generated by CodeGuards AI Review_';

    let line = Number(c.line);
    if (path && commentableLines[path] && commentableLines[path].size) {
        const valid = commentableLines[path];
        if (!Number.isInteger(line) || !valid.has(line)) {
            // Snap to the closest commentable line so the finding still lands inline.
            const candidates = Array.from(valid);
            const target = Number.isInteger(line) ? line : candidates[0];
            line = candidates.reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) ? n : best), candidates[0]);
        }

        const key = path + ':' + line;
        if (!seen.has(key)) {
            seen.add(key);
            comments.push({ path, line, side: 'RIGHT', body });
        }
        continue;
    }

    unlocatedFindings.push('- **[' + severity.toUpperCase() + ']** ' + (normalizePath(c.path) || 'repository') + (Number.isInteger(Number(c.line)) ? ':' + Number(c.line) : '') + ' — ' + text);
}

const severityCounts = (triageResult.comments || []).reduce((acc, c) => {
  acc[c.severity] = (acc[c.severity] || 0) + 1;
  return acc;
}, {});

const bodyLines = ['## 🤖 CodeGuards AI Review\\n'];
if (severityCounts.blocker) bodyLines.push('🔴 **' + severityCounts.blocker + ' Blocker(s)**');
if (severityCounts.warning) bodyLines.push('🟡 **' + severityCounts.warning + ' Warning(s)**');
if (severityCounts.suggestion) bodyLines.push('🔵 **' + severityCounts.suggestion + ' Suggestion(s)**');
bodyLines.push('');
if (triageResult.summary) bodyLines.push(triageResult.summary);
if (unlocatedFindings.length) {
    bodyLines.push('');
    bodyLines.push('### Findings without an exact changed-line location');
    bodyLines.push(...unlocatedFindings);
}
if (comments.length === 0 && unlocatedFindings.length === 0) bodyLines.push('✅ No significant issues found. This PR looks good!');

const mergeNode = $('Merge Agent Results').first().json;

// GitHub rejects APPROVE/REQUEST_CHANGES with 422 when the token owner authored the PR.
const isSelfReview = !!mergeNode.pr_author && mergeNode.pr_author === mergeNode.reviewer_username;

let event = severityCounts.blocker > 0 ? 'REQUEST_CHANGES' :
            (severityCounts.warning > 0 ? 'COMMENT' : 'APPROVE');
if (isSelfReview) {
  event = 'COMMENT';
}

return [{
  json: {
    owner: mergeNode.owner,
    repo: mergeNode.repo,
    pr_number: mergeNode.pr_number,
    head_sha: mergeNode.head_sha,
    github_auth_header: mergeNode.github_auth_header || '',
    github_review_payload: {
      commit_id: mergeNode.head_sha,
      body: bodyLines.join('\\n'),
      event,
      comments,
    },
  }
}];
`,
    };

    @node({
        id: 'e1e2766f-3be6-4442-828f-ac6b4256edca',
        name: 'GitHub Comment Writer',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [2800, 48],
        credentials: { httpHeaderAuth: { id: '3IfYULM0qroYk6Hv', name: 'CodeGuards PR Reviewer (samriddhi-018)' } },
        notes: 'Posts the final review to the GitHub Pull Request via the Pulls Review API. Authenticates as the dedicated reviewer account (samriddhi-018) so GitHub never rejects the review as a self-review.',
    })
    GithubCommentWriter = {
        method: 'POST',
        url: '=https://api.github.com/repos/{{ $json.owner }}/{{ $json.repo }}/pulls/{{ $json.pr_number }}/reviews',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.v3+json',
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-PRReviewer/1.0',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.github_review_payload) }}',
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.GithubPrWebhook.out(0).to(this.Bootstrapper.in(0));
        this.Bootstrapper.out(0).to(this.CredentialsGetter.in(0));
        this.CredentialsGetter.out(0).to(this.IntentGetter.in(0));
        this.IntentGetter.out(0).to(this.RulesGetter.in(0));
        this.RulesGetter.out(0).to(this.ResolveConfig.in(0));
        this.ResolveConfig.out(0).to(this.DiffGetter.in(0));
        this.DiffGetter.out(0).to(this.ArchRulesDocGetter.in(0));
        this.ArchRulesDocGetter.out(0).to(this.TechStackDocGetter.in(0));
        this.TechStackDocGetter.out(0).to(this.MergeContext.in(0));
        this.MergeContext.out(0).to(this.IfArchitecture.in(0));
        this.MergeContext.out(0).to(this.IfRegression.in(0));
        this.MergeContext.out(0).to(this.IfCodeQuality.in(0));
        this.MergeContext.out(0).to(this.IfAlignment.in(0));
        this.IfArchitecture.out(0).to(this.ArchitectureAgent.in(0));
        this.IfArchitecture.out(1).to(this.CollectAgentOutputs.in(0));
        this.IfRegression.out(0).to(this.RegressionAgent.in(0));
        this.IfRegression.out(1).to(this.CollectAgentOutputs.in(1));
        this.IfCodeQuality.out(0).to(this.CodeQualityAgent.in(0));
        this.IfCodeQuality.out(1).to(this.CollectAgentOutputs.in(2));
        this.IfAlignment.out(0).to(this.AlignmentAgent.in(0));
        this.IfAlignment.out(1).to(this.CollectAgentOutputs.in(3));
        this.ArchitectureAgent.out(0).to(this.CollectAgentOutputs.in(0));
        this.RegressionAgent.out(0).to(this.CollectAgentOutputs.in(1));
        this.CodeQualityAgent.out(0).to(this.CollectAgentOutputs.in(2));
        this.AlignmentAgent.out(0).to(this.CollectAgentOutputs.in(3));
        this.CollectAgentOutputs.out(0).to(this.MergeAgentResults.in(0));
        this.MergeAgentResults.out(0).to(this.MasterTriageAgent.in(0));
        this.MasterTriageAgent.out(0).to(this.FormatComments.in(0));
        this.FormatComments.out(0).to(this.GithubCommentWriter.in(0));

        this.ArchitectureAgent.uses({
            ai_languageModel: [this.ArchGeminiPro.output, this.ArchGeminiFallback.output],
            ai_tool: [this.ArchIndexSearcher.output, this.ArchContextProvider.output],
        });
        this.RegressionAgent.uses({
            ai_languageModel: [this.FlashModelRegression.output, this.RegGeminiFallback.output],
            ai_tool: [this.RegIndexSearcher.output, this.RegContextProvider.output],
        });
        this.CodeQualityAgent.uses({
            ai_languageModel: [this.FlashModelQuality.output, this.QualGeminiFallback.output],
            ai_tool: [this.QualIndexSearcher.output, this.QualContextProvider.output],
        });
        this.AlignmentAgent.uses({
            ai_languageModel: [this.FlashModelAlignment.output, this.AlignGeminiFallback.output],
            ai_tool: [this.AlignIndexSearcher.output, this.AlignContextProvider.output],
        });
        this.MasterTriageAgent.uses({
            ai_languageModel: [this.TriageGeminiPro.output, this.TriageGeminiFallback.output],
            ai_outputParser: this.TriageOutputParser.output,
        });
    }
}
