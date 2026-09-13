import { redactSensitiveText } from './knowledge-ingestion';
import {
    filterKnowledgeRecords,
    type KnowledgeAccessContext,
    type KnowledgeExclusion
} from './knowledge-access';
import type { KnowledgeRecord } from './knowledge-contract';
import type { KnowledgeScope, KnowledgeStoreStats } from './knowledge-store';

export type KnowledgeIndexBackend = 'local' | 'qdrant' | 'pgvector';
export type KnowledgeIndexHealthState = 'ready' | 'degraded' | 'unavailable' | 'disabled';

export interface StoredKnowledgeIndexSettings {
    backend: KnowledgeIndexBackend;
    endpoint: string;
    collection: string;
    encryptedApiKey: string;
}

export interface KnowledgeIndexSettings {
    backend: KnowledgeIndexBackend;
    endpoint: string;
    collection: string;
    apiKeyConfigured: boolean;
}

export interface KnowledgeIndexCatalogEntry {
    backend: KnowledgeIndexBackend;
    label: string;
    description: string;
    available: boolean;
}

export interface KnowledgeIndexHealth {
    backend: KnowledgeIndexBackend;
    state: KnowledgeIndexHealthState;
    message: string;
    checkedAt: string;
    fallbackUsed?: boolean;
}

export interface KnowledgeIndexSearchRequest extends KnowledgeScope {
    query: string;
    limit?: number;
}

export interface KnowledgeIndexStats {
    backend: KnowledgeIndexBackend;
    local: KnowledgeStoreStats;
    health: KnowledgeIndexHealth;
    fallbackUsed: boolean;
}

export interface KnowledgeIndexGateway {
    readonly settings: KnowledgeIndexSettings;
    health(): Promise<KnowledgeIndexHealth>;
    upsert(records: readonly KnowledgeRecord[]): Promise<void>;
    delete(recordIds: readonly string[]): Promise<void>;
    search(request: KnowledgeIndexSearchRequest, context: KnowledgeAccessContext): Promise<KnowledgeIndexSearchResult>;
    rebuild(scope: KnowledgeScope): Promise<void>;
    stats(scope: KnowledgeScope): Promise<KnowledgeIndexStats>;
}

export interface KnowledgeIndexSearchResult {
    records: KnowledgeRecord[];
    excluded: KnowledgeExclusion[];
    health: KnowledgeIndexHealth;
    fallbackUsed: boolean;
}

export interface KnowledgeIndexAdapter {
    readonly backend: KnowledgeIndexBackend;
    health(): Promise<KnowledgeIndexHealth>;
    upsert(records: readonly KnowledgeRecord[]): Promise<void>;
    delete(recordIds: readonly string[]): Promise<void>;
    search(request: KnowledgeIndexSearchRequest): Promise<readonly unknown[]>;
    rebuild(scope: KnowledgeScope): Promise<void>;
    stats(scope: KnowledgeScope): Promise<KnowledgeStoreStats>;
}

export interface KnowledgeProviderMetadata {
    customerScope: string;
    systemScope: string;
    sourceType: KnowledgeRecord['sourceType'];
    sourceRefId: string;
    contentHash: string;
}

/** Provider payloads contain redacted content and only filterable scope metadata. */
export interface ProviderKnowledgeRecord {
    id: string;
    content: string;
    metadata: KnowledgeProviderMetadata;
    record: KnowledgeRecord;
}

export interface ExternalKnowledgeIndexAdapter {
    readonly backend: 'qdrant' | 'pgvector';
    health(): Promise<KnowledgeIndexHealth>;
    upsert(records: readonly ProviderKnowledgeRecord[]): Promise<void>;
    delete(recordIds: readonly string[]): Promise<void>;
    search(request: KnowledgeIndexSearchRequest): Promise<readonly unknown[]>;
    rebuild(scope: KnowledgeScope): Promise<void>;
    stats(scope: KnowledgeScope): Promise<KnowledgeStoreStats>;
}

export const DEFAULT_STORED_KNOWLEDGE_INDEX_SETTINGS: StoredKnowledgeIndexSettings = {
    backend: 'local',
    endpoint: '',
    collection: 'imonitor-knowledge',
    encryptedApiKey: ''
};

export const KNOWLEDGE_INDEX_CATALOG: KnowledgeIndexCatalogEntry[] = [
    {
        backend: 'local',
        label: 'Local lexical index',
        description: 'Private on this machine and available offline for exact IBM i identifiers.',
        available: true
    },
    {
        backend: 'qdrant',
        label: 'Qdrant vector index',
        description: 'Semantic retrieval for a customer-managed Qdrant service.',
        available: false
    },
    {
        backend: 'pgvector',
        label: 'Postgres + pgvector',
        description: 'Semantic retrieval for a customer-managed PostgreSQL service.',
        available: false
    }
];

