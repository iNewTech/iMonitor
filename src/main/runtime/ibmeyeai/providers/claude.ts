import {
    getAiProviderDefinition,
    resolvePreferredHostedModel,
    type AiAssistantAvailability,
    type AiAssistantMessage,
    type AiAssistantSettings
} from '../../../../features/ibmeyeai/ai-model';
import type { AiProviderClient, RequestJsonFn } from '../provider-client';

interface AnthropicModelsResponse {
    data?: Array<{
        id?: string;
    }>;
}

interface AnthropicMessagesResponse {
    content?: Array<{
        type?: string;
        text?: string;
    }>;
}

/**
 * Handles Anthropic Claude model discovery and messages requests.
 */
export function createClaudeProviderClient(requestJson: RequestJsonFn): AiProviderClient {
    const providerDefinition = getAiProviderDefinition('anthropic');

    async function getModels(settings: AiAssistantSettings) {
        const payload = await requestJson<AnthropicModelsResponse>(`${settings.endpoint}/models`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': settings.apiKey,
                'anthropic-version': '2023-06-01'
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
            const systemMessages = messages
                .filter((message) => message.role === 'system')
                .map((message) => message.content.trim())
                .filter(Boolean);
            const conversationMessages = messages
                .filter((message) => message.role !== 'system')
                .map((message) => ({
                    role: message.role,
                    content: message.content
                }));

            const response = await requestJson<AnthropicMessagesResponse>(`${settings.endpoint}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': settings.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model,
                    system: systemMessages.join('\n\n'),
                    messages: conversationMessages,
                    temperature: settings.temperature,
                    max_tokens: 900
                })
            });

            return (response.content ?? [])
                .filter((part) => part.type === 'text' && part.text)
                .map((part) => part.text?.trim() || '')
                .filter(Boolean)
                .join('\n\n');
        }
    };
}
