import {
    getAiProviderDefinition,
    resolvePreferredHostedModel,
    type AiAssistantAvailability,
    type AiAssistantMessage,
    type AiAssistantSettings
} from '../../../../features/ibmeyeai/ai-model';
import type { AiProviderClient, RequestJsonFn } from '../provider-client';

interface OpenAiModelsResponse {
    data?: Array<{
        id?: string;
    }>;
}

interface OpenAiChatResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
}

interface OpenAiProviderDependencies {
    requestJson: RequestJsonFn;
    getBearerAuthHeaders: (settings: AiAssistantSettings) => Record<string, string>;
}

/**
 * Handles OpenAI-compatible providers that use bearer auth and chat completions.
 */
export function createOpenAiCompatibleProviderClient(
    providerId: 'openai' | 'grok',
    dependencies: OpenAiProviderDependencies
): AiProviderClient {
    const providerDefinition = getAiProviderDefinition(providerId);

    async function getModels(settings: AiAssistantSettings) {
        const payload = await dependencies.requestJson<OpenAiModelsResponse>(`${settings.endpoint}/models`, {
            headers: {
                'Content-Type': 'application/json',
                ...dependencies.getBearerAuthHeaders(settings)
            }
        }, 7000);

        return (payload.data ?? [])
            .map((model) => model.id || '')
            .filter(Boolean);
    }

    return {
        async getAvailability(settings: AiAssistantSettings): Promise<AiAssistantAvailability> {
            if (!settings.apiKey.trim()) {
                return {
                    enabled: settings.enabled,
                    provider: settings.provider,
                    providerLabel: providerDefinition.label,
                    providerFamily: providerDefinition.family,
                    endpoint: settings.endpoint,
                    selectedModel: settings.model || null,
                    availableModels: [],
                    healthy: false,
                    featureAccess: 'included',
                    message: `${providerDefinition.label} needs an API key before IBMEye AI can connect.`
                };
            }

            try {
                const availableModels = await getModels(settings);
                const selectedModel = resolvePreferredHostedModel(availableModels, settings.model);

                return {
                    enabled: settings.enabled,
                    provider: settings.provider,
                    providerLabel: providerDefinition.label,
                    providerFamily: providerDefinition.family,
                    endpoint: settings.endpoint,
                    selectedModel,
                    availableModels,
                    healthy: true,
                    featureAccess: 'included',
                    message: selectedModel
                        ? `${providerDefinition.label} is ready with ${availableModels.length} model${availableModels.length === 1 ? '' : 's'}. Using ${selectedModel}.`
                        : `${providerDefinition.label} is reachable, but no model is available for selection yet.`
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    enabled: settings.enabled,
                    provider: settings.provider,
                    providerLabel: providerDefinition.label,
                    providerFamily: providerDefinition.family,
                    endpoint: settings.endpoint,
                    selectedModel: settings.model || null,
                    availableModels: [],
                    healthy: false,
                    featureAccess: 'included',
                    message: `${providerDefinition.label} is unavailable: ${message}`
                };
            }
        },
        async ask(settings: AiAssistantSettings, model: string, messages: AiAssistantMessage[]) {
            const response = await dependencies.requestJson<OpenAiChatResponse>(`${settings.endpoint}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...dependencies.getBearerAuthHeaders(settings)
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: settings.temperature
                })
            });

            const content = response.choices?.[0]?.message?.content;
            return typeof content === 'string' ? content.trim() : '';
        }
    };
}
