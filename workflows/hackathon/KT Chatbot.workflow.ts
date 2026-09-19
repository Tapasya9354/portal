import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : KT Chatbot
// Nodes   : 13  |  Connections: 5
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Webhook                            webhook
// ContextBuilder                     code
// ConfigGetter                       httpRequest                [onError→regular]
// MergeConfig                        code
// AiAgent                            agent                      [AI]
// GoogleGeminiChatModel              lmChatGoogleGemini         [creds] [ai_languageModel]
// SimpleMemory                       memoryBufferWindow         [ai_memory]
// GithubFileReader                   httpRequestTool            [ai_tool]
// IndexSearcher                      httpRequestTool            [ai_tool]
// CodeSearcher                       httpRequestTool            [ai_tool]
// PrFetcher                          httpRequestTool            [ai_tool]
// Callbackrequest                    httpRequest
// GoogleGeminiChatModel1             lmChatGoogleGemini         [creds] [ai_languageModel]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// Webhook
//    → ContextBuilder
//      → ConfigGetter
//        → MergeConfig
//          → AiAgent
//            → Callbackrequest
//
// AI CONNECTIONS
// AiAgent.uses({ ai_languageModel: [GoogleGeminiChatModel, GoogleGeminiChatModel1], ai_memory: SimpleMemory, ai_tool: [GithubFileReader, IndexSearcher, CodeSearcher, PrFetcher] })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'FTS8zaDYlURVtvoa',
    name: 'KT Chatbot',
    active: true,
    isArchived: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate' },
})
export class KtChatbotWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: '5ece422f-7ded-4857-b786-2d6af724cd90',
        webhookId: 'c9ff4faa-0962-4405-bfb6-cfd482a45e4d',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2.1,
        position: [0, 304],
    })
    Webhook = {
        httpMethod: 'POST',
        path: 'kt-chatbot',
        options: {},
    };

    @node({
        id: 'context-builder-1234',
        name: 'Context Builder',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [208, 304],
    })
    ContextBuilder = {
        jsCode: `
const body = $input.first().json.body || {};
const repoUrl = body.repoUrl || '';
let owner = '';
let repo = '';
if (repoUrl.includes('github.com/')) {
    const parts = repoUrl.split('github.com/')[1].split('/');
    owner = parts[0] || '';
    repo = parts[1] || '';
}
return [{
    json: {
        body,
        owner,
        repo,
        full_name: owner + '/' + repo,
    }
}];
`,
    };

    @node({
        id: 'config-getter-1234',
        name: 'Config Getter',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [608, 304],
        onError: 'continueRegularOutput',
        notes: 'Fetches config.json from repo',
    })
    ConfigGetter = {
        url: '=https://api.github.com/repos/{{ $("Context Builder").first().json.owner }}/{{ $("Context Builder").first().json.repo }}/contents/PR%20Reviewer/config.json',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.v3.raw',
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-KTChatbot/1.0',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $json.body.pat }}",
                },
            ],
        },
        options: {},
    };

    @node({
        id: 'merge-config-1234',
        name: 'Merge Config',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [800, 304],
    })
    MergeConfig = {
        jsCode: `
const ctx = $('Context Builder').first().json;
let configData = $input.first().json || {};

if (typeof configData === 'string' && configData.trim().startsWith('{')) {
    try { configData = JSON.parse(configData); } catch (e) {}
} else if (configData.data && typeof configData.data === 'string' && configData.data.trim().startsWith('{')) {
    try { configData = JSON.parse(configData.data); } catch (e) {}
}

const rules = configData.rules || {};
const architectural_rules_path = rules.architectural_rules_path || 'PR Reviewer/architecture-rules.md';
const tech_stack_path = rules.tech_stack_path || 'PR Reviewer/tech-stack.md';

return [{
    json: {
        body: ctx.body,
        owner: ctx.owner,
        repo: ctx.repo,
        github_pat: ctx.body.pat || '',
        architectural_rules_path,
        tech_stack_path,
        index_url: 'https://api.github.com/repos/' + ctx.owner + '/' + ctx.repo + '/contents/PR%20Reviewer/index.json',
        files_base_url: 'https://api.github.com/repos/' + ctx.owner + '/' + ctx.repo + '/contents',
    }
}];
`,
    };

    @node({
        id: '073b533b-1711-4ae3-a73d-47490cb8e5fc',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [1008, 304],
    })
    AiAgent = {
        promptType: 'define',
        text: `={{ "You are an expert Knowledge Transfer (KT) mentor and architecture guide for the codebase at " + $json.owner + "/" + $json.repo + ".

User question:
" + $json.body.query + "

## Guidelines & Rules:
- Architectural rules path: " + $json.architectural_rules_path + "
- Tech stack path: " + $json.tech_stack_path + "
- Index tree URL: " + $json.index_url + "

## Tool Usage Instructions:
1. Always start by using the Index Searcher to fetch the repository tree and understand the project structure.
2. Use the GitHub File Reader to fetch the architectural rules and tech stack guidelines using the paths provided above.
3. Use Code Searcher if you need to find specific functions, classes, or usages across the codebase.
4. Use PR Fetcher if the user asks about a specific pull request.
5. Fetch and inspect any relevant code files using the File Reader to provide deep, accurate answers.
6. Provide clear, structured explanations with code snippets and Mermaid architecture diagrams where helpful." }}`,
        needsFallback: true,
        options: {},
    };

    @node({
        id: 'cdce1613-845b-4e69-924b-67339b57c100',
        name: 'Google Gemini Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [592, 528],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
    })
    GoogleGeminiChatModel = {
        modelName: 'models/gemini-3.7-flash',
        options: {
            temperature: 0.1,
        },
    };

    @node({
        id: 'b91fd462-6324-4984-8f55-442cae34ae14',
        name: 'Simple Memory',
        type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
        version: 1.4,
        position: [928, 528],
    })
    SimpleMemory = {
        sessionIdType: 'customKey',
        sessionKey: '={{ $("Merge Config").item.json.body.sessionId }}',
        contextWindowLength: 10,
    };

    @node({
        id: 'f13ff6cd-3168-4739-a97f-942248bac822',
        name: 'GitHub File Reader',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1072, 528],
    })
    GithubFileReader = {
        toolDescription:
            'Read the full contents of a file from the repository. Provide the exact file path (e.g. src/main.js).',
        url: '={{ $("Merge Config").item.json.files_base_url }}/{filePath}',
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
                    value: "={{ 'Bearer ' + $json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-KTChatbot/1.0',
                },
            ],
        },
        options: {},
    };

    @node({
        id: 'tool-index-searcher-1234',
        name: 'Index Searcher',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1216, 528],
    })
    IndexSearcher = {
        toolDescription: 'Fetch the repository file index tree (index.json) to understand the project structure.',
        url: '={{ $("Merge Config").item.json.index_url }}',
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
                    value: "={{ 'Bearer ' + $json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-KTChatbot/1.0',
                },
            ],
        },
        options: {},
    };

    @node({
        id: 'tool-code-searcher-1234',
        name: 'Code Searcher',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1344, 528],
    })
    CodeSearcher = {
        toolDescription:
            'Search for code, functions, or keywords across the repository. Provide a precise search query string.',
        url: '=https://api.github.com/search/code?q={query}+repo:{{ $("Merge Config").item.json.owner }}/{{ $("Merge Config").item.json.repo }}',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.v3+json',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-KTChatbot/1.0',
                },
            ],
        },
        options: {},
    };

    @node({
        id: 'tool-pr-fetcher-1234',
        name: 'PR Fetcher',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [1456, 528],
    })
    PrFetcher = {
        toolDescription: 'Fetch details about a specific Pull Request. Provide the PR number.',
        url: '=https://api.github.com/repos/{{ $("Merge Config").item.json.owner }}/{{ $("Merge Config").item.json.repo }}/pulls/{prNumber}',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Accept',
                    value: 'application/vnd.github.v3+json',
                },
                {
                    name: 'X-GitHub-Api-Version',
                    value: '2022-11-28',
                },
                {
                    name: 'Authorization',
                    value: "={{ 'Bearer ' + $json.github_pat }}",
                },
                {
                    name: 'User-Agent',
                    value: 'CodeGuards-KTChatbot/1.0',
                },
            ],
        },
        options: {},
    };

    @node({
        id: 'a6d47140-c605-489f-8aaa-48d497f0c22c',
        name: 'Callbackrequest',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [1360, 304],
    })
    Callbackrequest = {
        method: 'POST',
        url: '={{ $("Merge Config").item.json.body.callbackUrl }}',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: {
            sessionId: '={{ $("Merge Config").item.json.body.sessionId }}',
            response: '={{ $json.output }}',
            status: 'completed',
        },
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'X-Internal-Token',
                    value: 'QhxKvWkku+5dPa4KeuzSQGb40YYDgLQsbQmOSupMR8Y=',
                },
            ],
        },
        options: {},
    };

    @node({
        id: '28a821f2-182f-4b2a-8960-2bd7a53e2b60',
        name: 'Google Gemini Chat Model1',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [768, 528],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
    })
    GoogleGeminiChatModel1 = {
        modelName: 'models/gemini-3.6-flash',
        options: {
            temperature: 0.2,
        },
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.Webhook.out(0).to(this.ContextBuilder.in(0));
        this.ContextBuilder.out(0).to(this.ConfigGetter.in(0));
        this.ConfigGetter.out(0).to(this.MergeConfig.in(0));
        this.MergeConfig.out(0).to(this.AiAgent.in(0));
        this.AiAgent.out(0).to(this.Callbackrequest.in(0));

        this.AiAgent.uses({
            ai_languageModel: [this.GoogleGeminiChatModel.output, this.GoogleGeminiChatModel1.output],
            ai_memory: this.SimpleMemory.output,
            ai_tool: [
                this.GithubFileReader.output,
                this.IndexSearcher.output,
                this.CodeSearcher.output,
                this.PrFetcher.output,
            ],
        });
    }
}
