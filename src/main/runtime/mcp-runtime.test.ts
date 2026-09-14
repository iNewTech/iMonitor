import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import type { IncidentEvidence, IncidentEvidenceSnapshot } from '../../features/alerts/incident-evidence';
import type { McpActionExecutionRequest } from '../../features/mcp/mcp-actions';
import { DEFAULT_MCP_REGISTRY, MCP_AVAILABLE_MANIFESTS, installMcpCapability, setMcpCapabilityEnabled } from '../../features/mcp/mcp-registry';
import { readMcpResource } from '../../features/mcp/mcp-resources';
import type { ActiveJobRecord } from '../../services/ibmi';
import { createMonitoringStateStore } from '../state/monitoring-state';
import { createMcpRuntime } from './mcp-runtime';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron/main', () => ({ ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => handlers.set(channel, callback) } }));
vi.mock('electron-store', () => ({ default: class {} }));

const now = '2026-09-14T10:00:00.000Z';
const jobName = '123456/OPERATOR/NIGHT';
const context = {
    customerScope: 'local', systemScope: 'system-a', operatorId: 'operator',
    operatorPermissions: ['read', 'investigate', 'execute'], identity: 'local-owner' as const
};
const request: McpActionExecutionRequest = {
    capabilityId: 'ibmi-job-control', tool: 'release-job', jobName, operatorAction: 'releaseJob', input: {}
};

function setup() {
    const monitoringState = createMonitoringStateStore(10, 10, 5_000);
    const job = { JOB_NAME: jobName, STATUS: 'HLD', PASSWORD: 'private-job-field' } as unknown as ActiveJobRecord;
    const poll = (timestamp = now) => {
        monitoringState.refreshTrackedJobs([job], timestamp);
        monitoringState.appendMonitoringSnapshot([job], timestamp, 80);
    };
    poll('2026-09-14T09:50:00.000Z');
    const executeClCommand = vi.fn().mockResolvedValue(undefined);
    const publishSystemStatus = vi.fn(async () => { poll(); });
    const getActiveAlerts = vi.fn<() => MonitorAlert[]>(() => []);
    const values: Record<string, unknown> = { mcpRegistry: DEFAULT_MCP_REGISTRY, resolutionMemory: { entries: [] } };
    const runtime = createMcpRuntime({
        store: {
            get: (key: string) => values[key],
            set: (key: string, value: unknown) => { values[key] = value; }
        } as unknown as Parameters<typeof createMcpRuntime>[0]['store'],
        monitoringState,
        getActiveAlerts,
        getRunbookPolicyForJob: () => undefined,
        getCurrentOperatorName: () => 'operator',
        getCurrentService: () => ({ executeClCommand }),
        publishSystemStatus,
        recordCommandActivity: vi.fn(),
        knowledgeRuntime: {
            getAccessContext: () => context, recordActivity: vi.fn(), recordMetric: vi.fn(), recordAudit: vi.fn()
        }
    });
    const readJobs = () => readMcpResource(DEFAULT_MCP_REGISTRY, context, {
        capabilityId: 'ibmi-monitoring', name: 'ibmi://jobs/current', kind: 'resource', jobName
    }, { getItems: runtime.getResourceItems }, new Date(now));
    return { runtime, job, poll, monitoringState, getActiveAlerts, executeClCommand, publishSystemStatus, readJobs, values };
}

beforeEach(() => { handlers.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now)); });
afterEach(() => vi.useRealTimers());

