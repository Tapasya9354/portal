import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : Generate KT Docs
// Nodes   : 5  |  Connections: 2
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Webhook                            webhook
// AiAgent                            agent                      [AI]
// GoogleGeminiChatModel              lmChatGoogleGemini         [creds] [ai_languageModel]
// GithubApiTool                      httpRequestTool            [ai_tool]
// Callbackrequest                    httpRequest
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// Webhook
//    → AiAgent
//      → Callbackrequest
//
// AI CONNECTIONS
// AiAgent.uses({ ai_languageModel: GoogleGeminiChatModel, ai_tool: [GithubApiTool] })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: '0Dr1mSK2T3DXmpC3',
    name: 'Generate KT Docs',
    active: false,
    isArchived: false,
    projectId: 'qNuy2v6q0zPtP2Zd',
    settings: { executionOrder: 'v1', binaryMode: 'separate' },
})
export class GenerateKtDocsWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: '9cfb7ad9-f434-41cb-a589-d419aedb9086',
        webhookId: '20b18657-0559-467b-b45d-d79a85ce7350',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2.1,
        position: [208, 304],
    })
    Webhook = {
        httpMethod: 'POST',
        path: 'generate-kt-docs',
        options: {},
    };

    @node({
        id: '368dc856-10da-4324-b055-8ccb90dca0d8',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [464, 304],
    })
    AiAgent = {
        promptType: 'define',
        text: '={{ "You are an architecture mapper. The user wants KT documentation and a graphical map (mermaid) of the repo: " + $json.body.repoUrl + "\\nUse the GitHub API tool to fetch the repository structure and contents as needed. The API base URL is https://api.github.com/repos/OWNER/REPO. First list the contents, then read the important files, then generate the KT documentation." }}',
        options: {},
    };

    @node({
        id: 'b18d2061-b8eb-440f-a985-011bfd8dd23b',
        name: 'Google Gemini Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
        version: 1.1,
        position: [464, 512],
        credentials: { googlePalmApi: { id: 'vhOOSSJ4MrAPZsPY', name: 'Google Gemini(PaLM) Api account' } },
    })
    GoogleGeminiChatModel = {
        modelName: 'models/gemini-3.6-flash',
        options: {},
    };

    @node({
        id: '1478641b-b0f3-46cb-9f08-9b4a1c2b7072',
        name: 'GitHub API Tool',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.5,
        position: [608, 512],
    })
    GithubApiTool = {
        toolDescription:
            'Use this tool to make GET requests to the GitHub API. It will automatically use the correct authentication. You just need to provide the full URL (e.g., https://api.github.com/repos/OWNER/REPO/contents for listing files, or the download_url for reading files).',
        url: '={{ $fromAI("url", "The full GitHub API URL to request, e.g. https://api.github.com/repos/OWNER/REPO/contents") }}',
        sendHeaders: true,
        specifyHeaders: 'json',
        jsonHeaders: {
            Authorization: '={{ "Bearer " + $("Webhook").item.json.body.pat }}',
            'User-Agent': '={{ $("Webhook").item.json.body.gitUsername }}',
            Accept: 'application/vnd.github.v3+json',
        },
        options: {},
    };

    @node({
        id: '4e30f115-c10f-49b3-b546-8d0c6c15849e',
        name: 'CallbackRequest',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.5,
        position: [960, 304],
    })
    Callbackrequest = {
        method: 'POST',
        url: '={{ $("Webhook").item.json.body.callbackUrl }}',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: {
            documentation: '={{ $json.output }}',
        },
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.Webhook.out(0).to(this.AiAgent.in(0));
        this.AiAgent.out(0).to(this.Callbackrequest.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.GoogleGeminiChatModel.output,
            ai_tool: [this.GithubApiTool.output],
        });
    }
}
