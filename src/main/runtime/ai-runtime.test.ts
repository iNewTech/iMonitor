import { describe, expect, it, vi } from 'vitest';
import type { ActiveJobRecord } from '../../services/ibmi';
import { DEFAULT_AI_ASSISTANT_SETTINGS } from '../../features/ibmeyeai/ai-model';
import { createAiRuntime } from './ai-runtime';

describe('ai-runtime', () => {
    it('analyzes a new alert with the current monitor context', async () => {
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/api/tags')) {
                return new Response(JSON.stringify({ models: [{ name: 'gemma3:latest' }] }), { status: 200 });
            }

            if (url.endsWith('/api/chat')) {
                const payload = JSON.parse(String(init?.body ?? '{}'));
                expect(payload.messages.at(-1).content).toContain('How to resolve');
                return new Response(JSON.stringify({
                    message: { content: 'Issue: MSGW detected\nWhy: A reply is pending.\nHow to resolve: Reply to the message.' }
                }), { status: 200 });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });

        const runtime = createAiRuntime({
            appName: 'iMonitor',
            getSettings: () => DEFAULT_AI_ASSISTANT_SETTINGS,
            getConnection: () => null,
            getMonitorMode: () => 'dummy',
            getLatestJobs: () => [],
            getJob: () => undefined,
            getActiveAlerts: () => [],
            getMonitoringHistory: () => [],
            getActivityLog: () => [],
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        const result = await runtime.analyzeAlert({
            id: 'msgw:123/DEMO/JOB',
            kind: 'messageWait',
            severity: 'critical',
            timestamp: '2026-08-30T09:00:00.000Z',
            title: 'MSGW detected',
            message: 'QINTER/DEMOJOB entered message wait.',
            detail: 'Waiting for an operator reply.',
            jobName: '123/DEMO/JOB',
            workflowStatus: 'new',
            notes: [],
            timeline: [],
            workflowUpdatedAt: '2026-08-30T09:00:00.000Z'
        });

        expect(result.success).toBe(true);
        expect(result.reply).toContain('How to resolve');
    });

    it('adds on-demand evidence to a focused analysis without changing the base question', async () => {
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/api/tags')) {
                return new Response(JSON.stringify({ models: [{ name: 'gemma3:latest' }] }), { status: 200 });
            }

            if (url.endsWith('/api/chat')) {
                const payload = JSON.parse(String(init?.body ?? '{}'));
                const userMessage = payload.messages.at(-1).content;
                expect(userMessage).toContain('Analyze the current IBM i wait condition');
                expect(userMessage).toContain('MESSAGE_ID: DEMO0001');
                expect(userMessage).toContain('MESSAGE_TEXT: Demo MSGW requires an operator reply.');
                return new Response(JSON.stringify({ message: { content: 'What is happening\nA reply is pending.' } }));
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });

        const runtime = createAiRuntime({
            appName: 'iMonitor',
            getSettings: () => DEFAULT_AI_ASSISTANT_SETTINGS,
            getConnection: () => null,
            getMonitorMode: () => 'dummy',
            getLatestJobs: () => [],
            getJob: () => undefined,
            getActiveAlerts: () => [],
            getMonitoringHistory: () => [],
            getActivityLog: () => [],
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        const result = await runtime.askAssistant({
            message: 'Analyze the current IBM i wait condition.',
            additionalContext: 'MESSAGE_ID: DEMO0001\nMESSAGE_TEXT: Demo MSGW requires an operator reply.'
        });

        expect(result.success).toBe(true);
    });

    it('keeps job helper context limited to the selected job', async () => {
        const selectedJob = {
            JOB_NAME: '123/USER/SELECTED',
            SUBSYSTEM_JOB: 'QINTER/SELECTED',
            CURRENT_USER: 'USER',
            STATUS: 'LCKW',
            CPU: 12,
            SQL_STATEMENT_TEXT: null
        } as ActiveJobRecord;
        const otherJob = {
            JOB_NAME: '456/USER/OTHER',
            SUBSYSTEM_JOB: 'QBATCH/OTHER',
            CURRENT_USER: 'USER',
            STATUS: 'RUN',
            CPU: 88,
            SQL_STATEMENT_TEXT: null
        } as ActiveJobRecord;
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/api/tags')) {
                return new Response(JSON.stringify({ models: [{ name: 'gemma3:latest' }] }), { status: 200 });
            }

            if (url.endsWith('/api/chat')) {
                const payload = JSON.parse(String(init?.body ?? '{}'));
                const systemMessage = payload.messages[0].content;
                const userMessage = payload.messages.at(-1).content;
                expect(systemMessage).toContain('selected-job helper');
                expect(systemMessage).toContain('selected IBM i job');
                expect(userMessage).toContain('QINTER/SELECTED');
                expect(userMessage).toContain('Selected job status: Waiting for a lock');
                expect(userMessage).toContain('[runbook:memory-1:v1]');
                expect(userMessage).not.toContain('QBATCH/OTHER');
                expect(userMessage).not.toContain('unrelated context');
                expect(userMessage).not.toContain('totalJobs=99');
                return new Response(JSON.stringify({ message: { content: 'Use the selected job evidence.' } }));
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });
        const runtime = createAiRuntime({
            appName: 'iMonitor',
            getSettings: () => DEFAULT_AI_ASSISTANT_SETTINGS,
            getConnection: () => null,
            getMonitorMode: () => 'live',
            getLatestJobs: () => [selectedJob, otherJob],
            getJob: (name) => name === '123/USER/SELECTED' ? selectedJob : undefined,
            getActiveAlerts: () => [{
                id: 'selected-alert', kind: 'lockWait', severity: 'warning',
                timestamp: '2026-09-12T10:00:00.000Z', title: 'Lock wait',
                message: 'Selected job is waiting.', detail: 'Review the selected job.',
                jobName: '123/USER/SELECTED', workflowStatus: 'new', notes: [], timeline: [],
                workflowUpdatedAt: '2026-09-12T10:00:00.000Z', isActive: true
            }, {
                id: 'other-alert', kind: 'highCpu', severity: 'critical',
                timestamp: '2026-09-12T10:00:00.000Z', title: 'Other job CPU',
                message: 'Other job is hot.', detail: 'Unrelated context.',
                jobName: '456/USER/OTHER', workflowStatus: 'new', notes: [], timeline: [],
                workflowUpdatedAt: '2026-09-12T10:00:00.000Z', isActive: true
            }],
            getMonitoringHistory: () => [{
                timestamp: '2026-09-12T10:00:00.000Z', totalJobs: 99, peakCpu: 99,
                runningJobs: 98, waitingJobs: 1, messageWaitJobs: 0, lockWaitJobs: 1, highCpuJobs: 1
            }],
            getJobStatusHistory: () => [{
                timestamp: '2026-09-12T09:59:00.000Z', status: 'RUN', label: 'Running'
            }],
            getCurrentSystemId: () => 'prod',
            getResolutionMemory: () => ({ entries: [{
                id: 'memory-1', procedureKey: 'prod:lockWait:SELECTED', version: 1, status: 'approved', systemId: 'prod',
                incidentKind: 'lockWait', jobPattern: '123/USER/*', title: 'Inspect the lock owner',
                symptoms: [], evidenceRefs: [], failedAttempts: [], successfulAction: 'Inspect lock owner',
                verifiedOutcome: 'Wait cleared.', environment: {}, createdAt: '2026-09-12T09:00:00.000Z'
            }] }),
            getActivityLog: () => [{
                id: '1', timestamp: '2026-09-12T10:00:00.000Z', area: 'monitoring', level: 'info',
                message: `Observed ${selectedJob.JOB_NAME}`, detail: 'Selected job evidence.'
            }, {
                id: '2', timestamp: '2026-09-12T10:00:00.000Z', area: 'monitoring', level: 'info',
                message: 'Other job event', detail: 'Unrelated context.'
            }],
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        const result = await runtime.askAssistant({
            message: 'What should I do next?',
            selectedJobName: '123/USER/SELECTED',
            scope: 'job',
            conversation: [{ role: 'user', content: 'Tell me about another job.' }],
            additionalContext: 'unrelated context'
        });

        expect(result.success).toBe(true);
    });

    it('rejects a job helper request when the selected job is unavailable', async () => {
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.endsWith('/api/tags')) {
                return new Response(JSON.stringify({ models: [{ name: 'gemma3:latest' }] }), { status: 200 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        const runtime = createAiRuntime({
            appName: 'iMonitor',
            getSettings: () => DEFAULT_AI_ASSISTANT_SETTINGS,
            getConnection: () => null,
            getMonitorMode: () => 'live',
            getLatestJobs: () => [],
            getJob: () => undefined,
            getActiveAlerts: () => [],
            getMonitoringHistory: () => [],
            getActivityLog: () => [],
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        const result = await runtime.askAssistant({
            message: 'Explain this job.', selectedJobName: 'missing-job', scope: 'job'
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('no longer available');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
