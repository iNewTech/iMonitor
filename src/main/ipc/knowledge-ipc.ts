import { createHash } from 'node:crypto';
import { ipcMain } from 'electron/main';
import { writeFile } from 'node:fs/promises';
import { type SaveDialogOptions, type SaveDialogReturnValue } from 'electron/main';
import * as path from 'node:path';
import { type KnowledgeRecord, type KnowledgeSourceType } from '../../features/knowledge/knowledge-contract';
import {
    authorizeKnowledgeRead,
    filterKnowledgeRecords,
    type KnowledgeAccessDecision,
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
import { buildKnowledgeRetrievalQuery, rankKnowledgeRecords } from '../../features/knowledge/knowledge-retrieval';

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
    recordObservability?: {
        audit: (category: 'ingestion' | 'retrieval' | 'purge' | 'export' | 'failure', name: string, outcome?: 'success' | 'failure' | 'denied' | 'warning', attributes?: Record<string, string | number | boolean>) => void;
    };
    showSaveDialog?: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
    getDownloadsPath?: () => string;
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

function scopeOf(context: Pick<KnowledgeAccessContext, 'customerScope' | 'systemScope'>): KnowledgeScope {
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

type KnowledgeExportIdentity = Pick<KnowledgeAccessContext, 'customerScope' | 'systemScope' | 'operatorId' | 'identity'>;

function authorizeKnowledgeExport(current: KnowledgeAccessContext, original: KnowledgeExportIdentity): KnowledgeAccessDecision {
    if (current.customerScope !== original.customerScope
        || current.systemScope !== original.systemScope
        || current.operatorId !== original.operatorId
        || current.identity !== original.identity) {
        return { allowed: false, reason: 'Knowledge export canceled because the active scope or operator identity changed.' };
    }
    return authorizeKnowledgeRead(current);
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
        const retrievalQuery = buildKnowledgeRetrievalQuery({
            ...scopeOf(current),
            operatorId: current.operatorId,
            operatorPermissions: current.operatorPermissions,
            query: requested,
            limit: Number(limit) || 20
        });
        const result = await index().search(retrievalQuery.indexRequest, current);
        const retrieval = rankKnowledgeRecords(
            result.records,
            retrievalQuery,
            result.health.backend === 'local' || result.fallbackUsed ? 'lexical' : 'semantic'
        );
        dependencies.recordObservability?.audit('retrieval', 'knowledge-search', 'success', { returned: retrieval.matches.length, fallback: result.fallbackUsed });
        return {
            success: true,
            records: recordSourceRows(retrieval.matches.map((match) => match.record)),
            excluded: result.excluded,
            health: result.health,
            fallbackUsed: result.fallbackUsed,
            citations: retrieval.citations,
            relevanceReasons: retrieval.matches.map((match) => ({
                recordId: match.record.id,
                reasons: match.reasons,
                reviewState: match.reviewState,
                source: match.source
            })),
            noMatchReason: retrieval.noMatchReason
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
            dependencies.recordObservability?.audit('ingestion', 'knowledge-source', 'success', { chunks: result.records.length, redacted: result.redacted });
            return { success: true, result, stats: await store().getStats(scopeOf(current)) };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to save the knowledge source.';
            dependencies.recordActivity({ area: 'monitoring', level: 'error', message: 'Knowledge source save failed.', detail: `source=${input.sourceId} | ${message}` });
            dependencies.recordObservability?.audit('failure', 'knowledge-source', 'failure');
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
        dependencies.recordObservability?.audit('purge', 'knowledge-source', 'success', { deleted: sourceRecords.length });
        return { success: true, deletedCount: sourceRecords.length, stats: await store().getStats(scopeOf(current)) };
    });

    ipcMain.handle('purge-knowledge', async (_event, payload: unknown) => {
        const current = context();
        const decision = authorizeKnowledgeRead(current, 'investigate');
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge purge requires investigation access.' };
        const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
        if (input.confirmed !== true) return { success: false, error: 'Knowledge purge requires explicit confirmation.' };
        const before = typeof input.before === 'string' ? input.before : new Date(Date.now() - 30 * 86400000).toISOString();
        const expectedContext = { ...scopeOf(current), operatorId: current.operatorId, identity: current.identity };
        try {
            const result = await store().purge(scopeOf(expectedContext), before);
            await index().delete(result.deletedIds);
            dependencies.recordActivity({ area: 'monitoring', level: 'success', message: 'Knowledge records purged.', detail: `deleted=${result.deletedCount}` });
            dependencies.recordObservability?.audit('purge', 'knowledge-records', 'success', { deleted: result.deletedCount });
            return { success: true, ...result, expectedContext, stats: await index().stats(scopeOf(expectedContext)) };
        } catch (error) {
            dependencies.recordObservability?.audit('failure', 'knowledge-purge', 'failure');
            return { success: false, error: error instanceof Error ? error.message : 'Unable to purge knowledge records.' };
        }
    });

    ipcMain.handle('export-knowledge', async () => {
        const current = context();
        const decision = authorizeKnowledgeRead(current);
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge export requires read access.' };
        if (!dependencies.showSaveDialog || !dependencies.getDownloadsPath) return { success: false, error: 'Export is unavailable in this environment.' };
        const original: KnowledgeExportIdentity = {
            ...scopeOf(current), operatorId: current.operatorId, identity: current.identity
        };
        try {
            const selection = await dependencies.showSaveDialog({
                title: 'Export scoped knowledge',
                defaultPath: path.join(dependencies.getDownloadsPath(), 'imonitor-knowledge.json'),
                filters: [{ name: 'JSON report', extensions: ['json'] }]
            });
            if (selection.canceled || !selection.filePath) return { success: false, canceled: true };
            const afterDialog = authorizeKnowledgeExport(context(), original);
            if (!afterDialog.allowed) return { success: false, error: afterDialog.reason };

            const candidates = await store().list(scopeOf(original));
            const latest = context();
            const beforeWrite = authorizeKnowledgeExport(latest, original);
            if (!beforeWrite.allowed) return { success: false, error: beforeWrite.reason };
            const filtered = filterKnowledgeRecords(recordSourceRows(candidates), latest);
            if (!filtered.decision.allowed) return { success: false, error: filtered.decision.reason };
            const records = filtered.records;
            await writeFile(selection.filePath, `${JSON.stringify({ exportedAt: new Date().toISOString(), scope: scopeOf(original), records }, null, 2)}\n`, 'utf8');
            dependencies.recordObservability?.audit('export', 'knowledge-records', 'success', { records: records.length });
            return { success: true, filePath: selection.filePath, recordCount: records.length };
        } catch (error) {
            dependencies.recordObservability?.audit('failure', 'knowledge-export', 'failure');
            return { success: false, error: error instanceof Error ? error.message : 'Unable to export knowledge records.' };
        }
    });

    ipcMain.handle('reindex-knowledge', async () => {
        const current = context();
        const decision = authorizeKnowledgeRead(current, 'investigate');
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge maintenance requires investigation access.' };
        const scope = scopeOf(current);
        await index().rebuild(scope);
        const records = await store().list(scope);
        dependencies.recordActivity({ area: 'monitoring', level: 'success', message: 'Knowledge index refreshed.', detail: `records=${records.length}` });
        dependencies.recordObservability?.audit('retrieval', 'knowledge-reindex', 'success', { records: records.length });
        return { success: true, stats: await index().stats(scope) };
    });

    ipcMain.handle('get-knowledge-stats', async () => {
        const current = context();
        const decision = authorizeKnowledgeRead(current);
        if (!decision.allowed) return { success: false, error: decision.reason || 'Knowledge access is not available.' };
        return { success: true, stats: await index().stats(scopeOf(current)) };
    });
}
