import { describe, expect, it } from 'vitest';
import { buildAiAssistantPrompt } from './ai-prompt';

describe('ai-prompt', () => {
    it('builds a grounded prompt with system instructions and user context', () => {
        const messages = buildAiAssistantPrompt({
            question: 'What needs attention now?',
            context: 'Active alerts:\nMSGW detected',
            replyStyle: 'Reply like a human operator assistant.'
        });

        expect(messages[0]?.role).toBe('system');
        expect(messages[0]?.content).toContain('IBMEye assistant');
        expect(messages[0]?.content).toContain('Correlate alerts');
        expect(messages[0]?.content).toContain('Reply like a human operator assistant.');
        expect(messages[messages.length - 1]?.content).toContain('Question:\nWhat needs attention now?');
        expect(messages[messages.length - 1]?.content).toContain('Context:\nActive alerts:\nMSGW detected');
    });

    it('keeps only recent non-system conversation turns', () => {
        const conversation = new Array(8).fill(null).map((_, index) => ({
            role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
            content: `turn-${index}`
        }));

        const messages = buildAiAssistantPrompt({
            question: 'Summarize.',
            context: 'Context block',
            conversation
        });

        expect(messages.slice(1, -1).map((message) => message.content)).toEqual([
            'turn-2',
            'turn-3',
            'turn-4',
            'turn-5',
            'turn-6',
            'turn-7'
        ]);
    });
});