const BACKENDS: KnowledgeIndexBackend[] = ['local', 'qdrant', 'pgvector'];

function text(value: unknown, max: number) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function backend(value: unknown): KnowledgeIndexBackend {
    return BACKENDS.includes(value as KnowledgeIndexBackend) ? value as KnowledgeIndexBackend : 'local';
}

export function normalizeStoredKnowledgeIndexSettings(value: unknown): StoredKnowledgeIndexSettings {
    const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
        backend: backend(candidate.backend),
        endpoint: text(candidate.endpoint, 500),
        collection: text(candidate.collection, 120) || DEFAULT_STORED_KNOWLEDGE_INDEX_SETTINGS.collection,
        encryptedApiKey: text(candidate.encryptedApiKey, 20_000)
    };
}

export function normalizeKnowledgeIndexSettings(value: unknown): KnowledgeIndexSettings {
    const stored = normalizeStoredKnowledgeIndexSettings(value);
    return {
        backend: stored.backend,
        endpoint: stored.endpoint,
        collection: stored.collection,
        apiKeyConfigured: Boolean(stored.encryptedApiKey)
    };
}

export function toStoredKnowledgeIndexSettings(
    candidate: Partial<KnowledgeIndexSettings> & { apiKey?: string } | undefined,
    previous: StoredKnowledgeIndexSettings,
    protectSecret: (value: string) => string
) {
    const normalized = normalizeKnowledgeIndexSettings({
        ...previous,
        ...(candidate || {})
    });
    const apiKey = typeof candidate?.apiKey === 'string' ? candidate.apiKey.trim() : '';
    return {
        backend: normalized.backend,
        endpoint: normalized.endpoint,
        collection: normalized.collection,
        encryptedApiKey: apiKey ? protectSecret(apiKey) : previous.encryptedApiKey
    } satisfies StoredKnowledgeIndexSettings;
}

export function getKnowledgeIndexCatalog() {
    return KNOWLEDGE_INDEX_CATALOG.map((entry) => ({ ...entry }));
}

function readyHealth(backendId: KnowledgeIndexBackend, message: string): KnowledgeIndexHealth {
    return {
        backend: backendId,
        state: 'ready',
        message,
        checkedAt: new Date().toISOString()
    };
}

/** Adapts the durable local JSON store to the common index contract. */
export function createLocalKnowledgeIndexAdapter(store: {
    getStats(scope?: KnowledgeScope): Promise<KnowledgeStoreStats>;
    list(scope: KnowledgeScope): Promise<KnowledgeRecord[]>;
    upsert(record: KnowledgeRecord): Promise<unknown>;
    delete(recordId: string): Promise<unknown>;
    search(options: KnowledgeIndexSearchRequest): Promise<KnowledgeRecord[]>;
    markReindex(scope?: KnowledgeScope): Promise<unknown>;
    completeReindex(recordIds?: string[], reindexedAt?: string): Promise<unknown>;
}) : KnowledgeIndexAdapter {
    return {
        backend: 'local',
        async health() {
            try {
                const stats = await store.getStats();
                if (stats.state === 'unavailable') {
                    return { backend: 'local', state: 'unavailable', message: 'Local knowledge storage is unavailable.', checkedAt: new Date().toISOString() };
                }
                return readyHealth('local', stats.state === 'degraded'
                    ? 'Local lexical retrieval is degraded.'
                    : 'Local lexical retrieval is ready.');
            } catch {
                return {
                    backend: 'local', state: 'unavailable',
                    message: 'Local knowledge storage is unavailable.', checkedAt: new Date().toISOString()
                };
            }
        },
        async upsert(records) {
            for (const record of records) await store.upsert(record);
        },
        async delete(recordIds) {
            for (const recordId of recordIds) await store.delete(recordId);
        },
        search: (request) => store.search(request),
        async rebuild(scope) {
            const records = await store.list(scope);
            await store.markReindex(scope);
            await store.completeReindex(records.map((record) => record.id));
        },
        stats: (scope) => store.getStats(scope)
    };
}

function providerRecord(record: KnowledgeRecord): ProviderKnowledgeRecord {
    const content = redactSensitiveText(record.content);
    return {
        id: record.id,
        content,
        metadata: {
            customerScope: record.customerScope,
            systemScope: record.systemScope,
            sourceType: record.sourceType,
            sourceRefId: record.sourceRef.id,
            contentHash: record.contentHash
        },
        record: { ...record, title: redactSensitiveText(record.title), content }
    };
}

function providerRecords(records: readonly KnowledgeRecord[]) {
    return records.map(providerRecord);
}

