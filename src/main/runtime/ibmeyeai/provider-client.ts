import type {
    AiAssistantAvailability,
    AiAssistantMessage,
    AiAssistantSettings
} from '../../../features/ibmeyeai/ai-model';

export interface RequestJsonFn {
    <T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T>;
}

export interface AiProviderClient {
    getAvailability: (settings: AiAssistantSettings) => Promise<AiAssistantAvailability>;
    ask: (settings: AiAssistantSettings, model: string, messages: AiAssistantMessage[]) => Promise<string>;
}
