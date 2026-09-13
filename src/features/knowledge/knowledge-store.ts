import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
    transitionKnowledgeStatus,
    validateKnowledgeRecord,
    type KnowledgeRecord,
    type KnowledgeStatus
} from './knowledge-contract';

export const KNOWLEDGE_STORE_SCHEMA_VERSION = 1;

export interface KnowledgeScope {
    customerScope: string;
    systemScope: string;
}

export type KnowledgeStoreState = 'empty' | 'ready' | 'rebuilding' | 'degraded' | 'unavailable';

export interface KnowledgeStoreStats {
    state: KnowledgeStoreState;
    recordCount: number;
    byteCount: number;
    oldestObservedAt: string | null;
    newestObservedAt: string | null;
    pendingIndexing: number;
    lastReindexedAt: string | null;
    scope?: KnowledgeScope;
}

export interface KnowledgeUpsertResult {
    record: KnowledgeRecord;
    inserted: boolean;
    replaced: boolean;
    duplicate: boolean;
}

export interface KnowledgeDeleteResult {
    deleted: boolean;
    recordId: string;
}

export interface KnowledgePurgeResult {
    deletedCount: number;
    deletedIds: string[];
    stats: KnowledgeStoreStats;
}

export interface KnowledgeSearchOptions extends KnowledgeScope {
    query: string;
    limit?: number;
}

interface KnowledgeSearchEntry {
    recordId: string;
    text: string;
}

interface KnowledgeStoreFile {
    schemaVersion: typeof KNOWLEDGE_STORE_SCHEMA_VERSION;
    records: KnowledgeRecord[];
    searchEntries: KnowledgeSearchEntry[];
    pendingIndexing: string[];
    lastReindexedAt?: string;
}

