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
    ]
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
                'get-app-flags': { value: { operatorName: 'reviewer' } },
                'get-entitlements': { value: { features: {} } },
                'update-alert-workflow': { value: { success: true } },
                'create-clickup-task-for-alert': { value: { success: true } },
                'run-job-action': { value: { success: true, message: 'Job held.' } },
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

test('tabs support keyboard navigation and History shows escaped incident evidence', async ({ task: { app, page } }) => {
    const overview = page.getByRole('tab', { name: 'Overview', exact: true });
    await overview.focus();
    await overview.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Details', exact: true })).toBeFocused();
    await expect(page.locator('#task-disk-io')).toHaveText('0');
    await page.keyboard.press('Home');
    await expect(overview).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await expect(overview).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tabpanel', { name: 'Actions', exact: true })).toBeVisible();
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

test('Actions shows the response brief and keeps handoff routing compact', async ({ task: { page } }) => {
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
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

test('L3 workspace explains a problem match and captures confirmation evidence', async ({ task: { app, page } }) => {
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
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

test('sends and accepts a persisted incident handoff', async ({ task: { app, page } }) => {
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
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

test('AI actions reveal and focus AI tab, reject duplicate requests and recover from failures', async ({ task: { app, page } }) => {
    await configure(app, { 'ask-ai-assistant': { error: 'Provider unavailable.', hold: true } });
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
    await page.getByRole('button', { name: 'Explain Issue', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'AI helper', exact: true })).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: 'AI helper', exact: true })).toBeVisible();
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
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Details', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
    await page.getByRole('button', { name: 'Open ClickUp', exact: true }).click();
    await expect(page.locator('#task-workflow-note')).toContainText('Link could not open.');
});

test('task panels stay usable at the minimum window size', async ({ task: { page } }, testInfo) => {
    await page.setViewportSize({ width: 560, height: 460 });
    for (const name of ['Overview', 'Actions', 'AI helper', 'History', 'Details']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.getByRole('tab', { name: 'Actions', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('task-actions-560.png'), fullPage: true });
});
