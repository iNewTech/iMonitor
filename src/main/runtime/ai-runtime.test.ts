import { describe, expect, it, vi } from 'vitest';
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
});
