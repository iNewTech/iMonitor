import { describe, expect, it } from 'vitest';
import {
    AI_PROVIDER_DEFINITIONS,
    DEFAULT_AI_ASSISTANT_SETTINGS,
    DEFAULT_OLLAMA_MODEL_PREFERENCE,
    DEFAULT_PROVIDER_MODELS,
    DEFAULT_STORED_AI_ASSISTANT_SETTINGS,
    getDefaultModelForProvider,
    getAiProviderDefinition,
    normalizeAiAssistantSettings,
    normalizeStoredAiAssistantSettings,
    requiresApiKey,
    resolvePreferredHostedModel,
    resolvePreferredOllamaModel,
    toRenderableAiAssistantSettings,
    toStoredAiAssistantSettings
} from './ai-model';

describe('ai-model', () => {
    it('returns defaults for missing or invalid values', () => {
        expect(normalizeAiAssistantSettings(undefined)).toEqual(DEFAULT_AI_ASSISTANT_SETTINGS);
        expect(normalizeAiAssistantSettings({
            endpoint: '   ',
            provider: 'unknown' as never,
            apiKey: '  ',
            temperature: 4,
            replyStyle: '   ',
            historyLimit: -3,
            activityLimit: 0
        })).toEqual({
            ...DEFAULT_AI_ASSISTANT_SETTINGS,
            temperature: 1,
            historyLimit: 1,
            activityLimit: 1
        });
    });

    it('normalizes supported values and provider defaults', () => {
        expect(normalizeAiAssistantSettings({
            provider: 'grok',
            endpoint: '   ',
            model: ' grok-4 ',
            apiKey: ' key-123 ',
            temperature: 0.45,
            replyStyle: ' Reply like a calm operator assistant. ',
            historyLimit: 18,
            activityLimit: 14,
            jobLimit: 10,
            alertLimit: 7
        })).toEqual({
            enabled: true,
            provider: 'grok',
            endpoint: 'https://api.x.ai/v1',
            model: 'grok-4',
            apiKey: 'key-123',
            temperature: 0.45,
            replyStyle: 'Reply like a calm operator assistant.',
            historyLimit: 18,
            activityLimit: 14,
            jobLimit: 10,
            alertLimit: 7
        });

        expect(normalizeAiAssistantSettings({
            provider: 'openai',
            model: ''
        }).model).toBe(DEFAULT_PROVIDER_MODELS.openai);
    });

    it('normalizes encrypted stored settings', () => {
        expect(normalizeStoredAiAssistantSettings({
            provider: 'anthropic',
            endpoint: 'https://api.anthropic.com/v1///',
            encryptedApiKey: 'secret'
        })).toEqual({
            ...DEFAULT_STORED_AI_ASSISTANT_SETTINGS,
            provider: 'anthropic',
            endpoint: 'https://api.anthropic.com/v1',
            model: 'claude-sonnet-4-5',
            encryptedApiKey: 'secret'
        });
    });

    it('converts between renderable and stored settings', () => {
        const stored = toStoredAiAssistantSettings({
            ...DEFAULT_AI_ASSISTANT_SETTINGS,
            provider: 'openai',
            apiKey: 'openai-key'
        }, (value) => `enc:${value}`);

        expect(stored.encryptedApiKey).toBe('enc:openai-key');

        expect(toRenderableAiAssistantSettings(stored, (value) => value.replace(/^enc:/, ''))).toEqual({
            ...DEFAULT_AI_ASSISTANT_SETTINGS,
            provider: 'openai',
            endpoint: 'https://api.openai.com/v1',
            apiKey: 'openai-key'
        });
    });

    it('exposes provider metadata and key requirements', () => {
        expect(AI_PROVIDER_DEFINITIONS.map((definition) => definition.id)).toEqual([
            'ollama',
            'openai',
            'anthropic',
            'grok'
        ]);

        expect(getAiProviderDefinition('anthropic').family).toBe('anthropic');
        expect(getDefaultModelForProvider('anthropic')).toBe('claude-sonnet-4-5');
        expect(requiresApiKey('ollama')).toBe(false);
        expect(requiresApiKey('openai')).toBe(true);
    });

    it('prefers gemma3 first and falls back when the requested model is unavailable', () => {
        expect(DEFAULT_OLLAMA_MODEL_PREFERENCE).toEqual([
            'gemma3:latest',
            'llama3.1:latest'
        ]);

        expect(resolvePreferredOllamaModel([
            'llama3.1:latest',
            'gemma3:latest'
        ], 'gemma3:latest')).toBe('gemma3:latest');

        expect(resolvePreferredOllamaModel([
            'llama3.1:latest'
        ], 'gemma3:latest')).toBe('llama3.1:latest');
    });

    it('resolves hosted model fallbacks', () => {
        expect(resolvePreferredHostedModel([
            'gpt-4.1-mini',
            'gpt-4.1'
        ], 'gpt-4.1')).toBe('gpt-4.1');

        expect(resolvePreferredHostedModel([
            'claude-sonnet-4-5'
        ], 'claude-opus-4-1')).toBe('claude-sonnet-4-5');

        expect(resolvePreferredHostedModel([], 'custom-model')).toBe('custom-model');
    });
});
