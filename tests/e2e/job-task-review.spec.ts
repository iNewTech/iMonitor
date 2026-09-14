import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

const jobName = '123456/OPERATOR/REVIEWJOB';
const alert = {
    id: 'review-alert', jobName, title: 'CPU threshold exceeded', message: 'CPU stayed high.',
    severity: 'warning', kind: 'highCpu', isActive: true, workflowStatus: 'new',
    timeline: [
        { id: 'note', timestamp: '2026-09-11T10:02:00Z', action: 'note', label: 'Note added', actor: 'Operator <A>', detail: 'Checked <script>unsafe</script> & queues.' },
        { id: 'created', timestamp: '2026-09-11T10:00:00Z', action: 'created', label: 'Incident created', detail: 'CPU reached 95%.' }
    ]
};
const resolutionMemoryEntry = {
    id: 'resolution-review-1', procedureKey: `system-a:highCpu:${jobName}`, version: 1, status: 'draft', systemId: 'system-a', incidentKind: 'highCpu',
    jobPattern: jobName, title: 'High CPU recovery', symptoms: ['CPU stayed high.'], evidenceRefs: ['trigger @ 2026-09-11T10:00:00Z'],
    failedAttempts: [], successfulAction: 'Hold after evidence review.', verifiedOutcome: 'Monitoring confirmed recovery.',
    environment: { systemLabel: 'Test system', jobType: 'BATCH', subsystem: 'QBATCH' }, operator: 'l2-operator', sourceIncidentId: 'review-alert',
    createdAt: '2026-09-11T10:03:00Z', reviewHistory: [{ action: 'created', actor: 'l2-operator', at: '2026-09-11T10:03:00Z', version: 1 }]
};
const payload = {
    job: { JOB_NAME: jobName, SUBSYSTEM_JOB: 'REVIEWJOB', SUBSYSTEM: 'QBATCH', CURRENT_USER: 'OPERATOR',
        STATUS: 'RUN', CPU: 95, ELAPSED_CPU_TIME: 1200, THREAD_COUNT: 2, TEMPORARY_STORAGE: 20,
        ELAPSED_TOTAL_DISK_IO_COUNT: 0, TOTAL_DISK_IO_COUNT: 999 },
    waitReason: 'No wait detected.',
    statusHistory: [{ status: 'RUN', label: 'Running', timestamp: '2026-09-11T10:00:00Z' }],
    actions: [
        { kind: 'holdJob', label: 'Hold Job', enabled: true },
        { kind: 'endJob', label: 'End Job', enabled: true, dangerous: true },
        { kind: 'replyMessage', label: 'Reply to MSGW', enabled: false, reason: 'No message is waiting.' }
    ],
    actionPlanner: {
        schema: 'imonitor-action-planner', version: 1, jobName,
        primary: { kind: 'claim', label: 'Claim work', reason: 'Assign this incident to the logged-in operator before changing the job.' },
        proposals: [
            { schema: 'imonitor-action-proposal', version: 1, id: 'operator:holdJob', sources: ['operator'], actionKind: 'holdJob', label: 'Hold Job', jobName, state: 'ready', rationale: 'Available from the current job state.', effect: 'Hold the selected IBM i job.', riskClass: 'medium', requiredPermissions: ['execute'], evidenceRequirements: ['current job identity'], verificationRule: 'The next monitoring poll must show the requested hold state.', citations: [] },
            { schema: 'imonitor-action-proposal', version: 1, id: 'operator:endJob', sources: ['operator'], actionKind: 'endJob', label: 'End Job', jobName, state: 'ready', rationale: 'Available from the current job state.', effect: 'End the selected IBM i job.', riskClass: 'high', requiredPermissions: ['execute'], evidenceRequirements: ['current job identity'], verificationRule: 'The next monitoring poll must confirm that the job ended.', citations: [] }
        ],
        escalationReasons: []
    }
};

type Reply = { value?: unknown; error?: string; hold?: boolean };
type MockState = {
    replies: Record<string, Reply>;
    calls: Record<string, unknown[][]>;
    releases: Record<string, Array<() => void>>;
};
type TestHandle = { app: ElectronApplication; page: Page; errors: string[] };

async function configure(app: ElectronApplication, replies: Record<string, Reply>) {
    await app.evaluate((_electron, next) => {
        const state = (globalThis as unknown as { taskReview: MockState }).taskReview;
        Object.assign(state.replies, next);
    }, replies);
}
async function calls(app: ElectronApplication, channel: string) {
    return app.evaluate((_electron, key) =>
        (globalThis as unknown as { taskReview: MockState }).taskReview.calls[key] || [], channel);
}
async function release(app: ElectronApplication, channel: string) {
    await app.evaluate((_electron, key) => {
        const state = (globalThis as unknown as { taskReview: MockState }).taskReview;
        state.releases[key]?.splice(0).forEach((resolve) => resolve());
    }, channel);
}
async function pushAlerts(app: ElectronApplication, alerts: unknown[]) {
    await app.evaluate(({ BrowserWindow }, value) => {
        BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().includes('job-task.html'))
            .forEach((window) => window.webContents.send('alerts-updated', value));
    }, alerts);
}

