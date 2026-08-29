import type { AiProvider, AiAssistantSettings } from '../../../../features/ibmeyeai/ai-model';
import { createAiHttpClient } from '../http-client';
import type { AiProviderClient } from '../provider-client';
import { createClaudeProviderClient } from './claude';
import { createOpenAiCompatibleProviderClient } from './openai';
import { createOllamaProviderClient } from './ollama';

interface ProviderRegistryDependencies {
    fetchImpl?: typeof fetch;
}

/**
 * Builds one provider client per supported AI provider.
 */
export function createAiProviderRegistry(dependencies: ProviderRegistryDependencies) {
    const httpClient = createAiHttpClient({
        fetchImpl: dependencies.fetchImpl
    });

    const providers: Record<AiProvider, AiProviderClient> = {
        ollama: createOllamaProviderClient(httpClient.requestJson),
        openai: createOpenAiCompatibleProviderClient('openai', httpClient),
        anthropic: createClaudeProviderClient(httpClient.requestJson),
        grok: createOpenAiCompatibleProviderClient('grok', httpClient)
    };

    return {
        getProviderClient(settings: Pick<AiAssistantSettings, 'provider'>) {
            return providers[settings.provider];
        }
    };
}
