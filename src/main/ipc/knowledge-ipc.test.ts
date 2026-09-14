import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SaveDialogReturnValue } from 'electron/main';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));

import { createKnowledgeStore } from '../../features/knowledge/knowledge-store';
import type { KnowledgeAccessContext } from '../../features/knowledge/knowledge-access';
import type { KnowledgeRecord } from '../../features/knowledge/knowledge-contract';
import { registerKnowledgeIpc } from './knowledge-ipc';

const context = {
    customerScope: 'customer-a',
    systemScope: 'system-a',
    operatorId: 'operator-a',
    operatorPermissions: ['read', 'investigate'],
    identity: 'local-owner' as const
};

let dataPath = '';
let activity: Array<Record<string, unknown>> = [];
const now = '2026-09-14T10:00:00.000Z';

function record(id: string, overrides: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
    return {
        id, schemaVersion: 1, sourceType: 'runbook', title: id, content: `Steps for ${id}.`,
        operational: true, customerScope: context.customerScope, systemScope: context.systemScope,
        permissions: ['read'], sourceRef: { kind: 'file', id, locator: `local://${id}.md` },
        evidenceRefs: [], observedAt: now, contentHash: createHash('sha256').update(id).digest('hex'),
        redactionProfile: 'ibmi-default', confidence: 'medium', status: 'observed', objectNames: [],
        ...overrides
    };
}

function delegatedContext(): KnowledgeAccessContext {
    return {
        ...structuredClone(context), identity: 'delegated', now,
        grant: {
            organizationId: context.customerScope, operatorId: context.operatorId,
            systemIds: [context.systemScope], permissions: ['read', 'investigate'],
            status: 'active', expiresAt: '2026-09-14T11:00:00.000Z'
        }
    };
}