// Run the real app/preload/window route with a disposable profile. All task IPC
// services are stubbed before opening the window: no IBM i, AI or external writes.
const test = base.extend<{ task: TestHandle }>({
    task: async ({}, use) => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-task-review-'));
        let app: ElectronApplication | undefined;
        try {
            const store = path.join(root, 'store');
            const profile = path.join(root, 'user-data');
            await Promise.all([fs.mkdir(store), fs.mkdir(profile)]);
            app = await electron.launch({ args: [path.resolve(process.cwd())], env: {
                ...process.env, IBM_EYE_STORE_DIR: store, IBM_EYE_USER_DATA_DIR: profile
            } });
            const connection = await app.firstWindow();
            await connection.waitForLoadState('domcontentloaded');
            await app.evaluate(({ ipcMain }, initial) => {
                const state: MockState = { replies: initial, calls: {}, releases: {} };
                (globalThis as unknown as { taskReview: MockState }).taskReview = state;
                for (const channel of Object.keys(initial)) {
                    ipcMain.removeHandler(channel);
                    ipcMain.handle(channel, async (_event, ...args) => {
                        (state.calls[channel] ||= []).push(args);
                        const reply = structuredClone(state.replies[channel]);
                        if (reply.hold) await new Promise<void>((resolve) => (state.releases[channel] ||= []).push(resolve));
                        if (reply.error) throw new Error(reply.error);
                        return reply.value;
                    });
                }
            }, {
                'get-job-details': { value: payload }, 'get-active-alerts': { value: [alert] },
                'get-resolution-memory': { value: { success: true, entries: [resolutionMemoryEntry], matches: [] } },
                'get-app-flags': { value: { operatorName: 'reviewer' } },
                'get-entitlements': { value: { features: {} } },
                'get-mcp-action-catalog': { value: { success: true, actions: [
                    { capabilityId: 'ibmi-job-control', capabilityName: 'IBM i Job Control', skillVersion: '1.0.0', tool: 'hold-job', label: 'Hold job', jobName, effect: 'Hold the selected IBM i job.', riskClass: 'medium', requiredPermissions: ['execute'], evidenceRequirements: ['current job identity', 'current job status'], verificationRule: 'The next monitoring poll must show the requested hold state.', available: true }
                ] } },
                'preview-mcp-action': { value: { success: true, preview: {
                    schema: 'imonitor-mcp-action-preview', version: 1, previewId: 'mcp-preview-1', capabilityId: 'ibmi-job-control', capabilityName: 'IBM i Job Control', skillVersion: '1.0.0', tool: 'hold-job', operatorAction: 'holdJob', jobName, scope: { customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'reviewer' }, effect: 'Hold the selected IBM i job.', riskClass: 'medium', requiredPermissions: ['execute'], evidenceRequirements: ['current job identity', 'current job status'], evidence: { capturedAt: '2026-09-11T10:00:00Z', current: true, summary: 'Current job evidence.' }, inputHash: 'hash', verificationRule: 'The next monitoring poll must show the requested hold state.', outputSchema: 'Action result and verification.', state: 'awaiting-approval', createdAt: '2026-09-11T10:00:00Z', expiresAt: '2026-09-11T10:02:00Z', approval: { required: true, status: 'pending' }
                } } },
                'run-mcp-action': { value: { success: true, preview: {
                    schema: 'imonitor-mcp-action-preview', version: 1, previewId: 'mcp-preview-1', capabilityId: 'ibmi-job-control', capabilityName: 'IBM i Job Control', skillVersion: '1.0.0', tool: 'hold-job', operatorAction: 'holdJob', jobName, scope: { customerScope: 'customer-a', systemScope: 'system-a', operatorId: 'reviewer' }, effect: 'Hold the selected IBM i job.', riskClass: 'medium', requiredPermissions: ['execute'], evidenceRequirements: ['current job identity', 'current job status'], evidence: { capturedAt: '2026-09-11T10:00:00Z', current: true, summary: 'Current job evidence.' }, inputHash: 'hash', verificationRule: 'The next monitoring poll must show the requested hold state.', outputSchema: 'Action result and verification.', state: 'recovered', createdAt: '2026-09-11T10:00:00Z', expiresAt: '2026-09-11T10:02:00Z', approval: { required: true, status: 'approved' }
                }, verification: { status: 'recovered', summary: 'The next monitoring read verified the hold.', evidence: ['Job status: HELD'] } } },
                'update-alert-workflow': { value: { success: true } },
                'create-clickup-task-for-alert': { value: { success: true } },
                'run-job-action': { value: { success: true, message: 'Job held.' } },
                'get-verified-runbook': { value: { success: true, definition: null, execution: null } },
                'start-verified-runbook': { value: { success: true } },
                'run-verified-runbook-step': { value: { success: true } },
                'ask-ai-assistant': { value: { success: true, reply: '## Evidence\nReview the job log.' } },
                'get-job-log': { value: { success: true, records: [] } },
                'get-job-messages': { value: { success: true, records: [] } },
                'get-problem-workspace': { value: {
                    success: true,
                    records: [{ schema: 'imonitor-problem-record', version: 1, id: 'problem-1', systemId: 'test-system', status: 'candidate', title: 'Recurring high CPU', incidentKind: 'highCpu', jobPattern: jobName, environment: { jobType: 'BATCH', subsystem: 'QBATCH' }, occurrences: [{ incidentId: 'review-alert', occurrence: 1, jobName, title: 'CPU threshold exceeded', kind: 'highCpu', timestamp: '2026-09-11T10:00:00Z', evidence: ['CPU reached 95%.'], environment: { jobType: 'BATCH', subsystem: 'QBATCH' } }], createdAt: '2026-09-11T10:00:00Z', updatedAt: '2026-09-11T10:00:00Z' }],
                    matches: [{ recordId: 'problem-1', score: 100, reasons: ['Same IBM i system.', 'Same job and condition.', 'The incident fingerprint matches a previous occurrence.'] }],
                    recurringSignal: false
                } },
                'confirm-problem-record': { value: { success: true } },
                'record-problem-occurrence': { value: { success: true } },
                'create-problem-candidate': { value: { success: true } },
                'resolve-problem-record': { value: { success: true } },
                'approve-resolution-memory': { value: { success: true, entry: { ...resolutionMemoryEntry, status: 'approved', reviewer: 'reviewer' }, entries: [{ ...resolutionMemoryEntry, status: 'approved', reviewer: 'reviewer' }] } },
                'reject-resolution-memory': { value: { success: true, entry: { ...resolutionMemoryEntry, status: 'rejected', reviewer: 'reviewer' }, entries: [{ ...resolutionMemoryEntry, status: 'rejected', reviewer: 'reviewer' }] } },
                'revise-resolution-memory': { value: { success: true, entry: { ...resolutionMemoryEntry, status: 'draft', version: 2, title: 'Reviewed high CPU recovery' }, entries: [{ ...resolutionMemoryEntry, status: 'draft', version: 2, title: 'Reviewed high CPU recovery' }] } },
                'get-incident-replay-catalog': { value: {
                    success: true,
                    scenarios: [{ schema: 'imonitor-replay-scenario', version: 1, id: 'msgw-stale-reply', title: 'Stale reply is blocked', kind: 'messageWait', description: 'Stale evidence.', evidence: [{ source: 'messages', status: 'stale', summary: 'Old inquiry.' }], checks: [{ id: 'current', label: 'Current message is verified', expected: 'Fresh evidence.' }], permittedResponses: ['investigate', 'replyMessage', 'escalate'], expectedOutcome: 'unsafe-blocked', expectedSummary: 'The response is blocked.' }]
                } },
                'run-incident-replay': { value: { success: true, result: { schema: 'imonitor-replay-result', version: 1, scenarioId: 'msgw-stale-reply', response: 'replyMessage', outcome: 'unsafe-blocked', checks: [{ id: 'current', label: 'Current message is verified', status: 'blocked', detail: 'Blocked by training safety boundary.' }], evidence: [], summary: 'Training blocked the unsafe response. No live action was executed.', trainingOnly: true, executedLiveAction: false } } },
                'open-external-url': { value: { success: true } },
                'create-incident-handoff': { value: { success: true, handoff: {
                    schema: 'imonitor-incident-handoff', version: 1, id: 'handoff-1', incidentId: 'review-alert',
                    fromOperator: 'reviewer', toOperator: 'l3-specialist', reason: 'Specialist review.',
                    pendingChecks: ['Find the blocker'], createdAt: '2026-09-11T10:03:00Z', status: 'pending'
                } } },
                'accept-incident-handoff': { value: { success: true, handoff: {
                    schema: 'imonitor-incident-handoff', version: 1, id: 'handoff-2', incidentId: 'review-alert',
                    fromOperator: 'l2-operator', toOperator: 'reviewer', reason: 'Specialist review.',
                    pendingChecks: ['Find the blocker'], createdAt: '2026-09-11T10:03:00Z',
                    acceptedAt: '2026-09-11T10:04:00Z', acceptedBy: 'reviewer', status: 'accepted'
                } } },
            });
            const opened = app.waitForEvent('window');
            await connection.evaluate(async (name) => {
                await (window as unknown as { electronAPI: { openJobTaskWindow(name: string): Promise<unknown> } }).electronAPI.openJobTaskWindow(name);
            }, jobName);
            const page = await opened;
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.waitForLoadState('domcontentloaded');
            await expect(page.locator('#task-title')).toHaveText('REVIEWJOB');
            await expect(page.locator('body')).toHaveAttribute('data-theme', 'operator-light');
            // Deterministically advance the renderer's periodic refresh in tests.
            await page.clock.install();
            await use({ app, page, errors });
            expect(errors).toEqual([]);
        } finally {
            if (app) await app.close();
            await fs.rm(root, { recursive: true, force: true });
        }
    }
});

