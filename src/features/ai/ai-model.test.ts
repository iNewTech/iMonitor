import { describe, expect, it } from 'vitest';
import {
    DEFAULT_OLLAMA_MODEL_PREFERENCE,
    DEFAULT_AI_ASSISTANT_SETTINGS,
    normalizeAiAssistantSettings,
    resolvePreferredOllamaModel
} from './ai-model';

describe('ai-model', () => {
    it('returns defaults for missing or invalid values', () => {
        expect(normalizeAiAssistantSettings(undefined)).toEqual(DEFAULT_AI_ASSISTANT_SETTINGS);
        expect(normalizeAiAssistantSettings({
            endpoint: '   ',
            provider: 'unknown' as never,
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

    it('normalizes supported values and trims endpoint and model text', () => {
        expect(normalizeAiAssistantSettings({
            endpoint: 'http://localhost:11434///',
            provider: 'ollama',
            model: ' llama3.1:8b ',
            temperature: 0.45,
            replyStyle: ' Reply like a calm operator assistant. ',
            historyLimit: 18,
            activityLimit: 14,
            jobLimit: 10,
            alertLimit: 7
        })).toEqual({
            enabled: true,
            provider: 'ollama',
            endpoint: 'http://localhost:11434',
            model: 'llama3.1:8b',
            temperature: 0.45,
            replyStyle: 'Reply like a calm operator assistant.',
            historyLimit: 18,
            activityLimit: 14,
            jobLimit: 10,
            alertLimit: 7
        });
    });

    it('clamps oversized reply style text', () => {
        const longReplyStyle = 'x'.repeat(800);

        expect(normalizeAiAssistantSettings({
            replyStyle: longReplyStyle
        }).replyStyle).toHaveLength(600);
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

        expect(resolvePreferredOllamaModel([
            'custom:model'
        ], 'gemma3:latest')).toBe('custom:model');
    });
});
