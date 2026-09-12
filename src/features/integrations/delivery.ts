/** Providers that can receive an iMonitor incident or workflow update. */
export type DeliveryProvider = 'clickup' | 'jira' | 'slack' | 'email' | 'sms';

/** Durable state for one outbound event. */
export type DeliveryState = 'pending' | 'sent' | 'skipped' | 'failed';

export interface IntegrationDeliveryStatus {
    provider: DeliveryProvider;
    eventKey: string;
    state: DeliveryState;
    attempts: number;
    updatedAt: string;
    error?: string;
    reason?: string;
}

export interface DeliveryResult<T> {
    state: 'sent' | 'duplicate' | 'skipped' | 'failed';
    attempts: number;
    value?: T;
    error?: string;
    reason?: string;
}

interface DeliveryRegistryOptions {
    maxAttempts?: number;
    retryDelayMs?: number;
    maxEntries?: number;
    now?: () => string;
}

/**
 * Builds a stable key for one outbound event. The source ID and occurrence
 * make a recurring incident a new event while retries of the same occurrence
 * remain idempotent across app restarts.
 */
export function buildDeliveryEventKey(
    provider: DeliveryProvider,
    event: string,
    sourceId: string,
    occurrence: string | number = 1
) {
    return [provider, event, sourceId, String(occurrence)]
        .map((part) => encodeURIComponent(String(part).trim()))
        .join(':');
}

/** Removes credentials and keeps provider errors small enough for local logs. */
export function sanitizeDeliveryError(error: unknown, maxLength = 240) {
    const message = error instanceof Error ? error.message : String(error);
    const sanitized = message
        .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
        .replace(/(api[-_ ]?key|token|password|secret)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
        .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]');

    return sanitized.length <= maxLength
        ? sanitized
        : `${sanitized.slice(0, maxLength - 1)}…`;
}

/**
 * Owns idempotency, bounded retries, and durable delivery state for external
 * integrations. A failed delivery never throws into the local incident flow.
 */
export function createDeliveryRegistry(
    initial: Record<string, IntegrationDeliveryStatus> | undefined,
    persist: (statuses: Record<string, IntegrationDeliveryStatus>) => void,
    options: DeliveryRegistryOptions = {}
) {
    const statuses = new Map(Object.entries(initial ?? {}));
    const inFlight = new Map<string, Promise<DeliveryResult<unknown>>>();
    const maxAttempts = Math.max(1, Math.min(3, Math.round(options.maxAttempts ?? 2)));
    const retryDelayMs = Math.max(0, Math.min(1000, Math.round(options.retryDelayMs ?? 25)));
    const maxEntries = Math.max(100, Math.min(10000, Math.round(options.maxEntries ?? 2000)));
    const now = options.now ?? (() => new Date().toISOString());

    const save = () => {
        while (statuses.size > maxEntries) {
            const oldestKey = [...statuses.values()]
                .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0]?.eventKey;
            if (!oldestKey) break;
            statuses.delete(oldestKey);
        }
        persist(Object.fromEntries(statuses.entries()));
    };

    const setStatus = (status: IntegrationDeliveryStatus) => {
        statuses.set(status.eventKey, status);
        save();
    };

    async function deliver<T>(
        provider: DeliveryProvider,
        eventKey: string,
        operation: () => Promise<T>
    ): Promise<DeliveryResult<T>> {
        const current = statuses.get(eventKey);
        if (current?.state === 'sent') {
            return { state: 'duplicate', attempts: current.attempts };
        }

        const existingRequest = inFlight.get(eventKey);
        if (existingRequest) {
            return existingRequest as Promise<DeliveryResult<T>>;
        }

        const request = (async (): Promise<DeliveryResult<T>> => {
            let attempts = current?.attempts ?? 0;
            let lastError = '';

            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                attempts += 1;
                setStatus({
                    provider,
                    eventKey,
                    state: 'pending',
                    attempts,
                    updatedAt: now()
                });

                try {
                    const value = await operation();
                    setStatus({ provider, eventKey, state: 'sent', attempts, updatedAt: now() });
                    return { state: 'sent', attempts, value };
                } catch (error) {
                    lastError = sanitizeDeliveryError(error);
                    if (attempt < maxAttempts && retryDelayMs > 0) {
                        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                    }
                }
            }

            setStatus({
                provider,
                eventKey,
                state: 'failed',
                attempts,
                updatedAt: now(),
                error: lastError
            });
            return { state: 'failed', attempts, error: lastError };
        })();

        inFlight.set(eventKey, request as Promise<DeliveryResult<unknown>>);
        try {
            return await request;
        } finally {
            inFlight.delete(eventKey);
        }
    }

    function skip(
        provider: DeliveryProvider,
        eventKey: string,
        reason: string
    ): DeliveryResult<never> {
        const current = statuses.get(eventKey);
        if (current?.state === 'sent') {
            return { state: 'duplicate', attempts: current.attempts };
        }

        const normalizedReason = sanitizeDeliveryError(reason, 160);
        const status: IntegrationDeliveryStatus = {
            provider,
            eventKey,
            state: 'skipped',
            attempts: current?.attempts ?? 0,
            updatedAt: now(),
            reason: normalizedReason
        };
        setStatus(status);
        return { state: 'skipped', attempts: status.attempts, reason: normalizedReason };
    }

    return {
        deliver,
        skip,
        get(eventKey: string) {
            return statuses.get(eventKey);
        },
        getAll() {
            return Object.fromEntries(statuses.entries());
        }
    };
}