interface StoreState {
    records: Map<string, KnowledgeRecord>;
    searchEntries: Map<string, KnowledgeSearchEntry>;
    pendingIndexing: Set<string>;
    lastReindexedAt: string | null;
    status: 'ready' | 'degraded' | 'unavailable';
    byteCount: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function emptyState(): StoreState {
    return {
        records: new Map(),
        searchEntries: new Map(),
        pendingIndexing: new Set(),
        lastReindexedAt: null,
        status: 'ready',
        byteCount: 0
    };
}

function validDate(value: string) {
    return ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}

function normalizeScope(scope: KnowledgeScope): KnowledgeScope {
    const customerScope = String(scope?.customerScope || '').trim();
    const systemScope = String(scope?.systemScope || '').trim();
    if (!customerScope || !systemScope) throw new Error('Customer and IBM i system scope are required.');
    return { customerScope, systemScope };
}

function inScope(record: KnowledgeRecord, scope: KnowledgeScope) {
    return record.customerScope === scope.customerScope && record.systemScope === scope.systemScope;
}

function searchText(record: KnowledgeRecord) {
    return [
        record.title,
        record.content,
        record.sourceType,
        record.incidentKind,
        record.qualifiedJob,
        record.subsystem,
        record.queue,
        record.runbookId,
        ...record.objectNames,
        record.environment?.ibmiRelease,
        record.environment?.ptfLevel,
        record.environment?.jobType,
        record.environment?.subsystem
    ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function buildSearchEntry(record: KnowledgeRecord): KnowledgeSearchEntry {
    return { recordId: record.id, text: searchText(record) };
}

function tokenize(value: string) {
    return Array.from(new Set(value.toLocaleLowerCase().match(/[a-z0-9_:#./-]+/g) || []));
}

function recordBytes(record: KnowledgeRecord) {
    return Buffer.byteLength(JSON.stringify(record), 'utf8');
}

/** Small local store for rebuildable knowledge records and the offline lexical index. */
export function createKnowledgeStore(getDataPath: () => string) {
    const rootPath = () => path.join(getDataPath(), 'imonitor-knowledge');
    const filePath = () => path.join(rootPath(), 'knowledge-store.json');
    let state = emptyState();
    let loaded = false;
    let loadPromise: Promise<void> | null = null;
    let writeQueue = Promise.resolve();

    function enqueue<T>(operation: () => Promise<T>) {
        const run = writeQueue.then(operation, operation);
        writeQueue = run.then(() => undefined, () => undefined);
        return run;
    }

    function rebuildSearchEntries() {
        state.searchEntries = new Map(Array.from(state.records.values()).map((record) => [record.id, buildSearchEntry(record)]));
    }

    async function load() {
        if (loaded) return;
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            try {
                const content = await fs.readFile(filePath(), 'utf8');
                const parsed = JSON.parse(content) as Partial<KnowledgeStoreFile>;
                if (parsed.schemaVersion !== KNOWLEDGE_STORE_SCHEMA_VERSION || !Array.isArray(parsed.records)) {
                    throw new Error('Unsupported knowledge store format.');
                }
                const next = emptyState();
                parsed.records.forEach((candidate) => {
                    const validation = validateKnowledgeRecord(candidate);
                    if (validation.valid && validation.value) next.records.set(validation.value.id, validation.value);
                    else next.status = 'degraded';
                });
                next.pendingIndexing = new Set(Array.isArray(parsed.pendingIndexing)
                    ? parsed.pendingIndexing.filter((id): id is string => typeof id === 'string' && next.records.has(id))
                    : []);
                next.lastReindexedAt = typeof parsed.lastReindexedAt === 'string' && validDate(parsed.lastReindexedAt)
                    ? parsed.lastReindexedAt
                    : null;
                state = next;
                rebuildSearchEntries();
                state.byteCount = Buffer.byteLength(content, 'utf8');
            } catch (error) {
                if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
                    state = emptyState();
                } else if (['EACCES', 'EPERM', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code || '')) {
                    state = emptyState();
                    state.status = 'unavailable';
                } else {
                    state = emptyState();
                    state.status = 'degraded';
                }
            } finally {
                loaded = true;
                loadPromise = null;
            }
        })();
        return loadPromise;
    }

    async function persist() {
        const payload: KnowledgeStoreFile = {
            schemaVersion: KNOWLEDGE_STORE_SCHEMA_VERSION,
            records: Array.from(state.records.values()),
            searchEntries: Array.from(state.searchEntries.values()),
            pendingIndexing: Array.from(state.pendingIndexing),
            lastReindexedAt: state.lastReindexedAt || undefined
        };
        const content = JSON.stringify(payload, null, 2);
        const target = filePath();
        const temporary = `${target}.tmp`;
        try {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(temporary, content, 'utf8');
            await fs.rename(temporary, target);
            state.byteCount = Buffer.byteLength(content, 'utf8');
            state.status = 'ready';
        } catch (error) {
            await fs.rm(temporary, { force: true }).catch(() => undefined);
            state.status = 'degraded';
            throw error;
        }
    }

    function stats(scope?: KnowledgeScope): KnowledgeStoreStats {
        const selected = scope
            ? Array.from(state.records.values()).filter((record) => inScope(record, scope))
            : Array.from(state.records.values());
        const timestamps = selected.map((record) => record.observedAt).sort();
        const byteCount = scope ? selected.reduce((total, record) => total + recordBytes(record), 0) : state.byteCount;
        const stateValue: KnowledgeStoreState = state.status === 'degraded'
            ? 'degraded'
            : state.status === 'unavailable'
                ? 'unavailable'
                : state.pendingIndexing.size
                    ? 'rebuilding'
                    : selected.length
                        ? 'ready'
                        : 'empty';
        return {
            state: stateValue,
            recordCount: selected.length,
            byteCount,
            oldestObservedAt: timestamps[0] || null,
            newestObservedAt: timestamps[timestamps.length - 1] || null,
            pendingIndexing: scope
                ? selected.filter((record) => state.pendingIndexing.has(record.id)).length
                : state.pendingIndexing.size,
            lastReindexedAt: state.lastReindexedAt,
            scope
        };
    }

    async function ensureLoaded() {
        await load();
    }

    return {
        getRootPath: rootPath,
        async get(recordId: string) {
            await ensureLoaded();
            return state.records.get(String(recordId || '').trim());
        },
        async list(scope: KnowledgeScope) {
            await ensureLoaded();
            const normalized = normalizeScope(scope);
            return Array.from(state.records.values()).filter((record) => inScope(record, normalized));
        },
        async upsert(candidate: unknown): Promise<KnowledgeUpsertResult> {
            return enqueue(async () => {
                await ensureLoaded();
                const validation = validateKnowledgeRecord(candidate);
                if (!validation.valid || !validation.value) throw new Error(validation.errors[0] || 'Knowledge record is invalid.');
                const incoming = validation.value;
                const duplicate = Array.from(state.records.values()).find((record) => record.contentHash === incoming.contentHash);
                const existing = duplicate || state.records.get(incoming.id);
                const record = duplicate && duplicate.id !== incoming.id ? { ...incoming, id: duplicate.id } : incoming;
                const inserted = !existing;
                const replaced = Boolean(existing);
                if (existing && existing.id !== record.id) state.records.delete(existing.id);
                state.records.set(record.id, record);
                rebuildSearchEntries();
                state.pendingIndexing.add(record.id);
                await persist();
                return { record, inserted, replaced, duplicate: Boolean(duplicate) };
            });
        },
        async retire(recordId: string, now = new Date().toISOString(), reviewer?: string) {
            return enqueue(async () => {
                await ensureLoaded();
                const id = String(recordId || '').trim();
                const record = state.records.get(id);
                if (!record) throw new Error('Knowledge record not found.');
                const next = record.status === 'retired'
                    ? record
                    : transitionKnowledgeStatus(record, 'retired', now, reviewer);
                state.records.set(id, next);
                rebuildSearchEntries();
                state.pendingIndexing.add(id);
                await persist();
                return next;
            });
        },
        async delete(recordId: string): Promise<KnowledgeDeleteResult> {
            return enqueue(async () => {
                await ensureLoaded();
                const id = String(recordId || '').trim();
                const deleted = state.records.delete(id);
                state.searchEntries.delete(id);
                state.pendingIndexing.delete(id);
                if (deleted) await persist();
                return { deleted, recordId: id };
            });
        },
        async purge(scope: KnowledgeScope, before: string): Promise<KnowledgePurgeResult> {
            return enqueue(async () => {
                await ensureLoaded();
                const normalized = normalizeScope(scope);
                if (!validDate(before)) throw new Error('Knowledge purge requires an ISO UTC cutoff.');
                const deletedIds = Array.from(state.records.values())
                    .filter((record) => inScope(record, normalized) && record.observedAt < before)
                    .map((record) => record.id);
                deletedIds.forEach((id) => {
                    state.records.delete(id);
                    state.searchEntries.delete(id);
                    state.pendingIndexing.delete(id);
                });
                if (deletedIds.length) await persist();
                return { deletedCount: deletedIds.length, deletedIds, stats: stats(normalized) };
            });
        },
        async markReindex(scope?: KnowledgeScope) {
            return enqueue(async () => {
                await ensureLoaded();
                const normalized = scope ? normalizeScope(scope) : undefined;
                Array.from(state.records.values())
                    .filter((record) => !normalized || inScope(record, normalized))
                    .forEach((record) => state.pendingIndexing.add(record.id));
                await persist();
                return stats(normalized);
            });
        },
        async completeReindex(recordIds: string[] = [], reindexedAt = new Date().toISOString()) {
            return enqueue(async () => {
                await ensureLoaded();
                if (!validDate(reindexedAt)) throw new Error('Reindex timestamp must be an ISO UTC timestamp.');
                recordIds.forEach((id) => state.pendingIndexing.delete(String(id || '').trim()));
                state.lastReindexedAt = reindexedAt;
                await persist();
                return stats();
            });
        },
        async rebuildIndex(rebuiltAt = new Date().toISOString()) {
            return enqueue(async () => {
                await ensureLoaded();
                if (!validDate(rebuiltAt)) throw new Error('Index rebuild timestamp must be an ISO UTC timestamp.');
                state.status = 'ready';
                rebuildSearchEntries();
                state.pendingIndexing.clear();
                state.lastReindexedAt = rebuiltAt;
                await persist();
                return stats();
            });
        },
        async search(options: KnowledgeSearchOptions) {
            await ensureLoaded();
            const normalized = normalizeScope(options);
            const queryTokens = tokenize(String(options.query || ''));
            if (!queryTokens.length) return [];
            const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
            return Array.from(state.searchEntries.values())
                .map((entry) => {
                    const record = state.records.get(entry.recordId);
                    if (!record || !inScope(record, normalized) || ['retired', 'blocked'].includes(record.status)) return null;
                    const score = queryTokens.reduce((total, token) => total + (entry.text.includes(token) ? 1 : 0), 0);
                    return score ? { record, score } : null;
                })
                .filter((item): item is { record: KnowledgeRecord; score: number } => Boolean(item))
                .sort((left, right) => right.score - left.score || right.record.observedAt.localeCompare(left.record.observedAt))
                .slice(0, limit)
                .map(({ record }) => record);
        },
        async getStats(scope?: KnowledgeScope) {
            await ensureLoaded();
            return stats(scope ? normalizeScope(scope) : undefined);
        },
        async flush() {
            await writeQueue;
        },
    };
}
