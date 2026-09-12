export interface ActionLease {
    key: string;
    executionId: string;
    operatorId: string;
    acquiredAt: string;
    expiresAt: string;
}

export type ActionLeaseResult =
    | { granted: true; lease: ActionLease; }
    | { granted: false; reason: 'duplicate' | 'replay'; };

interface ActionLeaseOptions {
    now?: () => string;
    ttlMs?: number;
    completedTtlMs?: number;
}

/** Keeps one action per target and rejects replayed execution identifiers. */
export function createActionLeaseStore(options: ActionLeaseOptions = {}) {
    const now = options.now || (() => new Date().toISOString());
    const ttlMs = options.ttlMs || 30_000;
    const completedTtlMs = options.completedTtlMs || 10 * 60_000;
    const active = new Map<string, ActionLease>();
    const activeExecutionIds = new Set<string>();
    const completed = new Map<string, number>();

    const cleanup = (timestamp: string) => {
        const currentTime = Date.parse(timestamp);
        active.forEach((lease, key) => {
            if (Date.parse(lease.expiresAt) <= currentTime) {
                active.delete(key);
                activeExecutionIds.delete(lease.executionId);
            }
        });
        completed.forEach((completedAt, executionId) => {
            if (completedAt + completedTtlMs <= currentTime) completed.delete(executionId);
        });
    };

    return {
        acquire(key: string, executionId: string, operatorId: string): ActionLeaseResult {
            const acquiredAt = now();
            cleanup(acquiredAt);
            const normalizedExecutionId = executionId.trim();
            const normalizedKey = key.trim();
            if (!normalizedExecutionId || !normalizedKey) {
                return { granted: false, reason: 'replay' };
            }
            if (completed.has(normalizedExecutionId) || activeExecutionIds.has(normalizedExecutionId)) {
                return { granted: false, reason: 'replay' };
            }
            if (active.has(normalizedKey)) {
                return { granted: false, reason: 'duplicate' };
            }
            const lease: ActionLease = {
                key: normalizedKey,
                executionId: normalizedExecutionId,
                operatorId: operatorId.trim() || 'local-operator',
                acquiredAt,
                expiresAt: new Date(Date.parse(acquiredAt) + ttlMs).toISOString()
            };
            active.set(normalizedKey, lease);
            activeExecutionIds.add(normalizedExecutionId);
            return { granted: true, lease };
        },
        complete(lease: ActionLease) {
            const current = active.get(lease.key);
            if (current?.executionId === lease.executionId) {
                active.delete(lease.key);
                activeExecutionIds.delete(lease.executionId);
            }
            completed.set(lease.executionId, Date.parse(now()));
        },
        getActive() {
            cleanup(now());
            return [...active.values()];
        }
    };
}
