export interface CollectorSettings {
    enabled: boolean;
    startWithSystem: boolean;
    connectionId: string;
    intervalMs: number;
    retentionDays: number;
    maxStorageMb: number;
}

export const DEFAULT_COLLECTOR_SETTINGS: CollectorSettings = {
    enabled: false,
    startWithSystem: false,
    connectionId: '',
    intervalMs: 5000,
    retentionDays: 30,
    maxStorageMb: 1024
};

export type CollectionCategory = 'monitoring';

export interface CollectionQuery {
    category?: CollectionCategory;
    systemId?: string;
    before?: string;
    after?: string;
}

export interface CollectionInventory {
    rootPath: string;
    recordCount: number;
    byteCount: number;
    oldestAt: string | null;
    newestAt: string | null;
    files: number;
    categories: Record<string, number>;
    systems: Record<string, number>;
}

export interface CollectionPurgePreview extends CollectionInventory {
    matchingRecordCount: number;
    matchingByteCount: number;
}

export interface CollectionHealth {
    collectorStartedAt: string | null;
    lastSuccessfulPollAt: string | null;
    lastSuccessfulWriteAt: string | null;
    consecutiveWriteFailures: number;
    lastError: string | null;
}

export interface CollectorStatus {
    state: 'disabled' | 'stopped' | 'starting' | 'running' | 'degraded';
    settings: CollectorSettings;
    health: CollectionHealth;
    lastError: string | null;
}

export function normalizeCollectorSettings(candidate?: Partial<CollectorSettings> | null): CollectorSettings {
    const value = candidate || {};
    const numberInRange = (input: unknown, fallback: number, min: number, max: number) => {
        const parsed = Number(input);
        return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
    };

    return {
        enabled: Boolean(value.enabled),
        startWithSystem: Boolean(value.startWithSystem),
        connectionId: typeof value.connectionId === 'string' ? value.connectionId.trim() : '',
        intervalMs: numberInRange(value.intervalMs, DEFAULT_COLLECTOR_SETTINGS.intervalMs, 1000, 3600000),
        retentionDays: numberInRange(value.retentionDays, DEFAULT_COLLECTOR_SETTINGS.retentionDays, 1, 3650),
        maxStorageMb: numberInRange(value.maxStorageMb, DEFAULT_COLLECTOR_SETTINGS.maxStorageMb, 1, 102400)
    };
}
