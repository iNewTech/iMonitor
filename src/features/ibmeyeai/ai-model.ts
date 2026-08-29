import {
    AI_PROVIDER_CATALOG,
    getAiProviderCatalogEntry,
    getDefaultEndpointForProvider,
    getDefaultModelForProvider,
    requiresApiKey,
    type AiProvider,
    type AiProviderCatalogEntry,
    type AiProviderFamily
} from './provider-catalog';

export type { AiProvider, AiProviderCatalogEntry, AiProviderFamily } from './provider-catalog';

export interface AiProviderDefinition {
    id: AiProvider;
    label: string;
    family: AiProviderFamily;
    defaultEndpoint: string;
    requiresApiKey: boolean;
    description: string;
}

/**
 * Persisted AI assistant settings exposed to the renderer.
 */
export interface AiAssistantSettings {
    enabled: boolean;
    provider: AiProvider;
    endpoint: string;
    model: string;
    apiKey: string;
    temperature: number;
    replyStyle: string;
    historyLimit: number;
    activityLimit: number;
    jobLimit: number;
    alertLimit: number;
}

/**
 * Encrypted AI assistant settings stored on disk.
 */
export interface StoredAiAssistantSettings {
    enabled: boolean;
    provider: AiProvider;
    endpoint: string;
    model: string;
    encryptedApiKey: string;
    temperature: number;
    replyStyle: string;
    historyLimit: number;
    activityLimit: number;
    jobLimit: number;
    alertLimit: number;
}

/**
 * Lightweight provider health and entitlement state for the renderer.
 */
export interface AiAssistantAvailability {
    enabled: boolean;
    provider: AiProvider;
    providerLabel: string;
    providerFamily: AiProviderFamily;
    endpoint: string;
    selectedModel: string | null;
    availableModels: string[];
    healthy: boolean;
    featureAccess: 'included';
    message: string;
}

/**
 * Chat message shape shared between renderer state and provider requests.
 */
export interface AiAssistantMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export const AI_PROVIDER_DEFINITIONS: AiProviderDefinition[] = AI_PROVIDER_CATALOG.map((provider) => ({
    id: provider.id,
    label: provider.label,
    family: provider.family,
    defaultEndpoint: provider.defaultEndpoint,
    requiresApiKey: provider.requiresApiKey,
    description: provider.description
}));

/**
 * Preferred Ollama model order for iMonitor incident analysis.
 */
export const DEFAULT_OLLAMA_MODEL_PREFERENCE = [
    'gemma3:latest',
    'llama3.1:latest'
] as const;

export const DEFAULT_PROVIDER_MODELS = AI_PROVIDER_CATALOG.reduce<Record<AiProvider, string>>((models, provider) => {
    models[provider.id] = provider.defaultModel;
    return models;
}, {} as Record<AiProvider, string>);

/**
 * Default AI settings for IBMEye analysis.
 */
export const DEFAULT_AI_ASSISTANT_SETTINGS: AiAssistantSettings = {
    enabled: true,
    provider: 'ollama',
    endpoint: getDefaultEndpointForProvider('ollama'),
    model: getDefaultModelForProvider('ollama'),
    apiKey: '',
    temperature: 0.2,
    replyStyle: 'Reply in a human, operator-friendly tone. Keep answers short, precise, and complete. Use simple formatting when it improves readability.',
    historyLimit: 12,
    activityLimit: 12,
    jobLimit: 8,
    alertLimit: 8
};

export const DEFAULT_STORED_AI_ASSISTANT_SETTINGS: StoredAiAssistantSettings = {
    enabled: true,
    provider: 'ollama',
    endpoint: getDefaultEndpointForProvider('ollama'),
    model: getDefaultModelForProvider('ollama'),
    encryptedApiKey: '',
    temperature: 0.2,
    replyStyle: DEFAULT_AI_ASSISTANT_SETTINGS.replyStyle,
    historyLimit: 12,
    activityLimit: 12,
    jobLimit: 8,
    alertLimit: 8
};

function normalizeProvider(candidate: unknown): AiProvider {
    const provider = String(candidate ?? '').trim() as AiProvider;
    return AI_PROVIDER_DEFINITIONS.some((definition) => definition.id === provider)
        ? provider
        : DEFAULT_AI_ASSISTANT_SETTINGS.provider;
}

export function getAiProviderDefinition(provider: AiProvider): AiProviderDefinition {
    return AI_PROVIDER_DEFINITIONS.find((definition) => definition.id === provider)
        ?? AI_PROVIDER_DEFINITIONS[0];
}

