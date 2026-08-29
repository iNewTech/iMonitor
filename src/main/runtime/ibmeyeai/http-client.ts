import type { AiAssistantSettings } from '../../../features/ibmeyeai/ai-model';

interface HttpClientDependencies {
    fetchImpl?: typeof fetch;
}

/**
 * Creates a shared JSON requester for IBMEye AI providers.
 */
export function createAiHttpClient(dependencies: HttpClientDependencies) {
    const fetchImpl = dependencies.fetchImpl ?? fetch;

    async function requestJson<T>(url: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetchImpl(url, {
                ...init,
                signal: controller.signal,
                headers: {
                    ...(init?.headers ?? {})
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            return await response.json() as T;
        } finally {
            clearTimeout(timer);
        }
    }

    function getBearerAuthHeaders(settings: AiAssistantSettings): Record<string, string> {
        return settings.apiKey.trim()
            ? { Authorization: `Bearer ${settings.apiKey}` }
            : {};
    }

    return {
        requestJson,
        getBearerAuthHeaders
    };
}
