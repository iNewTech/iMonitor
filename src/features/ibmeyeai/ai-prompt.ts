import type { AiAssistantMessage } from './ai-model';

interface BuildAiPromptInput {
    question: string;
    context: string;
    conversation?: AiAssistantMessage[];
    replyStyle?: string;
}

/**
 * Creates the chat message payload sent to the local AI provider.
 */
export function buildAiAssistantPrompt(input: BuildAiPromptInput): AiAssistantMessage[] {
    const conversation = (input.conversation ?? [])
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-6);

    return [
        {
            role: 'system',
            content: [
                'You are the IBMEye assistant inside iMonitor.',
                'Analyze IBM i jobs, waits, alerts, SQL traces, and operator logs.',
                'Stay concise, use only the provided context, and explicitly say when evidence is missing.',
                'Prioritize operator impact, likely cause, and next best action.',
                'Do not claim that you executed any IBM i action.',
                input.replyStyle?.trim() || ''
            ].join(' ')
        },
        ...conversation,
        {
            role: 'user',
            content: `Context:\n${input.context}\n\nQuestion:\n${input.question.trim()}`
        }
    ];
}