function normalizeBaseSettings(candidate: Partial<AiAssistantSettings> | Partial<StoredAiAssistantSettings> | undefined) {
    const provider = normalizeProvider(candidate?.provider);
    const endpointCandidate = String(candidate?.endpoint ?? '').trim();
    const defaultModel = getDefaultModelForProvider(provider);
    const model = String(candidate?.model ?? defaultModel).trim();
    const replyStyle = String(candidate?.replyStyle ?? DEFAULT_AI_ASSISTANT_SETTINGS.replyStyle).trim();
    const temperature = Number(candidate?.temperature);
    const historyLimit = Number(candidate?.historyLimit);
    const activityLimit = Number(candidate?.activityLimit);
    const jobLimit = Number(candidate?.jobLimit);
    const alertLimit = Number(candidate?.alertLimit);

    const shouldUseProviderDefaultEndpoint = !endpointCandidate
        || (
            provider !== DEFAULT_AI_ASSISTANT_SETTINGS.provider
            && endpointCandidate.replace(/\/+$/, '') === DEFAULT_AI_ASSISTANT_SETTINGS.endpoint
        );

    return {
        enabled: candidate?.enabled ?? DEFAULT_AI_ASSISTANT_SETTINGS.enabled,
        provider,
        endpoint: shouldUseProviderDefaultEndpoint
            ? getDefaultEndpointForProvider(provider)
            : endpointCandidate.replace(/\/+$/, ''),
        model: model || defaultModel,
        temperature: Number.isFinite(temperature)
            ? Math.max(0, Math.min(1, temperature))
            : DEFAULT_AI_ASSISTANT_SETTINGS.temperature,
        replyStyle: replyStyle.slice(0, 600) || DEFAULT_AI_ASSISTANT_SETTINGS.replyStyle,
        historyLimit: Number.isFinite(historyLimit)
            ? Math.max(1, Math.min(50, Math.round(historyLimit)))
            : DEFAULT_AI_ASSISTANT_SETTINGS.historyLimit,
        activityLimit: Number.isFinite(activityLimit)
            ? Math.max(1, Math.min(50, Math.round(activityLimit)))
            : DEFAULT_AI_ASSISTANT_SETTINGS.activityLimit,
        jobLimit: Number.isFinite(jobLimit)
            ? Math.max(1, Math.min(25, Math.round(jobLimit)))
            : DEFAULT_AI_ASSISTANT_SETTINGS.jobLimit,
        alertLimit: Number.isFinite(alertLimit)
            ? Math.max(1, Math.min(25, Math.round(alertLimit)))
            : DEFAULT_AI_ASSISTANT_SETTINGS.alertLimit
    };
}

export function normalizeAiAssistantSettings(
    candidate: Partial<AiAssistantSettings> | undefined
): AiAssistantSettings {
    return {
        ...normalizeBaseSettings(candidate),
        apiKey: String(candidate?.apiKey ?? DEFAULT_AI_ASSISTANT_SETTINGS.apiKey).trim()
    };
}

export function normalizeStoredAiAssistantSettings(
    candidate: Partial<StoredAiAssistantSettings> | undefined
): StoredAiAssistantSettings {
    return {
        ...normalizeBaseSettings(candidate),
        encryptedApiKey: String(
            candidate?.encryptedApiKey ?? DEFAULT_STORED_AI_ASSISTANT_SETTINGS.encryptedApiKey
        ).trim()
    };
}

export function toStoredAiAssistantSettings(
    settings: AiAssistantSettings,
    protectSecret: (value: string) => string
): StoredAiAssistantSettings {
    const { apiKey, ...normalized } = normalizeAiAssistantSettings(settings);

    return {
        ...normalized,
        encryptedApiKey: apiKey ? protectSecret(apiKey) : ''
    };
}

export function toRenderableAiAssistantSettings(
    settings: StoredAiAssistantSettings,
    revealSecret: (value: string) => string
): AiAssistantSettings {
    const { encryptedApiKey, ...normalized } = normalizeStoredAiAssistantSettings(settings);

    return {
        ...normalized,
        apiKey: encryptedApiKey ? revealSecret(encryptedApiKey) : ''
    };
}

export function resolvePreferredOllamaModel(
    installedModels: string[],
    requestedModel?: string | null
) {
    const normalizedInstalledModels = installedModels.filter(Boolean);
    const normalizedRequestedModel = String(requestedModel ?? '').trim();

    if (normalizedRequestedModel && normalizedInstalledModels.includes(normalizedRequestedModel)) {
        return normalizedRequestedModel;
    }

    const preferredModel = DEFAULT_OLLAMA_MODEL_PREFERENCE.find((model) => (
        normalizedInstalledModels.includes(model)
    ));

    if (preferredModel) {
        return preferredModel;
    }

    return normalizedInstalledModels[0] || null;
}

export function resolvePreferredHostedModel(
    availableModels: string[],
    requestedModel?: string | null
) {
    const normalizedAvailableModels = availableModels.filter(Boolean);
    const normalizedRequestedModel = String(requestedModel ?? '').trim();

    if (normalizedRequestedModel && normalizedAvailableModels.includes(normalizedRequestedModel)) {
        return normalizedRequestedModel;
    }

    return normalizedAvailableModels[0] || normalizedRequestedModel || null;
}

export function getAiProviderCatalog() {
    return AI_PROVIDER_CATALOG.map((provider) => ({
        ...provider,
        setupSteps: provider.setupSteps.slice(),
        suggestedModels: provider.suggestedModels.slice()
    }));
}

export function getAiProviderCatalogOption(provider: AiProvider): AiProviderCatalogEntry {
    return getAiProviderCatalogEntry(provider);
}

export {
    getDefaultEndpointForProvider,
    getDefaultModelForProvider,
    requiresApiKey
};