function registerExport(initial: KnowledgeAccessContext = structuredClone(context)) {
    const access = { current: initial };
    const store = createKnowledgeStore(() => dataPath);
    const list = vi.spyOn(store, 'list');
    const getStore = vi.fn(() => store);
    const filePath = path.join(dataPath, 'knowledge-export.json');
    const selection = { canceled: false, filePath };
    const showSaveDialog = vi.fn(async (): Promise<SaveDialogReturnValue> => selection);
    const audit = vi.fn();
    registerKnowledgeIpc({
        getStore,
        getAccessContext: () => access.current,
        recordActivity: (entry) => activity.push(entry),
        recordObservability: { audit },
        showSaveDialog,
        getDownloadsPath: () => dataPath
    });
    return { access, store, list, getStore, filePath, selection, showSaveDialog, audit };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

async function pauseExport(stage: 'save dialog' | 'store read', fixture: ReturnType<typeof registerExport>) {
    const started = deferred<void>();
    const released = deferred<void>();
    if (stage === 'save dialog') {
        fixture.showSaveDialog.mockImplementationOnce(async () => {
            started.resolve();
            await released.promise;
            return fixture.selection;
        });
    } else {
        fixture.list.mockImplementationOnce(async () => {
            started.resolve();
            await released.promise;
            return [record('visible')];
        });
    }
    const response = handlers.get('export-knowledge')!();
    await started.promise;
    return { response, resume: () => released.resolve() };
}

async function expectNoExport(fixture: ReturnType<typeof registerExport>) {
    await expect(fs.stat(fixture.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fixture.audit).not.toHaveBeenCalledWith('export', 'knowledge-records', 'success', expect.anything());
}

beforeEach(async () => {
    handlers.clear();
    dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-knowledge-ipc-'));
    activity = [];
    registerKnowledgeIpc({
        getStore: () => createKnowledgeStore(() => dataPath),
        getAccessContext: () => context,
        recordActivity: (entry) => activity.push(entry)
    });
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await fs.rm(dataPath, { recursive: true, force: true });
});

describe('knowledge IPC', () => {
    it('requires a scoped read before touching the store', async () => {
        registerKnowledgeIpc({
            getStore: () => { throw new Error('store should not be opened'); },
            getAccessContext: () => ({ ...context, customerScope: '', systemScope: '' }),
            recordActivity: () => undefined
        });
        const response = await handlers.get('get-knowledge-stats')!();
        expect(response.success).toBe(false);
        expect(response.error).toContain('scope');
    });

    it('saves redacted sources, searches them, opens history, and deletes all source chunks', async () => {
        const add = await handlers.get('add-knowledge-source')!(null, {
            sourceName: 'Night batch runbook',
            sourceType: 'runbook',
            fileName: 'night.md',
            content: 'Job: QBATCH/NIGHT\nStep: inspect\npassword=secret-value\nCheck MSGW before release.'
        });
        expect(add.success).toBe(true);

        const library = await handlers.get('get-knowledge-library')!();
        expect(library.success).toBe(true);
        expect(library.records).toHaveLength(2);
        expect(library.records[0].content).not.toContain('secret-value');

        const search = await handlers.get('search-knowledge')!(null, 'night batch');
        expect(search.records).toHaveLength(2);
        expect(search.citations).toHaveLength(2);
        expect(search.relevanceReasons).toEqual(expect.arrayContaining([
            expect.objectContaining({ recordId: search.records[0].id, source: 'lexical' })
        ]));
        expect(search.noMatchReason).toBeUndefined();

        const detail = await handlers.get('get-knowledge-record')!(null, library.records[0].id);
        expect(detail.success).toBe(true);
        expect(detail.history).toHaveLength(2);

        const duplicate = await handlers.get('add-knowledge-source')!(null, {
            sourceName: 'Night batch runbook', sourceType: 'runbook', fileName: 'night.md',
            content: 'Job: QBATCH/NIGHT\nStep: inspect\npassword=secret-value\nCheck MSGW before release.'
        });
        expect(duplicate.success).toBe(true);
        expect((await handlers.get('get-knowledge-library')!()).records).toHaveLength(2);

        const removed = await handlers.get('delete-knowledge-record')!(null, library.records[0].id);
        expect(removed).toMatchObject({ success: true, deletedCount: 2 });
        expect((await handlers.get('get-knowledge-library')!()).records).toHaveLength(0);
        expect(activity.map((entry) => entry.message)).toContain('Knowledge source saved.');
    });

    it('rejects unsupported or oversized uploads before persistence', async () => {
        const unsupported = await handlers.get('add-knowledge-source')!(null, {
            sourceName: 'Unsupported', fileName: 'guide.pdf', content: 'text'
        });
        expect(unsupported.success).toBe(false);
        const oversized = await handlers.get('add-knowledge-source')!(null, {
            sourceName: 'Too large', fileName: 'guide.md', content: 'x'.repeat(200001)
        });
        expect(oversized.success).toBe(false);
        expect((await handlers.get('get-knowledge-library')!()).records).toHaveLength(0);
    });

    it('requires confirmation and removes expired source chunks from the scoped store', async () => {
        const add = await handlers.get('add-knowledge-source')!(null, {
            sourceName: 'Expired runbook', sourceType: 'runbook', fileName: 'expired.md', content: 'Check the job state.'
        });
        expect(add.success).toBe(true);
        expect(await handlers.get('purge-knowledge')!(null, { before: '2099-01-01T00:00:00.000Z' })).toEqual({
            success: false, error: 'Knowledge purge requires explicit confirmation.'
        });
        const purged = await handlers.get('purge-knowledge')!(null, { before: '2099-01-01T00:00:00.000Z', confirmed: true });
        expect(purged).toMatchObject({ success: true, deletedCount: 1 });
        expect(purged.expectedContext).toEqual({
            customerScope: context.customerScope, systemScope: context.systemScope,
            operatorId: context.operatorId, identity: context.identity
        });
        expect((await handlers.get('get-knowledge-library')!()).records).toHaveLength(0);
    });

    it('returns the original purge identity even when the shared context changes during deletion', async () => {
        const fixture = registerExport();
        await fixture.store.upsert(record('purge-original'));
        const started = deferred<void>();
        const released = deferred<void>();
        const purge = fixture.store.purge;
        vi.spyOn(fixture.store, 'purge').mockImplementationOnce(async (scope, before) => {
            started.resolve();
            await released.promise;
            return purge(scope, before);
        });
        const response = handlers.get('purge-knowledge')!(null, { confirmed: true, before: '2099-01-01T00:00:00.000Z' });
        await started.promise;
        Object.assign(fixture.access.current, {
            customerScope: 'customer-b', systemScope: 'system-b', operatorId: 'operator-b', identity: 'delegated'
        });
        released.resolve();
        expect(await response).toMatchObject({ success: true, deletedCount: 1, expectedContext: {
            customerScope: context.customerScope, systemScope: context.systemScope,
            operatorId: context.operatorId, identity: context.identity
        } });
        expect(await fixture.store.get('purge-original')).toBeUndefined();
    });
});

describe('knowledge export IPC', () => {
    it.each([
        { name: 'missing scope', access: { ...context, systemScope: '' }, error: 'scope' },
        { name: 'missing operator', access: { ...context, operatorId: '' }, error: 'identity' },
        { name: 'missing read permission', access: { ...context, operatorPermissions: ['investigate'] }, error: 'not allowed' },
        { name: 'missing delegated grant', access: { ...delegatedContext(), grant: undefined }, error: 'missing' },
        { name: 'revoked grant', access: { ...delegatedContext(), grant: { ...delegatedContext().grant!, status: 'revoked' as const } }, error: 'revoked' }
    ])('denies $name before opening the store or dialog', async ({ access, error }) => {
        const fixture = registerExport(access);
        expect(await handlers.get('export-knowledge')!()).toMatchObject({ success: false, error: expect.stringContaining(error) });
        expect(fixture.getStore).not.toHaveBeenCalled();
        expect(fixture.showSaveDialog).not.toHaveBeenCalled();
        await expectNoExport(fixture);
    });

    it.each([
        { canceled: true },
        { canceled: true, filePath: 'ignored' },
        { canceled: false }
    ])('does not write or read records for an incomplete save selection: %j', async (selection) => {
        const fixture = registerExport();
        fixture.showSaveDialog.mockResolvedValueOnce({ ...selection, filePath: selection.filePath ? fixture.filePath : '' });
        expect(await handlers.get('export-knowledge')!()).toEqual({ success: false, canceled: true });
        expect(fixture.getStore).not.toHaveBeenCalled();
        await expectNoExport(fixture);
    });

    describe.each(['save dialog', 'store read'] as const)('while awaiting the %s', (stage) => {
        const accessChanges: Array<{ name: string; change: (access: KnowledgeAccessContext) => void; error: string }> = [
            { name: 'grant revocation', change: (access) => { access.grant!.status = 'revoked'; }, error: 'revoked' },
            { name: 'grant expiry', change: (access) => { access.now = access.grant!.expiresAt; }, error: 'expired' },
            { name: 'pending grant', change: (access) => { access.grant!.status = 'pending'; }, error: 'not been accepted' },
            { name: 'grant removal', change: (access) => { access.grant = undefined; }, error: 'missing' },
            { name: 'operator read permission removal', change: (access) => { access.operatorPermissions = ['investigate']; }, error: 'not allowed' },
            { name: 'grant read permission removal', change: (access) => { access.grant!.permissions = ['investigate']; }, error: 'not allowed' },
            { name: 'grant system removal', change: (access) => { access.grant!.systemIds = []; }, error: 'another IBM i system' }
        ];

        it.each(accessChanges)('denies $name without writing a file', async ({ change, error }) => {
            const fixture = registerExport(delegatedContext());
            const pending = await pauseExport(stage, fixture);
            const updated = structuredClone(fixture.access.current);
            change(updated);
            fixture.access.current = updated;
            pending.resume();
            expect(await pending.response).toMatchObject({ success: false, error: expect.stringContaining(error) });
            if (stage === 'save dialog') expect(fixture.getStore).not.toHaveBeenCalled();
            await expectNoExport(fixture);
        });

        const identityChanges: Array<{ name: string; change: (access: KnowledgeAccessContext) => void }> = [
            { name: 'customer', change: (access) => { access.customerScope = 'customer-b'; access.grant!.organizationId = 'customer-b'; } },
            { name: 'system', change: (access) => { access.systemScope = 'system-b'; access.grant!.systemIds = ['system-b']; } },
            { name: 'operator', change: (access) => { access.operatorId = 'operator-b'; access.grant!.operatorId = 'operator-b'; } },
            { name: 'identity mode', change: (access) => { access.identity = 'local-owner'; } }
        ];

        it.each(identityChanges)('rejects an in-place $name switch even when the new identity can read', async ({ change }) => {
            const fixture = registerExport(delegatedContext());
            const pending = await pauseExport(stage, fixture);
            change(fixture.access.current);
            pending.resume();
            expect(await pending.response).toMatchObject({ success: false, error: expect.stringContaining('scope or operator identity changed') });
            if (stage === 'save dialog') expect(fixture.getStore).not.toHaveBeenCalled();
            await expectNoExport(fixture);
        });
    });

    it.each(['local-owner', 'delegated'] as const)('exports only the scoped library-visible records for %s', async (identity) => {
        const fixture = registerExport(identity === 'delegated' ? delegatedContext() : structuredClone(context));
        const visible = [
            record('observed'),
            record('approved', { status: 'approved', reviewer: context.operatorId, reviewAt: now }),
            record('stale', { status: 'stale' }),
            record('draft', { status: 'draft' }),
            record('blocked', { status: 'blocked', blockedReason: 'Needs review.' }),
            record('unknown', { status: 'unknown' })
        ];
        for (const candidate of [
            ...visible,
            record('unreadable', { permissions: ['investigate'] }),
            record('retired', { status: 'retired', retiredAt: now }),
            record('other-customer', { customerScope: 'customer-b' }),
            record('other-system', { systemScope: 'system-b' })
        ]) await fixture.store.upsert(candidate);

        const library = await handlers.get('get-knowledge-library')!();
        expect(library.records.map((item: KnowledgeRecord) => item.id)).toEqual(visible.map((item) => item.id));
        expect(await handlers.get('export-knowledge')!()).toEqual({ success: true, filePath: fixture.filePath, recordCount: visible.length });
        const exported = JSON.parse(await fs.readFile(fixture.filePath, 'utf8'));
        expect(exported.scope).toEqual({ customerScope: context.customerScope, systemScope: context.systemScope });
        expect(exported.records).toEqual(JSON.parse(JSON.stringify(library.records)));
        expect(Number.isFinite(Date.parse(exported.exportedAt))).toBe(true);
        expect(fixture.audit).toHaveBeenCalledWith('export', 'knowledge-records', 'success', { records: visible.length });
    });

    it('filters invalid and out-of-scope candidates returned by the store', async () => {
        const fixture = registerExport();
        fixture.list.mockResolvedValueOnce([
            record('visible'),
            record('unreadable', { permissions: ['investigate'] }),
            record('invalid-approval', { status: 'approved' }),
            record('retired', { status: 'retired', retiredAt: now }),
            record('other-customer', { customerScope: 'customer-b' }),
            record('other-system', { systemScope: 'system-b' })
        ]);
        expect(await handlers.get('export-knowledge')!()).toMatchObject({ success: true, recordCount: 1 });
        expect(fixture.list).toHaveBeenCalledWith({ customerScope: context.customerScope, systemScope: context.systemScope });
        const exported = JSON.parse(await fs.readFile(fixture.filePath, 'utf8'));
        expect(exported.records.map((item: KnowledgeRecord) => item.id)).toEqual(['visible']);
    });

    it('reads current record permissions and retirement after the dialog closes', async () => {
        const fixture = registerExport();
        await fixture.store.upsert(record('no-longer-readable'));
        await fixture.store.upsert(record('newly-retired'));
        const pending = await pauseExport('save dialog', fixture);
        await fixture.store.upsert(record('no-longer-readable', { permissions: ['investigate'] }));
        await fixture.store.retire('newly-retired', now);
        await fixture.store.upsert(record('newly-visible'));
        pending.resume();
        expect(await pending.response).toMatchObject({ success: true, recordCount: 1 });
        const exported = JSON.parse(await fs.readFile(fixture.filePath, 'utf8'));
        expect(exported.records.map((item: KnowledgeRecord) => item.id)).toEqual(['newly-visible']);
    });

    it('honors wall-clock grant expiry while the save dialog is open', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(now));
        const fixture = registerExport({ ...delegatedContext(), now: undefined });
        const pending = await pauseExport('save dialog', fixture);
        vi.setSystemTime(new Date(fixture.access.current.grant!.expiresAt));
        pending.resume();
        expect(await pending.response).toMatchObject({ success: false, error: expect.stringContaining('expired') });
        await expectNoExport(fixture);
    });

    it('leaves an existing destination unchanged when access is revoked', async () => {
        const fixture = registerExport(delegatedContext());
        await fs.writeFile(fixture.filePath, 'Existing report.\n', 'utf8');
        const pending = await pauseExport('save dialog', fixture);
        fixture.access.current.grant!.status = 'revoked';
        pending.resume();
        expect(await pending.response).toMatchObject({ success: false, error: expect.stringContaining('revoked') });
        expect(await fs.readFile(fixture.filePath, 'utf8')).toBe('Existing report.\n');
        expect(fixture.audit).not.toHaveBeenCalledWith('export', 'knowledge-records', 'success', expect.anything());
    });
});
