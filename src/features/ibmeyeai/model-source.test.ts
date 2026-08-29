import { describe, expect, it } from 'vitest';
const {
    getAiProviderOption,
    getProviderCatalog,
    getProviderModels,
    getProviderModelSourceHint
} = require('../../../public/monitor/ibmeyeai/model-source.js') as {
    getAiProviderOption: (snapshot: Record<string, unknown>, providerId: string) => unknown;
    getProviderCatalog: (snapshot: Record<string, unknown>) => unknown[];
    getProviderModels: (snapshot: Record<string, unknown>, providerId: string) => string[];
    getProviderModelSourceHint: (snapshot: Record<string, unknown>, providerId: string) => string;
};

const providerCatalog = [
    {
        id: 'ollama',
        suggestedModels: ['gemma3:latest', 'llama3.1:latest']
    },
    {
        id: 'openai',
        suggestedModels: ['gpt-5', 'gpt-5-mini']
    }
];

describe('ibmeyeai model-source', () => {
    it('returns the provider catalog and active provider option from the snapshot', () => {
        const snapshot = {
            providerCatalog
        };

        expect(getProviderCatalog(snapshot)).toEqual(providerCatalog);
        expect(getAiProviderOption(snapshot, 'openai')).toEqual(providerCatalog[1]);
    });

    it('uses live provider models when the active provider reported them', () => {
        const snapshot = {
            providerCatalog,
            availability: {
                provider: 'ollama',
                availableModels: ['gemma3:latest', 'qwen3:14b']
            }
        };

        expect(getProviderModels(snapshot, 'ollama')).toEqual(['gemma3:latest', 'qwen3:14b']);
        expect(getProviderModelSourceHint(snapshot, 'ollama')).toBe('Live models loaded (2)');
    });

    it('falls back to suggested models when live models are unavailable', () => {
        const snapshot = {
            providerCatalog,
            availability: {
                provider: 'openai',
                availableModels: []
            }
        };

        expect(getProviderModels(snapshot, 'ollama')).toEqual(['gemma3:latest', 'llama3.1:latest']);
        expect(getProviderModelSourceHint(snapshot, 'ollama')).toBe('Using fallback suggestions');
    });
});