test('reuses the same task window and opens another for a different job', async ({ task: { app } }) => {
    const connection = app.windows().find((window) => !window.url().includes('job-task.html'));
    expect(connection).toBeDefined();
    const initialWindowCount = app.windows().length;

    await connection!.evaluate(async (name) => {
        await (window as unknown as { electronAPI: { openJobTaskWindow(jobName: string): Promise<unknown> } }).electronAPI.openJobTaskWindow(name);
    }, jobName);
    await expect.poll(() => app.windows().length).toBe(initialWindowCount);

    const secondWindowPromise = app.waitForEvent('window');
    await connection!.evaluate(async (name) => {
        await (window as unknown as { electronAPI: { openJobTaskWindow(jobName: string): Promise<unknown> } }).electronAPI.openJobTaskWindow(name);
    }, '123456/OPERATOR/SECONDJOB');
    const secondWindow = await secondWindowPromise;
    await secondWindow.waitForLoadState('domcontentloaded');
    expect(secondWindow.url()).toContain('SECONDJOB');
    await expect.poll(() => app.windows().length).toBe(initialWindowCount + 1);
    await secondWindow.close();
});

test('compact task window keeps only Overview and History while preserving evidence', async ({ task: { app, page } }) => {
    await expect(page.getByRole('tab')).toHaveCount(2);
    const overview = page.getByRole('tab', { name: 'Overview', exact: true });
    await overview.focus();
    await overview.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'History', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(overview).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'History', exact: true })).toBeFocused();
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await expect(page.locator('#task-panel-ai')).toBeVisible();
    await page.locator('#task-panel-details > summary').click();
    await expect(page.locator('#task-load-log')).toBeVisible();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.locator('#task-panel-actions')).toBeHidden();
    await expect(page.locator('#task-panel-ai')).toBeHidden();
    await expect(page.locator('#task-panel-details')).toBeHidden();
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
    await pushAlerts(app, [alert, { ...alert, id: 'cleared', isActive: false, title: 'Recovered incident', workflowStatus: 'system_cleared' }]);
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.locator('#task-incident-history .alert-timeline-entry')).toHaveCount(4);
    await expect(page.locator('#task-incident-history')).toContainText('Operator <A>');
    await expect(page.locator('#task-incident-history')).toContainText('Checked <script>unsafe</script> & queues.');
    await expect(page.locator('#task-incident-history')).toContainText('Recovered incident');
    await expect(page.locator('#task-incident-history script')).toHaveCount(0);
    await expect(page.locator('#task-incident-history time').first()).not.toHaveText('');
    await expect(page.locator('#task-status-history')).toContainText('Running');
});

