import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MonitorAlert } from '../../features/alerts/alert-model';
import { DEFAULT_CLICKUP_SETTINGS } from '../../features/integrations/clickup/clickup-model';
import { createClickUpRuntime } from './clickup-runtime';

function createAlert(overrides: Partial<MonitorAlert> = {}): MonitorAlert {
    return {
        id: 'msgw:123/DEMO/JOB',
        kind: 'messageWait',
        severity: 'critical',
        timestamp: '2026-08-30T09:00:00.000Z',
        lastSeenAt: '2026-08-30T09:00:00.000Z',
        isActive: true,
        title: 'MSGW detected',
        message: 'QINTER/DEMOJOB entered message wait.',
        detail: 'Waiting for an operator reply.',
        jobName: '123/DEMO/JOB',
        workflowStatus: 'new',
        notes: [],
        timeline: [],
        workflowUpdatedAt: '2026-08-30T09:00:00.000Z',
        ...overrides
    };
}

describe('clickup-runtime', () => {
    it('reports whether automatic task creation is ready', () => {
        const runtime = createClickUpRuntime({
            getSettings: () => ({
                ...DEFAULT_CLICKUP_SETTINGS,
                enabled: true,
                apiToken: 'pk_demo',
                listId: 'list-123'
            }),
            recordActivity: vi.fn()
        });

        const disabledRuntime = createClickUpRuntime({
            getSettings: () => DEFAULT_CLICKUP_SETTINGS,
            recordActivity: vi.fn()
        });

        expect(runtime.canAutoCreateTasks()).toBe(true);
        expect(disabledRuntime.canAutoCreateTasks()).toBe(false);
    });

    it('assigns a newly created task to the authenticated ClickUp user', async () => {
        const recordActivity = vi.fn();
        const saveSettings = vi.fn((settings) => settings);
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/user')) {
                return new Response(JSON.stringify({
                    user: {
                        id: 77,
                        username: 'gajender',
                        email: 'gajender@example.com'
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            if (url.endsWith('/list/list-123/task')) {
                const payload = JSON.parse(String(init?.body ?? '{}'));
                expect(payload.assignees).toEqual(['77']);

                return new Response(JSON.stringify({
                    id: 'task-900',
                    name: payload.name,
                    url: 'https://app.clickup.com/t/task-900'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });

        const runtime = createClickUpRuntime({
            getSettings: () => ({
                ...DEFAULT_CLICKUP_SETTINGS,
                enabled: true,
                apiToken: 'pk_demo',
                workspaceId: 'team-1',
                listId: 'list-123'
            }),
            saveSettings,
            getOperatorName: () => 'GajenderT',
            recordActivity,
            fetchImpl: fetchImpl as typeof fetch
        });

        const task = await runtime.createTaskForAlert(createAlert());

        expect(task).toEqual({
            id: 'task-900',
            name: 'MSGW detected | 123/DEMO/JOB',
            url: 'https://app.clickup.com/t/task-900'
        });
        expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
            memberId: '77',
            assigneeUserId: '77',
            userEmail: 'gajender@example.com'
        }));
        expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
            level: 'success',
            message: 'Created a ClickUp task for the alert.'
        }));
    });

    it('assigns a task to the configured ClickUp email instead of the API token owner', async () => {
        const saveSettings = vi.fn((settings) => settings);
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/team/team-1/user')) {
                return new Response(JSON.stringify({
                    users: [
                        { id: 77, username: 'token-owner', email: 'owner@example.com' },
                        { id: 88, username: 'support-user', email: 'support@example.com' }
                    ]
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            if (url.endsWith('/user')) {
                return new Response(JSON.stringify({
                    user: {
                        id: 77,
                        username: 'token-owner',
                        email: 'owner@example.com'
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            if (url.endsWith('/list/list-123/task')) {
                const payload = JSON.parse(String(init?.body ?? '{}'));
                expect(payload.assignees).toEqual(['88']);
                return new Response(JSON.stringify({ id: 'task-901' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });

        const runtime = createClickUpRuntime({
            getSettings: () => ({
                ...DEFAULT_CLICKUP_SETTINGS,
                enabled: true,
                apiToken: 'pk_demo',
                workspaceId: 'team-1',
                listId: 'list-123',
                userEmail: 'support@example.com'
            }),
            saveSettings,
            getOperatorName: () => 'GajenderT',
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        await runtime.createTaskForAlert(createAlert());

        expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
            memberId: '88',
            assigneeUserId: '88',
            userEmail: 'support@example.com'
        }));
    });

    it('uses a configured ClickUp member ID without looking up workspace users', async () => {
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/list/list-123/task')) {
                const payload = JSON.parse(String(init?.body ?? '{}'));
                expect(payload.assignees).toEqual(['99']);
                return new Response(JSON.stringify({ id: 'task-902' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });

        const runtime = createClickUpRuntime({
            getSettings: () => ({
                ...DEFAULT_CLICKUP_SETTINGS,
                enabled: true,
                apiToken: 'pk_demo',
                listId: 'list-123',
                memberId: '99',
                assigneeUserId: '99'
            }),
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        await runtime.createTaskForAlert(createAlert());
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('assigns a ticket started by an operator to that operator', async () => {
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/team/team-1/user')) {
                return new Response(JSON.stringify({
                    users: [
                        { id: 101, username: 'gajendert', email: 'gajender@example.com' },
                        { id: 202, username: 'other-user', email: 'other@example.com' }
                    ]
                }), { status: 200 });
            }

            if (url.endsWith('/list/list-123/task')) {
                const payload = JSON.parse(String(init?.body ?? '{}'));
                expect(payload.assignees).toEqual(['101']);
                return new Response(JSON.stringify({ id: 'task-903' }), { status: 200 });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });
        const saveSettings = vi.fn((settings) => settings);
        const runtime = createClickUpRuntime({
            getSettings: () => ({
                ...DEFAULT_CLICKUP_SETTINGS,
                enabled: true,
                apiToken: 'pk_demo',
                workspaceId: 'team-1',
                listId: 'list-123'
            }),
            saveSettings,
            getOperatorName: () => 'GajenderT',
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        await runtime.createTaskForAlert(createAlert(), { assignToOperator: true });

        expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
            memberId: '101',
            assigneeUserId: '101'
        }));
    });

    it('resolves a configured email once and reuses the cached member ID', async () => {
        let currentSettings = {
            ...DEFAULT_CLICKUP_SETTINGS,
            apiToken: 'pk_demo',
            workspaceId: 'team-1',
            userEmail: 'support@example.com'
        };
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.endsWith('/team/team-1/user')) {
                return new Response(JSON.stringify({
                    users: [
                        { id: 88, username: 'support-user', email: 'support@example.com' }
                    ]
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            if (url.endsWith('/user')) {
                return new Response(JSON.stringify({
                    user: { id: 77, username: 'token-owner', email: 'owner@example.com' }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });

        const runtime = createClickUpRuntime({
            getSettings: () => currentSettings,
            saveSettings: (candidate) => {
                currentSettings = {
                    ...currentSettings,
                    ...candidate
                };
                return currentSettings;
            },
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        await expect(runtime.resolveConfiguredAssignee()).resolves.toEqual({
            memberId: '88',
            userEmail: 'support@example.com'
        });
        await expect(runtime.resolveConfiguredAssignee()).resolves.toEqual({
            memberId: '88',
            userEmail: 'support@example.com'
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('posts the AI diagnostic and attaches the matching job history log', async () => {
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-clickup-'));
        const logPath = path.join(tempDirectory, 'ibm-eye-2026-08-30.log');
        await fs.writeFile(logPath, '[2026-08-30T09:00:00.000Z] MSGW detected\n', 'utf8');

        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/task/task-900/comment')) {
                const payload = JSON.parse(String(init?.body ?? '{}'));
                expect(payload.comment_text).toContain('Issue: MSGW detected');
                expect(payload.comment_text).toContain('How to resolve: Reply to the message.');
                return new Response('{}', { status: 200 });
            }

            if (url.endsWith('/task/task-900/attachment')) {
                expect(init?.body).toBeInstanceOf(FormData);
                expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toBe('pk_demo');
                return new Response('{}', { status: 200 });
            }

            throw new Error(`Unexpected fetch: ${url}`);
        });

        const runtime = createClickUpRuntime({
            getSettings: () => ({
                ...DEFAULT_CLICKUP_SETTINGS,
                enabled: true,
                apiToken: 'pk_demo',
                listId: 'list-123'
            }),
            getJobReadableLogFilePath: async () => logPath,
            recordActivity: vi.fn(),
            fetchImpl: fetchImpl as typeof fetch
        });

        await runtime.publishAlertDiagnostic({
            alertId: 'msgw:123/DEMO/JOB',
            taskId: 'task-900',
            jobName: 'QINTER/MSGWJOB',
            diagnostic: [
                'Issue: MSGW detected',
                'Why: Waiting for an operator reply.',
                'How to resolve: Reply to the message.'
            ].join('\n')
        });

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        await fs.rm(tempDirectory, { recursive: true, force: true });
    });
});
