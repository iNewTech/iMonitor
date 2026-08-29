import {
    getAiProviderDefinition,
    resolvePreferredOllamaModel,
    type AiAssistantAvailability,
    type AiAssistantMessage,
    type AiAssistantSettings
} from '../../../../features/ibmeyeai/ai-model';
import type { AiProviderClient, RequestJsonFn } from '../provider-client';

interface OllamaTagsResponse {
    models?: Array<{
        name?: string;
        model?: string;
    }>;
}

interface OllamaChatResponse {
    message?: {
        content?: string;
    };
}

/**
 * Handles local Ollama model discovery and chat requests.
 */
export function createOllamaProviderClient(requestJson: RequestJsonFn): AiProviderClient {
    const providerDefinition = getAiProviderDefinition('ollama');

    async function getModels(endpoint: string) {
        const payload = await requestJson<OllamaTagsResponse>(`${endpoint}/api/tags`, undefined, 5000);
        return (payload.models ?? [])
            .map((model) => model.name || model.model || '')
            .filter(Boolean);
    }

    return {
        async getAvailability(settings: AiAssistantSettings): Promise<AiAssistantAvailability> {
            try {
                const availableModels = await getModels(settings.endpoint);
                const selectedModel = resolvePreferredOllamaModel(availableModels, settings.model);

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
            const response = await requestJson<OllamaChatResponse>(`${settings.endpoint}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    stream: false,
                    messages,
                    options: {
                        temperature: settings.temperature
                    }
                })
            });

            return response.message?.content?.trim() || '';
        }
    };
}