test('Overview shows the response brief and keeps handoff routing compact', async ({ task: { page } }) => {
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await expect(page.locator('#task-response-step-respond')).toHaveClass(/is-active/);
    await expect(page.locator('#task-response-impact')).toHaveText('High');
    await expect(page.locator('#task-response-owner')).toHaveText('Unassigned');
    await expect(page.locator('#task-response-evidence')).toContainText('Trigger');

    await expect(page.locator('#task-handoff-recipient')).toBeVisible();
    await expect(page.locator('#task-handoff-response-target')).toBeVisible();
    await expect(page.locator('#task-handoff-reason')).toBeVisible();
    await expect(page.locator('#task-handoff-pending-checks')).toBeVisible();
    await expect(page.locator('#task-handoff-pending-checks')).toHaveValue('');
    await expect(page.locator('#task-handoff-questions')).toHaveCount(0);
    await expect(page.locator('#task-copy-handoff, #task-download-handoff')).toHaveCount(0);
    await expect(page.locator('#task-refresh-shift-summary, #task-shift-summary')).toHaveCount(0);
});

test('shows one grounded next best action with compact proposal context', async ({ task: { page } }) => {
    await expect(page.locator('#task-action-planner')).toBeVisible();
    await expect(page.locator('#task-action-planner-title')).toHaveText('Claim work');
    await expect(page.locator('#task-action-planner-meta')).toContainText('2 proposals');
    await page.locator('#task-action-planner-details > summary').click();
    await expect(page.locator('#task-action-planner-list')).toContainText('Hold Job');
    await expect(page.locator('#task-action-planner-list')).toContainText('medium risk');
    await expect(page.locator('#task-action-planner-list')).toContainText('The next monitoring poll must show the requested hold state.');
});

test('keeps resolution review compact and records a revision for approval', async ({ task: { app, page } }) => {
    const memoryItem = page.locator('[data-memory-id="resolution-review-1"]');
    await expect(memoryItem).toContainText('Draft');
    await expect(memoryItem).toContainText('Operator: l2-operator');
    await expect(memoryItem).toContainText('Source: review-alert');
    await memoryItem.getByRole('button', { name: 'Revise' }).click();
    await expect(page.locator('#task-memory-revise-form')).toBeVisible();
    await page.locator('#task-memory-revise-title').fill('Reviewed high CPU recovery');
    await page.locator('#task-memory-revise-action').fill('Hold after current evidence review.');
    await page.locator('#task-memory-revise-outcome').fill('Verified on the next monitoring poll.');
    await page.locator('#task-memory-revise-save').click();
    await expect.poll(() => calls(app, 'revise-resolution-memory')).toHaveLength(1);
    expect((await calls(app, 'revise-resolution-memory'))[0]).toEqual([{
        entryId: 'resolution-review-1',
        revision: {
            title: 'Reviewed high CPU recovery',
            successfulAction: 'Hold after current evidence review.',
            verifiedOutcome: 'Verified on the next monitoring poll.'
        }
    }]);
    await expect(page.locator('#task-memory-revise-form')).toBeHidden();
});

test('previews and runs an approved MCP action inside the selected job task', async ({ task: { app, page } }) => {
    const holdTool = page.locator('#task-mcp-action-list [data-mcp-tool="hold-job"]');
    await expect(page.locator('#task-mcp-actions')).toBeVisible();
    await expect(holdTool).toContainText('medium risk');
    await holdTool.click();
    await expect(page.locator('#task-mcp-action-preview')).toBeVisible();
    await expect(page.locator('#task-mcp-action-preview')).toContainText('Hold the selected IBM i job.');
    await expect(page.locator('#task-mcp-action-preview')).toContainText('Verify: The next monitoring poll must show the requested hold state.');
    await expect(page.locator('#task-mcp-action-run')).toBeEnabled();
    expect(await calls(app, 'run-mcp-action')).toHaveLength(0);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#task-mcp-action-run').click();
    await expect.poll(() => calls(app, 'run-mcp-action')).toHaveLength(1);
    await expect(page.locator('#task-mcp-action-note')).toHaveText('The next monitoring read verified the hold.');
});

test('L3 workspace explains a problem match and captures confirmation evidence', async ({ task: { app, page } }) => {
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await expect(page.locator('#task-problem-panel')).toBeVisible();
    await expect(page.locator('#task-problem-status')).toContainText('Candidate');
    await expect(page.locator('#task-problem-match')).toContainText('Potential match');
    await page.locator('#task-problem-root-cause').fill('A runaway batch step keeps CPU above the threshold.');
    await page.locator('#task-problem-workaround').fill('Pause the workload and review the batch step before restart.');
    await configure(app, { 'confirm-problem-record': { value: { success: true, record: { status: 'confirmed', id: 'problem-1' }, records: [] } } });
    await page.locator('#task-problem-confirm').click();
    await expect(page.locator('#task-problem-note')).toHaveText('L3 problem record updated.');
    expect(JSON.stringify(await calls(app, 'confirm-problem-record'))).toContain('runaway batch step');
});

test('training replay stays isolated from IBM i actions', async ({ task: { app, page } }) => {
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await expect(page.locator('#task-replay-panel')).toBeVisible();
    await page.locator('#task-replay-response').selectOption('replyMessage');
    await page.locator('#task-replay-run').click();
    await expect(page.locator('#task-replay-result')).toContainText('No live action was executed.');
    expect(await calls(app, 'run-job-action')).toHaveLength(0);
    expect(JSON.stringify(await calls(app, 'run-incident-replay'))).toContain('replyMessage');
});