function providerRecordToKnowledgeRecord(value: unknown): KnowledgeRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The provider returned a malformed knowledge record.');
    const candidate = value as Partial<ProviderKnowledgeRecord>;
    if (typeof candidate.id !== 'string' || typeof candidate.content !== 'string' || !candidate.metadata || !candidate.record) {
        throw new Error('The provider returned a malformed knowledge record.');
    }
    if (candidate.id !== candidate.record.id || candidate.content !== candidate.record.content) {
        throw new Error('The provider record content does not match its indexed record.');
    }
    if (candidate.metadata.customerScope !== candidate.record.customerScope
        || candidate.metadata.systemScope !== candidate.record.systemScope
        || candidate.metadata.sourceRefId !== candidate.record.sourceRef.id
        || candidate.metadata.contentHash !== candidate.record.contentHash) {
        throw new Error('The provider record metadata does not match its indexed record.');
    }
    return candidate.record;
}

interface KnowledgeIndexGatewayDependencies {
    local: KnowledgeIndexAdapter;
    config: KnowledgeIndexSettings | StoredKnowledgeIndexSettings;
    external?: ExternalKnowledgeIndexAdapter;
}

/** Routes retrieval to an approved adapter and keeps local lexical fallback available. */
export function createKnowledgeIndexGateway(dependencies: KnowledgeIndexGatewayDependencies) {
    const config = normalizeKnowledgeIndexSettings(dependencies.config);

    async function localSearch(request: KnowledgeIndexSearchRequest, context: KnowledgeAccessContext, fallbackUsed = false): Promise<KnowledgeIndexSearchResult> {
        const candidates = await dependencies.local.search(request);
        const filtered = filterKnowledgeRecords(candidates, context);
        return {
            records: filtered.records,
            excluded: filtered.excluded,
            health: {
                ...(await dependencies.local.health()),
                fallbackUsed
            },
            fallbackUsed
        };
    }

    async function degradedSearch(request: KnowledgeIndexSearchRequest, context: KnowledgeAccessContext, message: string) {
        const result = await localSearch(request, context, true);
        return {
            ...result,
            health: {
                ...result.health,
                backend: config.backend,
                state: 'degraded' as const,
                message,
                fallbackUsed: true
            }
        };
    }

    async function gatewayHealth(): Promise<KnowledgeIndexHealth> {
        if (config.backend === 'local') return dependencies.local.health();
        if (!dependencies.external || dependencies.external.backend !== config.backend) {
            return {
                backend: config.backend, state: 'disabled' as const,
                message: `${config.backend} is not installed. Local lexical fallback is active.`,
                checkedAt: new Date().toISOString(), fallbackUsed: true
            };
        }
        try {
            return await dependencies.external.health();
        } catch {
            return {
                backend: config.backend, state: 'degraded' as const,
                message: `${config.backend} is unavailable. Local lexical fallback is active.`,
                checkedAt: new Date().toISOString(), fallbackUsed: true
            };
        }
    }

    return {
        settings: config,
        health: gatewayHealth,
        async upsert(records: readonly KnowledgeRecord[]) {
            await dependencies.local.upsert(records);
            if (config.backend !== 'local' && dependencies.external?.backend === config.backend) {
                try {
                    await dependencies.external.upsert(providerRecords(records));
                } catch {
                    // Local storage remains authoritative while an external provider is unavailable.
                }
            }
        },
        async delete(recordIds: readonly string[]) {
            await dependencies.local.delete(recordIds);
            if (config.backend !== 'local' && dependencies.external?.backend === config.backend) {
                try { await dependencies.external.delete(recordIds); } catch { /* local remains usable */ }
            }
        },
        async search(request: KnowledgeIndexSearchRequest, context: KnowledgeAccessContext): Promise<KnowledgeIndexSearchResult> {
            if (config.backend === 'local') return localSearch(request, context);
            if (!dependencies.external || dependencies.external.backend !== config.backend) {
                return degradedSearch(request, context, `${config.backend} is not installed. Local lexical fallback is active.`);
            }
            try {
                const returned = await dependencies.external.search(request);
                const records = returned.map(providerRecordToKnowledgeRecord);
                const filtered = filterKnowledgeRecords(records, context);
                if (filtered.excluded.length) throw new Error('The provider returned out-of-scope knowledge.');
                return {
                    records: filtered.records,
                    excluded: filtered.excluded,
                    health: { ...(await dependencies.external.health()), fallbackUsed: false },
                    fallbackUsed: false
                };
            } catch {
                return degradedSearch(request, context, `${config.backend} retrieval failed. Local lexical fallback is active.`);
            }
        },
        async rebuild(scope: KnowledgeScope) {
            await dependencies.local.rebuild(scope);
            if (config.backend !== 'local' && dependencies.external?.backend === config.backend) {
                try { await dependencies.external.rebuild(scope); } catch { /* local rebuild is still complete */ }
            }
        },
        async stats(scope: KnowledgeScope): Promise<KnowledgeIndexStats> {
            const local = await dependencies.local.stats(scope);
            return {
                backend: config.backend,
                local,
                health: await gatewayHealth(),
                fallbackUsed: config.backend !== 'local'
            };
        }
    };
}
