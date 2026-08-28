/**
 * Supported local AI providers for the IBMEye assistant.
 */
export type AiProvider = 'ollama';

/**
 * Persisted AI assistant settings for the desktop app.
 */
export interface AiAssistantSettings {
    enabled: boolean;
    provider: AiProvider;
    endpoint: string;
    model: string;
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
    endpoint: string;
    selectedModel: string | null;
    availableModels: string[];
    healthy: boolean;
    featureAccess: 'included';
    message: string;
}

/**
 * Chat message shape shared between renderer state and Ollama requests.
 */
export interface AiAssistantMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Preferred Ollama model order for iMonitor incident analysis.
 */
export const DEFAULT_OLLAMA_MODEL_PREFERENCE = [
    'gemma3:latest',
    'llama3.1:latest'
] as const;

/**
 * Default AI settings for local Ollama-backed analysis.
 */
export const DEFAULT_AI_ASSISTANT_SETTINGS: AiAssistantSettings = {
    enabled: true,
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    model: 'gemma3:latest',
    temperature: 0.2,
    replyStyle: 'Reply in a human, operator-friendly tone. Keep answers short, precise, and complete. Use simple formatting when it improves readability.',
    historyLimit: 12,
    activityLimit: 12,
    jobLimit: 8,
    alertLimit: 8
};

/**
 * Clamps and normalizes stored AI settings into a stable shape.
 */
export function normalizeAiAssistantSettings(
    candidate: Partial<AiAssistantSettings> | undefined
): AiAssistantSettings {
    const endpoint = String(candidate?.endpoint ?? DEFAULT_AI_ASSISTANT_SETTINGS.endpoint).trim();
    const model = String(candidate?.model ?? DEFAULT_AI_ASSISTANT_SETTINGS.model).trim();
    const replyStyle = String(candidate?.replyStyle ?? DEFAULT_AI_ASSISTANT_SETTINGS.replyStyle).trim();
    const temperature = Number(candidate?.temperature);
    const historyLimit = Number(candidate?.historyLimit);
    const activityLimit = Number(candidate?.activityLimit);
    const jobLimit = Number(candidate?.jobLimit);
    const alertLimit = Number(candidate?.alertLimit);

    return {
        enabled: candidate?.enabled ?? DEFAULT_AI_ASSISTANT_SETTINGS.enabled,
        provider: candidate?.provider === 'ollama' ? 'ollama' : DEFAULT_AI_ASSISTANT_SETTINGS.provider,
        endpoint: endpoint.replace(/\/+$/, '') || DEFAULT_AI_ASSISTANT_SETTINGS.endpoint,
        model: model || DEFAULT_AI_ASSISTANT_SETTINGS.model,
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

/**
 * Selects the best installed Ollama model for the current iMonitor defaults.
 */
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