test('sends and accepts a persisted incident handoff', async ({ task: { app, page } }) => {
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await page.locator('#task-handoff-recipient').fill('l3-specialist');
    await page.locator('#task-handoff-reason').fill('Specialist review needed.');
    await page.locator('#task-handoff-pending-checks').fill('Find the blocking job.');
    await page.locator('#task-request-handoff').click();
    await expect(page.locator('#task-handoff-routing-status')).toHaveText('Handoff sent to l3-specialist.');
    expect(JSON.stringify(await calls(app, 'create-incident-handoff'))).toContain('Find the blocking job.');

    await pushAlerts(app, [{ ...alert, owner: 'reviewer', workflowUpdatedAt: '2026-09-11T10:03:00Z', handoff: {
        schema: 'imonitor-incident-handoff', version: 1, id: 'handoff-2', incidentId: 'review-alert',
        fromOperator: 'l2-operator', toOperator: 'reviewer', reason: 'Specialist review.',
        pendingChecks: ['Find the blocker'], createdAt: '2026-09-11T10:03:00Z', status: 'pending'
    } }]);
    await expect(page.locator('#task-accept-handoff')).toBeEnabled();
    await page.locator('#task-accept-handoff').click();
    await expect(page.locator('#task-handoff-routing-status')).toHaveText('Handoff accepted. You are now the owner.');
    expect(await calls(app, 'accept-incident-handoff')).toHaveLength(1);
});

test('workflow checks failures, deduplicates pending claims, and leaves ClickUp to main', async ({ task: { app, page } }) => {
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await configure(app, { 'update-alert-workflow': { value: { success: false, error: 'Claim rejected.' }, hold: true } });
    await page.getByRole('button', { name: 'Claim Work', exact: true }).click();
    await expect.poll(() => calls(app, 'update-alert-workflow')).toHaveLength(1);
    await pushAlerts(app, [alert]);
    await expect(page.getByRole('button', { name: 'Claim Work', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Hold Job', exact: true })).toBeDisabled();
    await page.locator('[data-action="claim"]').dispatchEvent('click');
    expect(await calls(app, 'update-alert-workflow')).toHaveLength(1);
    await release(app, 'update-alert-workflow');
    await expect(page.locator('#task-workflow-note')).toHaveText('Claim rejected.');
    expect(await calls(app, 'create-clickup-task-for-alert')).toHaveLength(0);
    await configure(app, { 'update-alert-workflow': { error: 'Workflow transport failed.' } });
    await page.getByRole('button', { name: 'Claim Work', exact: true }).click();
    await expect(page.locator('#task-workflow-note')).toContainText('Workflow transport failed.');
    await configure(app, { 'update-alert-workflow': { value: { success: true } } });
    await page.getByRole('button', { name: 'Claim Work', exact: true }).click();
    await expect(page.locator('#task-workflow-note')).toHaveText('Incident updated.');
    expect(await calls(app, 'create-clickup-task-for-alert')).toHaveLength(0);
});

test('AI actions reveal and focus the helper section, reject duplicate requests and recover from failures', async ({ task: { app, page } }) => {
    await configure(app, { 'ask-ai-assistant': { error: 'Provider unavailable.', hold: true } });
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await page.getByRole('button', { name: 'Explain Issue', exact: true }).click();
    await expect(page.locator('#task-panel-ai')).toBeVisible();
    await expect(page.locator('#task-panel-ai')).toBeFocused();
    await expect(page.locator('#task-ai-status')).toHaveText('Thinking');
    await expect(page.locator('#task-ai-summary')).toBeDisabled();
    await page.locator('#task-ai-resolve').dispatchEvent('click');
    await expect.poll(() => calls(app, 'ask-ai-assistant')).toHaveLength(1);
    expect(JSON.stringify(await calls(app, 'ask-ai-assistant'))).toContain('Explain this alert');
    expect(JSON.stringify(await calls(app, 'ask-ai-assistant'))).toContain('"scope":"job"');
    await release(app, 'ask-ai-assistant');
    await expect(page.locator('#task-ai-status')).toHaveText('Unavailable');
    await expect(page.locator('#task-ai-content')).toContainText('Provider unavailable.');
    await configure(app, { 'ask-ai-assistant': { value: { success: false, error: 'AI disabled.' } } });
    await page.locator('#task-ai-resolve').click();
    await expect(page.locator('#task-ai-content')).toContainText('AI disabled.');
    await configure(app, { 'ask-ai-assistant': { value: { success: true, reply: '## Evidence\nCheck the log.' } } });
    await page.locator('#task-ai-summary').click();
    await expect(page.locator('#task-ai-status')).toHaveText('Ready');
    await expect(page.locator('#task-ai-content')).toContainText('Check the log.');
});

test('shows compact cited sources and an unavailable-source state on demand', async ({ task: { app, page } }) => {
    await configure(app, { 'ask-ai-assistant': { value: {
        success: true,
        reply: '## Observed facts\nThe selected job is waiting.\n## Interpretation\nThe cause is not confirmed.\n## Missing evidence\nThe current owner is unknown.\n## Suggested checks\nInspect the lock owner.',
        retrievalHealth: { backend: 'local', state: 'ready', message: 'Local lexical retrieval is ready.', checkedAt: '2026-09-11T10:00:00Z' },
        contextPack: {
            scope: { customerScope: 'customer-a', systemScope: 'system-a', qualifiedJob: jobName },
            freshness: 'mixed',
            citations: [
                { id: 'citation:job', recordId: 'job-1', label: 'Current job snapshot', status: 'current', observedAt: '2026-09-11T10:00:00Z', excerpt: 'Job is waiting on a lock.', sourceRef: { kind: 'job', id: jobName, locator: `job://${jobName}` } },
                { id: 'citation:gone', recordId: 'gone-1', label: 'Deleted runbook', status: 'unavailable', observedAt: '2026-09-01T10:00:00Z', sourceRef: { kind: 'file', id: 'gone-1', locator: 'local://deleted.md' } }
            ],
            relevanceReasons: [
                { recordId: 'job-1', reasons: ['Exact identifier: REVIEWJOB', 'Matches active IBM i system'], source: 'lexical' }
            ]
        }
    } } });
    await page.getByRole('button', { name: 'How To Resolve', exact: true }).click();
    await expect(page.locator('#task-ai-citations')).toBeVisible();
    await expect(page.locator('#task-ai-citations')).toContainText('Knowledge ready');
    await expect(page.locator('#task-ai-citations')).toContainText('Evidence mixed');
    await expect(page.locator('.ai-citation-chip')).toHaveCount(2);
    await page.locator('.ai-citation-chip').first().click();
    await expect(page.locator('#task-ai-citation-dialog')).toBeVisible();
    await expect(page.locator('#task-ai-citation-detail')).toContainText('Current job snapshot');
    await expect(page.locator('#task-ai-citation-detail')).toContainText('Job is waiting on a lock.');
    await expect(page.locator('#task-ai-citation-detail')).toContainText('Why this source:');
    await page.locator('#task-ai-citation-close').click();
    await page.locator('.ai-citation-chip').nth(1).click();
    await expect(page.locator('#task-ai-citation-detail')).toContainText('Source excerpt unavailable');
    await page.locator('#task-ai-citation-close').click();
});

test('refresh batches cannot overlap or replace newer pushed alerts and retry after initial failure', async ({ task: { app, page } }) => {
    await configure(app, { 'get-job-details': { error: 'Connection unavailable.' } });
    await page.reload();
    await expect(page.locator('#task-sync-state')).toContainText('Offline');
    await expect(page.locator('#task-empty')).toContainText('Connection unavailable.');
    await expect(page.locator('#task-content')).toBeHidden();
    await configure(app, { 'get-job-details': { value: payload } });
    await page.locator('#task-refresh').click();
    await expect(page.locator('#task-content')).toBeVisible();
    await page.clock.install();
    const baseline = (await calls(app, 'get-job-details')).length;
    await configure(app, { 'get-job-details': { value: payload, hold: true } });
    await page.locator('#task-refresh').click();
    await expect.poll(() => calls(app, 'get-job-details')).toHaveLength(baseline + 1);
    await pushAlerts(app, [{ ...alert, title: 'Newer pushed evidence' }]);
    await expect(page.locator('#task-issue-title')).toHaveText('Newer pushed evidence');
    await page.clock.runFor(15000);
    expect(await calls(app, 'get-job-details')).toHaveLength(baseline + 1);
    await release(app, 'get-job-details');
    await expect(page.locator('#task-refresh')).toBeEnabled();
    await expect(page.locator('#task-issue-title')).toHaveText('Newer pushed evidence');
});

test('job operations invalidate old refreshes, preserve feedback and confirmation', async ({ task: { app, page } }) => {
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Hold Job', exact: true }).click();
    expect(await calls(app, 'run-job-action')).toHaveLength(0);
    await configure(app, { 'get-job-details': { value: { ...payload, job: { ...payload.job, STATUS: 'STALE' } }, hold: true },
        'run-job-action': { value: { success: true, message: 'Job held.' }, hold: true } });
    await page.locator('#task-refresh').click();
    await expect.poll(() => calls(app, 'get-job-details')).toHaveLength(2);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Hold Job', exact: true }).click();
    await expect.poll(() => calls(app, 'run-job-action')).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'End Job', exact: true })).toBeDisabled();
    await release(app, 'get-job-details');
    await expect(page.locator('#task-status')).toHaveText('RUN');
    await configure(app, { 'get-job-details': { value: { ...payload, job: { ...payload.job, STATUS: 'HLD' } } } });
    await release(app, 'run-job-action');
    await expect(page.locator('#task-action-note')).toHaveText('Job held.');
    await expect(page.locator('#task-status')).toHaveText('HLD');
    await page.locator('#task-refresh').click();
    await expect(page.locator('#task-refresh')).toBeEnabled();
    await expect(page.locator('#task-action-note')).toHaveText('Job held.');
    await expect(page.getByRole('button', { name: 'Reply to MSGW', exact: true })).toBeDisabled();
    await configure(app, { 'run-job-action': { error: 'Permission denied.' } });
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Hold Job', exact: true }).click();
    await expect(page.locator('#task-action-note')).toContainText('Permission denied.');
});

