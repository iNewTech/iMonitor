import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ActiveJobRecord } from '../../services/ibmi';
import type {
    CollectionCategory,
    CollectionHealth,
    CollectionInventory,
    CollectionPurgePreview,
    CollectionQuery
} from '../../features/collector/collector-model';
import type { CollectorSettings } from '../../features/collector/collector-model';

interface CollectionContext {
    systemId: string;
    systemLabel: string;
    host: string;
    user: string;
    mode: 'live' | 'dummy';
}

interface CollectionRecord {
    schemaVersion: 1;
    type: 'poll';
    category: CollectionCategory;
    timestamp: string;
    systemId: string;
    systemLabel: string;
    connection: Pick<CollectionContext, 'host' | 'user' | 'mode'>;
    payload: Record<string, unknown>;
}

const emptyHealth = (): CollectionHealth => ({
    collectorStartedAt: null,
    lastSuccessfulPollAt: null,
    lastSuccessfulWriteAt: null,
    consecutiveWriteFailures: 0,
    lastError: null
});

export function createCollectionRuntime(getUserDataPath: () => string) {
    let writeQueue = Promise.resolve();
    let health: CollectionHealth = emptyHealth();

    const rootPath = () => path.join(getUserDataPath(), 'imonitor-collection');
    const safeSegment = (value: string) => value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'system';
    const filePathFor = (systemId: string, timestamp: string) => path.join(
        rootPath(), safeSegment(systemId), 'monitoring', `${timestamp.slice(0, 10)}.jsonl`
    );

    const updateHealth = (next: Partial<CollectionHealth>) => {
        health = { ...health, ...next };
    };

    async function dataFiles() {
        const systems = await fs.readdir(rootPath(), { withFileTypes: true }).catch(() => []);
        const files: string[] = [];
        for (const system of systems) {
            if (!system.isDirectory()) continue;
            const directory = path.join(rootPath(), system.name, 'monitoring');
            const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
            entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
                .forEach((entry) => files.push(path.join(directory, entry.name)));
        }
        return files.sort();
    }

    async function readRecords(filePath: string) {
        const text = await fs.readFile(filePath, 'utf8').catch(() => '');
        return text.split('\n').filter(Boolean).flatMap((line) => {
            try {
                const record = JSON.parse(line) as CollectionRecord;
                return record?.type === 'poll' ? [{ record, line: `${line}\n` }] : [];
            } catch {
                return [];
            }
        });
    }

    const matches = (record: CollectionRecord, query: CollectionQuery) => {
        const timestamp = new Date(record.timestamp).getTime();
        const before = query.before ? new Date(query.before).getTime() : Number.POSITIVE_INFINITY;
        const after = query.after ? new Date(query.after).getTime() : Number.NEGATIVE_INFINITY;
        return (!query.category || record.category === query.category)
            && (!query.systemId || record.systemId === query.systemId)
            && Number.isFinite(timestamp)
            && timestamp < before
            && timestamp >= after;
    };

    const inventoryFor = (records: Array<{ record: CollectionRecord; line: string }>, files: number, root: string): CollectionInventory => {
        const categories: Record<string, number> = {};
        const systems: Record<string, number> = {};
        let byteCount = 0;
        let oldestAt: string | null = null;
        let newestAt: string | null = null;
        records.forEach(({ record, line }) => {
            byteCount += Buffer.byteLength(line, 'utf8');
            categories[record.category] = (categories[record.category] || 0) + 1;
            systems[record.systemId] = (systems[record.systemId] || 0) + 1;
            if (!oldestAt || record.timestamp < oldestAt) oldestAt = record.timestamp;
            if (!newestAt || record.timestamp > newestAt) newestAt = record.timestamp;
        });
        return { rootPath: root, recordCount: records.length, byteCount, oldestAt, newestAt, files, categories, systems };
    };

    async function getInventory(query: CollectionQuery = {}): Promise<CollectionInventory> {
        const files = await dataFiles();
        const records: Array<{ record: CollectionRecord; line: string }> = [];
        let matchingFiles = 0;
        for (const file of files) {
            const fileRecords = (await readRecords(file)).filter(({ record }) => matches(record, query));
            if (fileRecords.length) matchingFiles += 1;
            records.push(...fileRecords);
        }
        return inventoryFor(records, matchingFiles, rootPath());
    }

    async function previewPurge(query: CollectionQuery = {}): Promise<CollectionPurgePreview> {
        const inventory = await getInventory(query);
        return { ...inventory, matchingRecordCount: inventory.recordCount, matchingByteCount: inventory.byteCount };
    }

    async function purge(query: CollectionQuery): Promise<CollectionPurgePreview> {
        await writeQueue;
        const files = await dataFiles();
        const removed: Array<{ record: CollectionRecord; line: string }> = [];
        let changedFiles = 0;
        for (const file of files) {
            const records = await readRecords(file);
            const keep = records.filter(({ record }) => {
                const remove = matches(record, query);
                if (remove) removed.push({ record, line: `${record ? JSON.stringify(record) : ''}\n` });
                return !remove;
            });
            if (keep.length === records.length) continue;
            changedFiles += 1;
            if (keep.length) {
                const temp = `${file}.tmp`;
                await fs.writeFile(temp, keep.map(({ line }) => line).join(''), 'utf8');
                await fs.rename(temp, file);
            } else {
                await fs.rm(file, { force: true });
            }
        }
        if (removed.length) {
            const auditPath = path.join(rootPath(), 'purge-audit.jsonl');
            const previous = await fs.readFile(auditPath, 'utf8').catch(() => '');
            const audit = {
                schemaVersion: 1,
                type: 'purge',
                timestamp: new Date().toISOString(),
                query,
                removedRecords: removed.length,
                removedBytes: removed.reduce((total, item) => total + Buffer.byteLength(item.line), 0),
                previousHash: crypto.createHash('sha256').update(previous).digest('hex')
            };
            await fs.mkdir(rootPath(), { recursive: true });
            await fs.appendFile(auditPath, `${JSON.stringify(audit)}\n`, 'utf8');
        }
        const result = await previewPurge({});
        return {
            ...result,
            files: changedFiles,
            matchingRecordCount: removed.length,
            matchingByteCount: removed.reduce((total, item) => total + Buffer.byteLength(item.line), 0)
        };
    }

    async function enforceRetention(settings: Pick<CollectorSettings, 'retentionDays' | 'maxStorageMb'>) {
        await writeQueue;
        const cutoff = new Date(Date.now() - settings.retentionDays * 86400000).toISOString();
        await purge({ category: 'monitoring', before: cutoff });
        let inventory = await getInventory();
        const limit = settings.maxStorageMb * 1024 * 1024;
        while (inventory.byteCount > limit) {
            const files = await dataFiles();
            if (!files.length) break;
            const records = await readRecords(files[0]);
            if (!records.length) {
                await fs.rm(files[0], { force: true });
                continue;
            }
            const lastTimestamp = records.reduce((latest, item) => item.record.timestamp > latest ? item.record.timestamp : latest, records[0].record.timestamp);
            await purge({ category: 'monitoring', systemId: records[0].record.systemId, before: new Date(new Date(lastTimestamp).getTime() + 1).toISOString() });
            const nextInventory = await getInventory();
            if (nextInventory.byteCount >= inventory.byteCount) break;
            inventory = nextInventory;
        }
        return inventory;
    }

    return {
        getRootPath: rootPath,
        getHealth: () => ({ ...health }),
        markStarted() {
            updateHealth({ collectorStartedAt: new Date().toISOString(), lastError: null });
        },
        async appendPoll(jobs: ActiveJobRecord[], timestamp: string, intervalMs: number, context: CollectionContext) {
            const record: CollectionRecord = {
                schemaVersion: 1,
                type: 'poll',
                category: 'monitoring',
                timestamp,
                systemId: context.systemId,
                systemLabel: context.systemLabel,
                connection: { host: context.host, user: context.user, mode: context.mode },
                payload: { intervalMs, jobs: jobs.map((job) => ({ ...job })) }
            };
            const file = filePathFor(context.systemId, timestamp);
            writeQueue = writeQueue.then(async () => {
                await fs.mkdir(path.dirname(file), { recursive: true });
                await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
                updateHealth({ lastSuccessfulPollAt: timestamp, lastSuccessfulWriteAt: new Date().toISOString(), consecutiveWriteFailures: 0, lastError: null });
            }).catch((error) => {
                updateHealth({ consecutiveWriteFailures: health.consecutiveWriteFailures + 1, lastError: error instanceof Error ? error.message : String(error) });
            });
            return writeQueue;
        },
        getInventory,
        previewPurge,
        purge,
        enforceRetention
    };
}
