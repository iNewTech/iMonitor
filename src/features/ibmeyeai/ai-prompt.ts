import type { AiAssistantMessage } from './ai-model';

interface BuildAiPromptInput {
    question: string;
    context: string;
    conversation?: AiAssistantMessage[];
    replyStyle?: string;
    scope?: 'monitor' | 'job';
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
                'Correlate alerts that affect the same job into one incident, cite the evidence, and distinguish facts from recommendations.',
                'Do not claim that you executed any IBM i action.',
                ...(input.scope === 'job'
                    ? [
                        'This is a selected-job helper. Answer only about the selected IBM i job and its linked incident, evidence, history, and safe next actions.',
                        'Do not use or infer information about other jobs, the whole system, or unrelated topics.',
                        'For an unrelated question, reply exactly: I can only help with the selected IBM i job and its linked incident.'
                    ]
                    : []),
                input.replyStyle?.trim() || ''
            ].join(' ')
        },
        ...(input.scope === 'job' ? [] : conversation),
        {
            role: 'user',
            content: `Context:\n${input.context}\n\nQuestion:\n${input.question.trim()}`
        }
    ];
}