test('detail requests share a lock and display returned and thrown errors; external failures are visible', async ({ task: { app, page } }) => {
    await page.locator('#task-panel-details > summary').click();
    await configure(app, { 'get-job-log': { error: 'Log transport failed.', hold: true } });
    await page.locator('#task-load-log').click();
    await expect.poll(() => calls(app, 'get-job-log')).toHaveLength(1);
    await expect(page.locator('#task-load-messages')).toBeDisabled();
    await page.locator('#task-load-log').dispatchEvent('click');
    await page.locator('#task-load-messages').dispatchEvent('click');
    expect(await calls(app, 'get-job-log')).toHaveLength(1);
    expect(await calls(app, 'get-job-messages')).toHaveLength(0);
    await release(app, 'get-job-log');
    await expect(page.locator('#task-details-output')).toContainText('Log transport failed.');
    await configure(app, { 'get-job-messages': { value: { success: false, error: 'Message access denied.', records: [] } } });
    await page.locator('#task-load-messages').click();
    await expect(page.locator('#task-details-output')).toContainText('Message access denied.');
    await configure(app, { 'get-job-log': { value: { success: true, records: [{ MESSAGE_TIMESTAMP: '2026-09-11T10:00:00Z', MESSAGE_TEXT: 'Review message', MESSAGE_ID: 'CPF1234' }] } } });
    await page.locator('#task-load-log').click();
    await expect(page.locator('#task-details-output')).toContainText('CPF1234');
    await pushAlerts(app, [{ ...alert, clickUpTask: { id: 'mock-task', url: 'https://example.invalid/task' } }]);
    await configure(app, { 'open-external-url': { error: 'Link could not open.' } });
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await page.getByRole('button', { name: 'Open ClickUp', exact: true }).click();
    await expect(page.locator('#task-workflow-note')).toContainText('Link could not open.');
});

