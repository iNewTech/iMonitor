import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));

import { registerResolutionMemoryIpc } from './resolution-memory-ipc';
import type { ResolutionMemoryStore } from '../../features/action-board/resolution-memory';

const jobName = '123456/OPERATOR/REVIEWJOB';
const job = { JOB_NAME: jobName, TYPE: 'BATCH', SUBSYSTEM: 'QBATCH', SUBSYSTEM_JOB: 'REVIEWJOB' } as any;
const alert = {
    id: 'alert-1', incidentId: 'incident-1', jobName, kind: 'highCpu', title: 'High CPU', message: 'CPU stayed high.',
    detail: 'The job exceeded the threshold.', isActive: false, owner: 'l2', timeline: [], evidence: {},
    correlation: { fingerprint: 'fingerprint-1' }
} as any;

let memory: ResolutionMemoryStore;
let allowedActions: string[];
let activity: Array<Record<string, unknown>>;

beforeEach(() => {
    handlers.clear();
    alert.isActive = false;
    memory = { entries: [] };
    allowedActions = ['read', 'incident-workflow'];
    activity = [];
    registerResolutionMemoryIpc({
        getMemory: () => memory,
        saveMemory: (candidate) => memory = candidate,
        getJob: (name) => name === jobName ? job : undefined,
        getAlert: (name) => name === jobName ? alert : undefined,
        getSystemId: () => 'system-a',
        getSystemLabel: () => 'Production',
        getOperatorName: () => 'reviewer',
        authorizeAction: (action) => allowedActions.includes(action) ? { allowed: true } : { allowed: false, reason: `blocked ${action}` },
        recordActivity: (entry) => activity.push(entry)
    });
});

describe('resolution memory IPC', () => {
    it('captures source lineage and supports draft, revision, rejection, and approval lifecycle', async () => {
        const draft = await handlers.get('save-resolution-memory-draft')!(null, jobName);
        expect(draft).toMatchObject({ success: true, entry: { status: 'draft', operator: 'reviewer', sourceIncidentId: 'incident-1' } });
        expect(draft.entry.reviewHistory).toEqual([expect.objectContaining({ action: 'created', actor: 'reviewer', version: 1 })]);

        const approved = await handlers.get('approve-resolution-memory')!(null, draft.entry.id);
        expect(approved).toMatchObject({ success: true, entry: { status: 'approved', reviewer: 'reviewer' } });
        expect(approved.entry.reviewHistory).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'approved' })]));

        const revised = await handlers.get('revise-resolution-memory')!(null, { entryId: draft.entry.id, revision: { title: 'Reviewed high CPU procedure', successfulAction: 'Hold after evidence review.', verifiedOutcome: 'Verified on the next poll.' } });
        expect(revised).toMatchObject({ success: true, entry: { status: 'draft', version: 2, title: 'Reviewed high CPU procedure' } });
        expect(revised.entry.reviewHistory).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'revised', version: 2 })]));

        const rejected = await handlers.get('reject-resolution-memory')!(null, { entryId: draft.entry.id, note: 'Needs more evidence.' });
        expect(rejected).toMatchObject({ success: true, entry: { status: 'rejected' } });
        expect(rejected.entry.reviewHistory).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'rejected', note: 'Needs more evidence.' })]));
        expect(activity.map((item) => item.message)).toEqual(expect.arrayContaining(['Resolution memory draft saved.', 'Resolution memory approved.', 'Resolution memory revised.', 'Resolution memory rejected.']));
    });

    it('returns review match signals and protects review mutations with incident-workflow permission', async () => {
        const draft = await handlers.get('save-resolution-memory-draft')!(null, jobName);
        await handlers.get('approve-resolution-memory')!(null, draft.entry.id);
        const read = await handlers.get('get-resolution-memory')!(null, jobName);
        expect(read.matches).toEqual([expect.objectContaining({ entryId: draft.entry.id, confidence: 'high', environmentCompatible: true, reasons: expect.any(Array) })]);

        allowedActions = ['read'];
        const blocked = await handlers.get('revise-resolution-memory')!(null, { entryId: draft.entry.id, revision: { title: 'Should not save' } });
        expect(blocked).toMatchObject({ success: false, error: 'blocked incident-workflow' });
        expect(memory.entries[0].title).toBe('High CPU');
    });

    it('requires verified recovery before creating a reusable draft', async () => {
        alert.isActive = true;
        const response = await handlers.get('save-resolution-memory-draft')!(null, jobName);
        expect(response).toMatchObject({ success: false, error: expect.stringContaining('confirm') });
        expect(memory.entries).toHaveLength(0);
    });
});