describe('MCP runtime resource projections', () => {
    it('keeps the observation time of cached jobs so stopped monitoring becomes stale', async () => {
        const { readJobs } = setup();
        const result = await readJobs();
        expect(result.success).toBe(true);
        expect(result.items[0].provenance).toMatchObject({
            observedAt: '2026-09-14T09:50:00.000Z', freshness: 'stale'
        });
        expect(JSON.stringify(result)).not.toContain('private-job-field');
    });

    it('does not invent an observation time when there is no monitoring snapshot', async () => {
        const { monitoringState, job, readJobs } = setup();
        monitoringState.clearRuntimeState();
        monitoringState.refreshTrackedJobs([job], now);
        const result = await readJobs();
        expect(result.items[0].provenance.freshness).toBe('unknown');
    });

    it('projects only evidence summaries when optional incident metadata is undefined', () => {
        const { runtime, getActiveAlerts } = setup();
        const snapshot: IncidentEvidenceSnapshot = {
            status: 'captured', collectedAt: now, source: 'ibmi', recordCount: 1,
            records: [{ text: 'raw evidence must stay private' }]
        };
        const evidence: IncidentEvidence = {
            version: 1, capturedAt: now, source: 'ibmi', systemId: undefined, systemLabel: undefined,
            trigger: snapshot, job: snapshot, jobLog: snapshot, messages: snapshot, queue: snapshot, subsystem: snapshot
        };
        getActiveAlerts.mockReturnValue([{ id: 'incident-1', title: 'Waiting job', timestamp: now, jobName, evidence } as MonitorAlert]);
        const items = runtime.getResourceItems({ kind: 'resource', name: 'ibmi://incidents/current', input: '', jobName, scope: context });
        const projected = JSON.parse(items[0].content);
        expect(Object.keys(projected.evidence)).toEqual(['trigger', 'job', 'jobLog', 'messages', 'queue', 'subsystem']);
        expect(projected.evidence.jobLog).toEqual({ status: 'captured', collectedAt: now, recordCount: 1 });
        expect(items[0].content).not.toContain('raw evidence');
    });

    it('preserves selected-job filtering and the job-summary prompt alias', () => {
        const { runtime, monitoringState, job } = setup();
        monitoringState.refreshTrackedJobs([job, { JOB_NAME: '999999/OTHER/JOB', STATUS: 'RUN' } as ActiveJobRecord], now);
        const items = runtime.getResourceItems({ kind: 'prompt', name: 'job-health-summary', input: '', jobName, scope: context });
        expect(items.map((item) => item.id)).toEqual([jobName]);
        expect(runtime.getResourceItems({ kind: 'resource', name: 'unknown', input: '', scope: context })).toEqual([]);
    });
});