test('task panels stay usable at the minimum window size', async ({ task: { page } }, testInfo) => {
    await page.setViewportSize({ width: 560, height: 460 });
    for (const name of ['Overview', 'History']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await expect(page.locator('#task-panel-actions')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('task-actions-560.png'), fullPage: true });
});

test('MCP preview cancellation and input edits discard late approval responses', async ({ task: { app, page } }) => {
    const tool = page.locator('[data-mcp-tool="hold-job"]');
    await configure(app, { 'preview-mcp-action': { hold: true, value: { success: true, preview: {
        previewId: 'late-preview', state: 'awaiting-approval', effect: 'Hold job'
    } } } });
    await tool.click();
    await expect.poll(() => calls(app, 'preview-mcp-action')).toHaveLength(1);
    await expect(page.locator('#task-mcp-action-cancel')).toBeVisible();
    await page.locator('#task-mcp-action-cancel').click();
    await release(app, 'preview-mcp-action');
    await expect(tool).toBeEnabled();
    await expect(page.locator('#task-mcp-action-preview')).toBeHidden();
    await expect(page.locator('#task-mcp-action-run')).toBeDisabled();

    await configure(app, { 'get-mcp-action-catalog': { value: { success: true, actions: [{
        capabilityId: 'ibmi-job-control', tool: 'end-job', available: true, label: 'End job', riskClass: 'high', effect: 'End job'
    }] } } });
    await page.locator('#task-refresh').click();
    await page.locator('[data-mcp-tool="end-job"]').click();
    await expect.poll(() => calls(app, 'preview-mcp-action')).toHaveLength(2);
    await page.locator('#task-mcp-action-input').fill('{"endOption":"controlled"}');
    await release(app, 'preview-mcp-action');
    await expect(page.locator('[data-mcp-tool="end-job"]')).toBeEnabled();
    await expect(page.locator('#task-mcp-action-preview')).toBeHidden();
    await page.locator('#task-mcp-action-run').dispatchEvent('click');
    expect(await calls(app, 'run-mcp-action')).toHaveLength(0);
});

test('a refresh invalidates in-flight MCP previews and failures still refresh job evidence', async ({ task: { app, page } }) => {
    await configure(app, { 'preview-mcp-action': { hold: true, value: { success: true, preview: {
        previewId: 'stale-preview', state: 'awaiting-approval', effect: 'Hold job'
    } } } });
    await page.locator('[data-mcp-tool="hold-job"]').click();
    await expect.poll(() => calls(app, 'preview-mcp-action')).toHaveLength(1);
    await page.locator('#task-refresh').dispatchEvent('click');
    await expect.poll(() => calls(app, 'get-job-details')).toHaveLength(2);
    // Wait for the complete batch, not just the initial job read.
    await expect.poll(() => calls(app, 'get-resolution-memory')).toHaveLength(3);
    await release(app, 'preview-mcp-action');
    await expect(page.locator('[data-mcp-tool="hold-job"]')).toBeEnabled();
    await expect(page.locator('#task-mcp-action-preview')).toBeHidden();
    await configure(app, { 'preview-mcp-action': { value: { success: true, preview: {
        previewId: 'current-preview', state: 'awaiting-approval', effect: 'Hold job'
    } } }, 'run-mcp-action': { value: { success: false, error: 'Verification unknown.' } },
    'get-job-details': { value: { ...payload, job: { ...payload.job, STATUS: 'HLD' } } } });
    await page.locator('[data-mcp-tool="hold-job"]').click();
    await expect(page.locator('#task-mcp-action-run')).toBeEnabled();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#task-mcp-action-run').click();
    await expect(page.locator('#task-mcp-action-note')).toHaveText('Verification unknown.');
    await expect(page.locator('#task-status')).toHaveText('HLD');
    await expect(page.locator('#task-mcp-action-run')).toBeDisabled();
});

test('job mutations and runbook checkpoints share protection with MCP actions', async ({ task: { app, page } }) => {
    const definition = { title: 'Recovery', steps: [{ title: 'Verify job', kind: 'verify', expectedOutcome: 'Current evidence', confirmationRequired: false }] };
    const execution = { id: 'runbook-1', operator: 'reviewer', status: 'running', currentStepIndex: 0, steps: [] };
    await configure(app, {
        'get-job-details': { value: { ...payload, runbook: { id: 'recovery' } } },
        'get-verified-runbook': { value: { success: true, definition, execution } },
        'run-verified-runbook-step': { hold: true, value: { success: true, definition, execution } }
    });
    await page.locator('#task-refresh').click();
    await expect(page.locator('#task-runbook-step')).toBeEnabled();
    await page.locator('#task-runbook-step').click();
    await expect.poll(() => calls(app, 'run-verified-runbook-step')).toHaveLength(1);
    await pushAlerts(app, [alert]);
    await expect(page.locator('[data-action-kind="holdJob"]')).toBeDisabled();
    await expect(page.locator('[data-mcp-tool="hold-job"]')).toBeDisabled();
    await page.locator('[data-action-kind="holdJob"]').dispatchEvent('click');
    await page.locator('[data-mcp-tool="hold-job"]').dispatchEvent('click');
    expect(await calls(app, 'run-job-action')).toHaveLength(0);
    expect(await calls(app, 'preview-mcp-action')).toHaveLength(0);
    await release(app, 'run-verified-runbook-step');
    await expect(page.locator('[data-action-kind="holdJob"]')).toBeEnabled();

    await configure(app, { 'run-job-action': { hold: true, value: { success: true } } });
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-action-kind="holdJob"]').click();
    await expect.poll(() => calls(app, 'run-job-action')).toHaveLength(1);
    await expect(page.locator('#task-runbook-step')).toBeDisabled();
    await page.locator('#task-runbook-step').dispatchEvent('click');
    expect(await calls(app, 'run-verified-runbook-step')).toHaveLength(1);
    await release(app, 'run-job-action');
    await expect(page.locator('#task-runbook-step')).toBeEnabled();
});

