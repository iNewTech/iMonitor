export type AiProviderFamily = 'ollama' | 'openai-compatible' | 'anthropic';

export type AiProvider =
    | 'ollama'
    | 'openai'
    | 'anthropic'
    | 'grok';

export interface AiProviderCatalogEntry {
    id: AiProvider;
    label: string;
    family: AiProviderFamily;
    defaultEndpoint: string;
    requiresApiKey: boolean;
    description: string;
    setupTitle: string;
    symbol: string;
    docsLabel: string;
    authLabel: string;
    endpointLabel: string;
    apiKeyLabel: string;
    modelLabel: string;
    helper: string;
    setupSteps: string[];
    suggestedModels: string[];
    defaultModel: string;
}

export const AI_PROVIDER_CATALOG: AiProviderCatalogEntry[] = [
    {
        id: 'ollama',
        label: 'Open Models',
        family: 'ollama',
        defaultEndpoint: 'http://127.0.0.1:11434',
        requiresApiKey: false,
        description: 'Local open-source models running on this machine.',
        setupTitle: 'Ollama local runtime',
        symbol: '◎',
        docsLabel: 'Local open-source models running on this machine.',
        authLabel: 'No key required',
        endpointLabel: 'Local endpoint',
        apiKeyLabel: '',
        modelLabel: 'Installed model',
        helper: 'Use this for the default local setup. IBMEye reads the models already installed in Ollama.',
        setupSteps: [
            'Start Ollama on this machine.',
            'Refresh provider status to detect installed local models.',
            'Pick one installed model for incident analysis.'
        ],
        suggestedModels: ['gemma3:latest', 'llama3.1:latest'],
        defaultModel: 'gemma3:latest'
    },
    {
        id: 'openai',
        label: 'Codex / OpenAI',
        family: 'openai-compatible',
        defaultEndpoint: 'https://api.openai.com/v1',
        requiresApiKey: true,
        description: 'Hosted OpenAI models over the OpenAI-compatible API.',
        setupTitle: 'OpenAI API setup',
        symbol: '✳',
        docsLabel: 'Hosted OpenAI models over the official OpenAI API.',
        authLabel: 'Bearer API key',
        endpointLabel: 'API endpoint',
        apiKeyLabel: 'OpenAI API key',
        modelLabel: 'OpenAI model',
        helper: 'Use this for Codex or ChatGPT-backed API models. Save the API key once, then select the model you want.',
        setupSteps: [
            'Paste your OpenAI API key.',
            'Verify the default endpoint or replace it with your managed endpoint.',
            'Refresh provider status to load the models available to your account.'
        ],
        suggestedModels: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
        defaultModel: 'gpt-5'
    },
    {
        id: 'anthropic',
        label: 'Claude',
        family: 'anthropic',
        defaultEndpoint: 'https://api.anthropic.com/v1',
        requiresApiKey: true,
        description: 'Native Claude access over the Anthropic Messages API.',
        setupTitle: 'Claude API setup',
        symbol: '✺',
        docsLabel: 'Anthropic Claude models over the Messages API.',
        authLabel: 'x-api-key header',
        endpointLabel: 'Claude endpoint',
        apiKeyLabel: 'Claude API key',
        modelLabel: 'Claude model',
        helper: 'Use this when your operators want Claude-specific reasoning and summaries.',
        setupSteps: [
            'Paste your Claude API key.',
            'Keep the default endpoint unless your environment requires a proxy.',
            'Refresh provider status to load the Claude models available to your account.'
        ],
        suggestedModels: ['claude-sonnet-4-5', 'claude-opus-4-1'],
        defaultModel: 'claude-sonnet-4-5'
    },
    {
        id: 'grok',
        label: 'Grok / xAI',
        family: 'openai-compatible',
        defaultEndpoint: 'https://api.x.ai/v1',
        requiresApiKey: true,
        description: 'Hosted xAI Grok models over the OpenAI-compatible API.',
        setupTitle: 'Grok API setup',
        symbol: '◌',
        docsLabel: 'xAI Grok models over the xAI API.',
        authLabel: 'Bearer API key',
        endpointLabel: 'xAI endpoint',
        apiKeyLabel: 'xAI API key',
        modelLabel: 'Grok model',
        helper: 'Use this when you want Grok models from xAI instead of OpenAI or Claude.',
        setupSteps: [
            'Paste your xAI API key.',
            'Keep the default xAI endpoint unless your environment uses a gateway.',
            'Refresh provider status to load the Grok models available to your account.'
        ],
        suggestedModels: ['grok-4', 'grok-3-mini'],
        defaultModel: 'grok-4'
    }
];

export function getAiProviderCatalog() {
    return AI_PROVIDER_CATALOG.map((provider) => ({
        ...provider,
        setupSteps: provider.setupSteps.slice(),
        suggestedModels: provider.suggestedModels.slice()
    }));
}

export function getAiProviderCatalogEntry(provider: AiProvider) {
    return AI_PROVIDER_CATALOG.find((entry) => entry.id === provider) ?? AI_PROVIDER_CATALOG[0];
}

export function getDefaultEndpointForProvider(provider: AiProvider) {
    return getAiProviderCatalogEntry(provider).defaultEndpoint;
}

export function getDefaultModelForProvider(provider: AiProvider) {
    return getAiProviderCatalogEntry(provider).defaultModel;
}

export function requiresApiKey(provider: AiProvider) {
    return getAiProviderCatalogEntry(provider).requiresApiKey;
}
