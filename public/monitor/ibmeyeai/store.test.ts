import { describe, expect, it, vi } from 'vitest';
import { createIBMEyeAiState } from './store.js';

describe('IBMEye AI single-flight state', () => {
    it('does not accept a second question while the first answer is pending', async () => {
        let resolveRequest: ((value: unknown) => void) | undefined;
        const askAiAssistant = vi.fn(() => new Promise((resolve) => {
            resolveRequest = resolve;
        }));

        vi.stubGlobal('window', { electronAPI: { askAiAssistant } });

        const state = createIBMEyeAiState({ getSelectedJobName: () => undefined });
        const firstRequest = state.submitPrompt('first question');
        await Promise.resolve();

        const secondResult = await state.submitPrompt('second question');

        expect(secondResult).toBe(false);
        expect(askAiAssistant).toHaveBeenCalledTimes(1);
        expect(state.getSnapshot().conversation).toEqual([
            { role: 'user', content: 'first question' }
        ]);

        resolveRequest?.({
            success: true,
            reply: 'first answer',
            availability: { healthy: true, selectedModel: 'demo-model' }
        });

        expect(await firstRequest).toBe(true);
        expect(state.getSnapshot().conversation.at(-1)).toEqual({
            role: 'assistant',
            content: 'first answer'
        });
        expect(state.getSnapshot().pendingReply).toBe(false);
    });
});

describe('IBMEye scope and error preservation', () => {
    it('sends explicit job scope and keeps a failed response visible after discovery refresh', async () => {
        const askAiAssistant = vi.fn(async (_request: unknown) => ({ success: false, error: 'Request timed out. Try again.' }));
        vi.stubGlobal('window', { electronAPI: {
            askAiAssistant,
            getAiProviderCatalog: async () => [{ id: 'ollama' }],
            getAiSettings: async () => ({ enabled: true, provider: 'ollama' }),
            getAiAvailability: async () => ({ healthy: true, message: 'Ready' })
        } });
        const state = createIBMEyeAiState({ getSelectedJobName: () => '123/OPS/BATCH' });
        await state.submitPrompt('Explain this job');
        expect(askAiAssistant.mock.calls[0][0]).toMatchObject({ scope: 'job', selectedJobName: '123/OPS/BATCH' });
        await state.refresh();
        expect(state.getSnapshot()).toMatchObject({ statusIsError: true, statusMessage: 'Request timed out. Try again.' });
    });
});