test('late resolution memory reads cannot restore a draft after approval', async ({ task: { app, page } }) => {
    const memory = page.locator('[data-memory-id="resolution-review-1"]');
    await configure(app, { 'get-resolution-memory': { hold: true, value: { success: true, entries: [resolutionMemoryEntry] } } });
    const before = (await calls(app, 'get-resolution-memory')).length;
    await pushAlerts(app, [alert]);
    await expect.poll(() => calls(app, 'get-resolution-memory')).toHaveLength(before + 1);
    await configure(app, { 'get-resolution-memory': { value: { success: true, entries: [{ ...resolutionMemoryEntry, status: 'approved' }] } } });
    await memory.locator('[data-memory-action="approve"]').click();
    await expect(memory).toContainText('Approved');
    await release(app, 'get-resolution-memory');
    // Cross another renderer event-loop turn after the old response is delivered.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await expect(memory).toContainText('Approved');
    await expect(memory.locator('[data-memory-action="approve"]')).toHaveCount(0);
});

test('memory refreshes keep pending review controls disabled and preserve the revision draft', async ({ task: { app, page } }) => {
    const memory = page.locator('[data-memory-id="resolution-review-1"]');
    await memory.locator('[data-memory-action="revise"]').click();
    await page.locator('#task-memory-revise-title').fill('Unsaved operator draft');
    await pushAlerts(app, [alert]);
    await expect(page.locator('#task-memory-revise-title')).toHaveValue('Unsaved operator draft');
    await configure(app, { 'revise-resolution-memory': { hold: true, value: { success: false, error: 'Revision rejected.' } } });
    await page.locator('#task-memory-revise-save').click();
    await expect.poll(() => calls(app, 'revise-resolution-memory')).toHaveLength(1);
    await pushAlerts(app, [alert]);
    await expect(memory.locator('[data-memory-action="revise"]')).toBeDisabled();
    await expect(page.locator('#task-memory-revise-cancel')).toBeDisabled();
    await memory.locator('[data-memory-action="revise"]').dispatchEvent('click');
    await expect(page.locator('#task-memory-revise-title')).toHaveValue('Unsaved operator draft');
    await release(app, 'revise-resolution-memory');
    await expect(page.locator('#task-memory-status')).toHaveText('Revision rejected.');
    await expect(page.locator('#task-memory-revise-save')).toBeEnabled();
    await pushAlerts(app, [alert]);
    await expect(page.locator('#task-memory-status')).toHaveText('Revision rejected.');
});

test('a mutation invalidates a refresh already waiting on runbook evidence', async ({ task: { app, page } }) => {
    const definition = { title: 'Recovery', steps: [{ title: 'Verify job', kind: 'verify', expectedOutcome: 'Current evidence' }] };
    await configure(app, {
        'get-job-details': { value: { ...payload, job: { ...payload.job, STATUS: 'STALE' }, runbook: { id: 'recovery' } } },
        'get-verified-runbook': { hold: true, value: { success: true, definition, execution: null } },
        'run-job-action': { hold: true, value: { success: true, message: 'Job held.' } }
    });
    await page.locator('#task-refresh').click();
    await expect.poll(() => calls(app, 'get-verified-runbook')).toHaveLength(1);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-action-kind="holdJob"]').click();
    await expect.poll(() => calls(app, 'run-job-action')).toHaveLength(1);
    await release(app, 'get-verified-runbook');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await expect(page.locator('#task-status')).toHaveText('RUN');
    await configure(app, { 'get-job-details': { value: { ...payload, job: { ...payload.job, STATUS: 'HLD' } } } });
    await release(app, 'run-job-action');
    await expect(page.locator('#task-status')).toHaveText('HLD');
    await expect(page.locator('#task-action-note')).toHaveText('Job held.');
});

test('offline task state disables every protected action including runbooks and MCP', async ({ task: { app, page } }) => {
    await configure(app, {
        'get-job-details': { value: { ...payload, runbook: { id: 'recovery' } } },
        'get-verified-runbook': { value: { success: true,
            definition: { title: 'Recovery', steps: [{ title: 'Verify', kind: 'verify' }] },
            execution: { id: 'runbook-1', status: 'running', currentStepIndex: 0, steps: [] }
        } }
    });
    await page.locator('#task-refresh').click();
    await expect(page.locator('#task-runbook-step')).toBeEnabled();
    await page.locator('[data-mcp-tool="hold-job"]').click();
    await expect(page.locator('#task-mcp-action-run')).toBeEnabled();
    await configure(app, { 'get-job-details': { error: 'Connection unavailable.' } });
    await page.locator('#task-refresh').click();
    await expect(page.locator('#task-sync-state')).toContainText('Offline');
    for (const selector of ['#task-runbook-step', '#task-runbook-start', '#task-mcp-action-run', '[data-mcp-tool="hold-job"]', '[data-action-kind="holdJob"]', '[data-memory-action="approve"]']) {
        await expect(page.locator(selector)).toBeDisabled();
        await page.locator(selector).dispatchEvent('click');
    }
    expect(await calls(app, 'run-job-action')).toHaveLength(0);
    expect(await calls(app, 'run-mcp-action')).toHaveLength(0);
    expect(await calls(app, 'run-verified-runbook-step')).toHaveLength(0);
    expect(await calls(app, 'approve-resolution-memory')).toHaveLength(0);
    expect(await calls(app, 'preview-mcp-action')).toHaveLength(1);
});
