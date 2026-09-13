import { createHash } from 'node:crypto';
import { ipcMain } from 'electron/main';
import { type KnowledgeRecord, type KnowledgeSourceType } from '../../features/knowledge/knowledge-contract';
import {
    authorizeKnowledgeRead,
    filterKnowledgeRecords,
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
import { createKnowledgeIndexGateway, createLocalKnowledgeIndexAdapter, type KnowledgeIndexGateway } from '../../features/knowledge/knowledge-index';

type ActivityEntry = {
    area: 'monitoring';
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
    detail?: string;
};

interface KnowledgeIpcDependencies {
    getStore: () => ReturnType<typeof createKnowledgeStore>;
    getIndexGateway?: () => KnowledgeIndexGateway;
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

function denied(context: KnowledgeAccessContext, permission: string) {
    const decision = authorizeKnowledgeRead(context, permission);
    return { success: false, records: [], excluded: [], error: decision.reason || 'Knowledge access is not available.' };
}

/** Main-process boundary for scoped knowledge reads, ingestion, and maintenance. */
export function registerKnowledgeIpc(dependencies: KnowledgeIpcDependencies) {
    const context = () => dependencies.getAccessContext();
    const store = () => dependencies.getStore();
    const index = (): KnowledgeIndexGateway => dependencies.getIndexGateway?.() || createKnowledgeIndexGateway({
        local: createLocalKnowledgeIndexAdapter(store()),
        config: { backend: 'local', endpoint: '', collection: 'imonitor-knowledge', apiKeyConfigured: false }
    });

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
        const result = await index().search({ ...scopeOf(current), query: requested, limit: Number(limit) || 20 }, current);
        return {
            success: true,
            records: recordSourceRows(result.records),
            excluded: result.excluded,
            health: result.health,
            fallbackUsed: result.fallbackUsed
        };
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
            await index().delete(result.retiredRecordIds);
            await index().upsert(result.records);
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
        await index().delete(sourceRecords.map((record) => record.id));
        dependencies.recordActivity({ area: 'monitoring', level: 'success', message: 'Knowledge source deleted.', detail: `source=${sourceId}` });
        return { success: true, deletedCount: sourceRecords.length, stats: await store().getStats(scopeOf(current)) };
    });

    ipcMain.handle('reindex-knowledge', async () => {
        const current = context();
        const decision = authorizeKnowledgeRead(current, 'investigate');
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge maintenance requires investigation access.' };
        const scope = scopeOf(current);
        await index().rebuild(scope);
        const records = await store().list(scope);
        dependencies.recordActivity({ area: 'monitoring', level: 'success', message: 'Knowledge index refreshed.', detail: `records=${records.length}` });
        return { success: true, stats: await index().stats(scope) };
    });

    ipcMain.handle('get-knowledge-stats', async () => {
        const current = context();
        const decision = authorizeKnowledgeRead(current);
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge access is not available.' };
        return { success: true, stats: await index().stats(scopeOf(current)) };
    });
}
