import { createHash } from 'node:crypto';
import { ipcMain } from 'electron/main';
import {
    KNOWLEDGE_SCHEMA_VERSION,
    type KnowledgeRecord,
    type KnowledgeSourceType
} from '../../features/knowledge/knowledge-contract';
import {
    authorizeKnowledgeRead,
    filterKnowledgeRecords,
    runScopedKnowledgeSearch,
    type KnowledgeAccessContext
} from '../../features/knowledge/knowledge-access';
import {
    ingestKnowledgeSource,
    isSupportedDocument,
    MAX_KNOWLEDGE_SOURCE_LENGTH,
    type KnowledgeAdapterKind,
    type KnowledgeSourceInput
} from '../../features/knowledge/knowledge-ingestion';
import { createKnowledgeStore, type KnowledgeScope } from '../../features/knowledge/knowledge-store';

type ActivityEntry = {
    area: 'monitoring';
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
    detail?: string;
};

interface KnowledgeIpcDependencies {
    getStore: () => ReturnType<typeof createKnowledgeStore>;
    getAccessContext: () => KnowledgeAccessContext;
    recordActivity: (entry: ActivityEntry) => void;
}

interface AddKnowledgeSourcePayload {
    sourceName: string;
    sourceType?: KnowledgeSourceType;
    fileName?: string;
    content: string;
}

const SOURCE_TYPES: KnowledgeSourceType[] = [
    'incident', 'evidence', 'job', 'runbook', 'resolution', 'object-analysis', 'operator-guide', 'integration-history'
];
const SOURCE_NAME = /^[^\u0000-\u001f\u007f]{1,240}$/u;
const FILE_NAME = /^[^\u0000-\u001f\u007f]{1,240}$/u;

function scopeOf(context: KnowledgeAccessContext): KnowledgeScope {
    return { customerScope: context.customerScope, systemScope: context.systemScope };
}

function safeText(value: unknown, max: number) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isAddPayload(value: unknown): value is AddKnowledgeSourcePayload {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Partial<AddKnowledgeSourcePayload>;
    return typeof candidate.sourceName === 'string'
        && SOURCE_NAME.test(candidate.sourceName.trim())
        && (!candidate.fileName || (typeof candidate.fileName === 'string' && FILE_NAME.test(candidate.fileName.trim())))
        && (!candidate.sourceType || SOURCE_TYPES.includes(candidate.sourceType))
        && typeof candidate.content === 'string'
        && candidate.content.length > 0
        && candidate.content.length <= MAX_KNOWLEDGE_SOURCE_LENGTH;
}

function sourceIdFor(context: KnowledgeAccessContext, sourceName: string, fileName: string) {
    return `document:${createHash('sha256')
        .update(`${context.customerScope}\n${context.systemScope}\n${fileName || sourceName}`, 'utf8')
        .digest('hex')
        .slice(0, 32)}`;
}

function sourceTypeFor(value: KnowledgeSourceType | undefined): KnowledgeSourceType {
    return value && SOURCE_TYPES.includes(value) ? value : 'operator-guide';
}

function recordSourceRows(records: readonly KnowledgeRecord[]) {
    return records.filter((record) => record.status !== 'retired');
}