describe('MCP runtime execution and verification', () => {
    it('requires explicit approval through IPC and returns the fresh verification outcome', async () => {
        const { runtime, values, poll, job, publishSystemStatus, executeClCommand } = setup();
        const manifest = MCP_AVAILABLE_MANIFESTS.find((candidate) => candidate.id === 'ibmi-job-control')!;
        values.mcpRegistry = setMcpCapabilityEnabled(
            installMcpCapability(DEFAULT_MCP_REGISTRY, manifest, 'operator', now), manifest.id, true, now
        );
        poll();
        runtime.registerIpc();
        const preview = await handlers.get('preview-mcp-action')!(undefined, request);
        expect(preview.success).toBe(true);
        expect(executeClCommand).not.toHaveBeenCalled();
        const unapproved = await handlers.get('run-mcp-action')!(undefined, { previewId: preview.preview.previewId, approved: false });
        expect(unapproved.success).toBe(false);
        expect(executeClCommand).not.toHaveBeenCalled();
        publishSystemStatus.mockImplementation(async () => { job.STATUS = 'RUN'; poll(); });
        const approved = await handlers.get('run-mcp-action')!(undefined, { previewId: preview.preview.previewId, approved: true });
        expect(approved).toMatchObject({ success: true, verification: { status: 'recovered' } });
        expect(executeClCommand).toHaveBeenCalledOnce();
        expect(publishSystemStatus).toHaveBeenCalledOnce();
    });

    it('never reports simulated commands as a verified IBM i recovery', async () => {
        const { runtime, monitoringState, executeClCommand, publishSystemStatus } = setup();
        monitoringState.setMonitorMode('dummy');
        const hold = { ...request, operatorAction: 'holdJob' as const, tool: 'hold-job' };
        expect((await runtime.execute(hold)).output).toContain('Prepared HLDJOB');
        expect(await runtime.verify(hold)).toMatchObject({ status: 'unknown', summary: expect.stringMatching(/simulat/i) });
        expect(executeClCommand).not.toHaveBeenCalled();
        expect(publishSystemStatus).not.toHaveBeenCalled();
    });

    it('verifies live actions with a separate post-command monitoring read', async () => {
        const { runtime, job, publishSystemStatus, executeClCommand, poll } = setup();
        publishSystemStatus.mockImplementation(async () => { job.STATUS = 'RUN'; poll(); });
        await runtime.execute(request);
        expect(executeClCommand).toHaveBeenCalledWith(`RLSJOB JOB(${jobName})`);
        expect(publishSystemStatus).not.toHaveBeenCalled();
        expect(await runtime.verify(request)).toMatchObject({ status: 'recovered', evidence: ['Job status: RUN', `Observed at: ${now}`] });
        expect(publishSystemStatus).toHaveBeenCalledOnce();
    });

    it('does not treat a missing job status as a successful message reply', async () => {
        const { runtime, job } = setup();
        job.STATUS = null;
        expect(await runtime.verify({ ...request, operatorAction: 'replyMessage' })).toMatchObject({ status: 'unknown' });
    });

    it('keeps recovery unknown when the verification read fails', async () => {
        const { runtime, publishSystemStatus } = setup();
        publishSystemStatus.mockRejectedValue(new Error('Connection lost'));
        expect(await runtime.verify({ ...request, operatorAction: 'holdJob' })).toMatchObject({ status: 'unknown' });
    });

    it.each([
        { operatorAction: 'holdJob' as const, status: 'HLD' },
        { operatorAction: 'releaseJob' as const, status: 'RUN' }
    ])('does not verify cached $status when the refresh resolves without a new snapshot', async ({ operatorAction, status }) => {
        const { runtime, job, poll, publishSystemStatus } = setup();
        job.STATUS = status;
        poll();
        publishSystemStatus.mockResolvedValue(undefined);
        const result = await runtime.verify({ ...request, operatorAction });
        expect(result).toMatchObject({ status: 'unknown', summary: expect.stringContaining('new monitoring snapshot') });
    });

    it('does not verify a cached job when there is no monitoring history', async () => {
        const { runtime, job, monitoringState, publishSystemStatus } = setup();
        monitoringState.clearRuntimeState();
        monitoringState.refreshTrackedJobs([job], now);
        publishSystemStatus.mockResolvedValue(undefined);
        expect(await runtime.verify({ ...request, operatorAction: 'holdJob' })).toMatchObject({ status: 'unknown' });
    });

    it('keeps a departed job unknown even if a tracked lookup retains its old status', async () => {
        const { runtime, job, monitoringState, publishSystemStatus } = setup();
        publishSystemStatus.mockImplementation(async () => {
            monitoringState.refreshTrackedJobs([], now);
            monitoringState.appendMonitoringSnapshot([], now, 80);
        });
        vi.spyOn(monitoringState, 'getJob').mockReturnValue(job);
        expect(await runtime.verify({ ...request, operatorAction: 'holdJob' })).toMatchObject({
            status: 'unknown', evidence: ['Job: unavailable after action']
        });
        expect(monitoringState.getLatestJobs()).toEqual([]);
    });

    it('matches the current job by the same qualified identity used by the tracking store', async () => {
        const { runtime, job } = setup();
        job.JOB_NAME = '';
        job.JOB_NUMBER = '123456';
        job.JOB_USER = 'OPERATOR';
        job.JOB_NAME_SHORT = 'NIGHT';
        expect(await runtime.verify({ ...request, operatorAction: 'holdJob' })).toMatchObject({ status: 'recovered' });
    });

    it('recognizes a new snapshot when its timestamp and the bounded history length stay the same', async () => {
        const { runtime, poll, monitoringState } = setup();
        for (let index = 0; index < 10; index++) poll();
        expect(monitoringState.getMonitoringHistory()).toHaveLength(10);
        expect(await runtime.verify({ ...request, operatorAction: 'holdJob' })).toMatchObject({ status: 'recovered' });
        expect(monitoringState.getMonitoringHistory()).toHaveLength(10);
    });

    it.each(['2026-09-14T09:59:00.000Z', 'not-a-date'])('does not use an invalid or older observation time: %s', async (timestamp) => {
        const { runtime, poll, publishSystemStatus } = setup();
        poll();
        publishSystemStatus.mockImplementation(async () => { poll(timestamp); });
        expect(await runtime.verify({ ...request, operatorAction: 'holdJob' })).toMatchObject({ status: 'unknown' });
    });

    it('does not submit an already-cancelled command', async () => {
        const { runtime, executeClCommand } = setup();
        const controller = new AbortController();
        controller.abort();
        await expect(runtime.execute({ ...request, signal: controller.signal })).rejects.toThrow(/cancel/i);
        expect(executeClCommand).not.toHaveBeenCalled();
    });
});