function lexicalSearch(records: KnowledgeRecord[], query: string, limit = 20) {
    const tokens = Array.from(new Set(query.toLocaleLowerCase().match(/[a-z0-9_:#./-]+/g) || []));
    if (!tokens.length) return records.slice(0, Math.min(Math.max(limit, 1), 100));
    return records
        .map((record) => {
            const searchable = [
                record.title,
                record.content,
                record.sourceType,
                record.incidentKind,
                record.qualifiedJob,
                record.subsystem,
                record.queue,
                record.runbookId,
                ...record.objectNames
            ].filter(Boolean).join(' ').toLocaleLowerCase();
            const score = tokens.reduce((total, token) => total + (searchable.includes(token) ? 1 : 0), 0);
            return { record, score };
        })
        .filter((item) => item.score > 0 && item.record.status !== 'retired' && item.record.status !== 'blocked')
        .sort((left, right) => right.score - left.score || right.record.observedAt.localeCompare(left.record.observedAt))
        .slice(0, Math.min(Math.max(limit, 1), 100))
        .map((item) => item.record);
}

function searchPack(records: KnowledgeRecord[], query: string, limit?: number) {
    const selected = lexicalSearch(records, query, limit);
    return {
        schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        records: selected,
        citations: selected.map((record) => ({
            id: `citation:${record.id}`,
            recordId: record.id,
            label: record.title,
            sourceRef: record.sourceRef,
            status: record.status,
            observedAt: record.observedAt
        })),
        excluded: [],
        freshness: 'unknown' as const,
        missingEvidence: []
    };
}

function denied(context: KnowledgeAccessContext, permission: string) {
    const decision = authorizeKnowledgeRead(context, permission);
    return { success: false, records: [], excluded: [], error: decision.reason || 'Knowledge access is not available.' };
}

/** Main-process boundary for scoped knowledge reads, ingestion, and maintenance. */
export function registerKnowledgeIpc(dependencies: KnowledgeIpcDependencies) {
    const context = () => dependencies.getAccessContext();
    const store = () => dependencies.getStore();

    ipcMain.handle('get-knowledge-library', async () => {
        const current = context();
        const decision = authorizeKnowledgeRead(current);
        if (!decision.allowed) {
            dependencies.recordActivity({ area: 'monitoring', level: 'warning', message: 'Knowledge library access denied.' });
            return { success: false, records: [], excluded: [], error: decision.reason };
        }
        const records = await store().list(scopeOf(current));
        const filtered = filterKnowledgeRecords(recordSourceRows(records), current);
        return { success: true, records: filtered.records, excluded: filtered.excluded, stats: await store().getStats(scopeOf(current)) };
    });

    ipcMain.handle('search-knowledge', async (_event, query: unknown, limit?: unknown) => {
        const current = context();
        const decision = authorizeKnowledgeRead(current);
        if (!decision.allowed) return denied(current, 'read');
        const requested = safeText(query, 500);
        if (!requested) return { success: true, records: [], excluded: [] };
        const candidates = await store().list(scopeOf(current));
        const result = await runScopedKnowledgeSearch(candidates, current, (records) => searchPack(records, requested, Number(limit) || 20));
        if (!result.success) {
            dependencies.recordActivity({ area: 'monitoring', level: 'warning', message: 'Knowledge search denied or unavailable.' });
            return { success: false, records: [], excluded: result.excluded, error: result.error };
        }
        return { success: true, records: recordSourceRows(result.contextPack?.records || []), excluded: result.excluded };
    });

    ipcMain.handle('get-knowledge-record', async (_event, recordId: unknown) => {
        const current = context();
        if (!authorizeKnowledgeRead(current).allowed) return denied(current, 'read');
        const record = await store().get(safeText(recordId, 240));
        const filtered = filterKnowledgeRecords(record ? [record] : [], current);
        if (!filtered.decision.allowed || !filtered.records[0]) {
            return { success: false, error: filtered.decision.reason || 'The selected knowledge source is no longer available.' };
        }
        const sourceRecords = (await store().list(scopeOf(current))).filter((item) => item.sourceRef.id === filtered.records[0].sourceRef.id);
        return { success: true, record: filtered.records[0], history: filterKnowledgeRecords(sourceRecords, current).records };
    });

    ipcMain.handle('add-knowledge-source', async (_event, payload: unknown) => {
        const current = context();
        const decision = authorizeKnowledgeRead(current, 'investigate');
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge changes require investigation access.' };
        if (!isAddPayload(payload)) return { success: false, error: `Enter a supported source with no more than ${MAX_KNOWLEDGE_SOURCE_LENGTH} characters.` };
        const sourceName = safeText(payload.sourceName, 240);
        const fileName = safeText(payload.fileName, 240);
        if (fileName && !isSupportedDocument(fileName)) return { success: false, error: 'This document type is not supported yet. Use a text, Markdown, JSON, CL, RPGLE, SQL, or CSV file.' };
        const input: KnowledgeSourceInput = {
            adapter: 'customer-document' satisfies KnowledgeAdapterKind,
            sourceId: sourceIdFor(current, sourceName, fileName),
            sourceName,
            sourceKind: 'file',
            sourceLocator: fileName ? `local://${fileName}` : 'local://knowledge-entry.txt',
            sourceType: sourceTypeFor(payload.sourceType),
            content: payload.content,
            customerScope: current.customerScope,
            systemScope: current.systemScope,
            operational: sourceTypeFor(payload.sourceType) !== 'operator-guide',
            permissions: ['read', 'investigate'],
            confidence: 'medium',
            status: 'observed',
            redactionProfile: 'ibmi-default'
        };
        try {
            const result = await ingestKnowledgeSource(store(), input);
            dependencies.recordActivity({ area: 'monitoring', level: 'success', message: 'Knowledge source saved.', detail: `source=${result.sourceId}` });
            return { success: true, result, stats: await store().getStats(scopeOf(current)) };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to save the knowledge source.';
            dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Knowledge source save failed.', detail: `source=${input.sourceId} | ${message}` });
            return { success: false, error: message };
        }
    });

    ipcMain.handle('delete-knowledge-record', async (_event, recordId: unknown) => {
        const current = context();
        const decision = authorizeKnowledgeRead(current, 'investigate');
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge changes require investigation access.' };
        const selected = await store().get(safeText(recordId, 240));
        const filtered = filterKnowledgeRecords(selected ? [selected] : [], current, 'investigate');
        if (!filtered.records[0]) return { success: false, error: 'The selected knowledge source is no longer available.' };
        const sourceId = filtered.records[0].sourceRef.id;
        const sourceRecords = (await store().list(scopeOf(current))).filter((record) => record.sourceRef.id === sourceId);
        for (const record of sourceRecords) await store().delete(record.id);
        dependencies.recordActivity({ area: 'monitoring', level: 'success', message: 'Knowledge source deleted.', detail: `source=${sourceId}` });
        return { success: true, deletedCount: sourceRecords.length, stats: await store().getStats(scopeOf(current)) };
    });

    ipcMain.handle('reindex-knowledge', async () => {
        const current = context();
        const decision = authorizeKnowledgeRead(current, 'investigate');
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge maintenance requires investigation access.' };
        const scope = scopeOf(current);
        const records = await store().list(scope);
        await store().markReindex(scope);
        await store().completeReindex(records.map((record) => record.id));
        dependencies.recordActivity({ area: 'monitoring', level: 'success', message: 'Knowledge index refreshed.', detail: `records=${records.length}` });
        return { success: true, stats: await store().getStats(scope) };
    });

    ipcMain.handle('get-knowledge-stats', async () => {
        const current = context();
        const decision = authorizeKnowledgeRead(current);
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge access is not available.' };
        return { success: true, stats: await store().getStats(scopeOf(current)) };
    });
}
