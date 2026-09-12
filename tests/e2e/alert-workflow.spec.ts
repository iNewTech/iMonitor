import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

async function launchTestApp(): Promise<{
    electronApp: ElectronApplication;
    page: Page;
    cleanup: () => Promise<void>;
}> {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ibmeye-e2e-'));
    const storeDirectory = path.join(sandboxRoot, 'store');
    const userDataDirectory = path.join(sandboxRoot, 'user-data');

    await Promise.all([
        fs.mkdir(storeDirectory, { recursive: true }),
        fs.mkdir(userDataDirectory, { recursive: true })
    ]);

    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env: {
            ...process.env,
            IBM_EYE_STORE_DIR: storeDirectory,
            IBM_EYE_USER_DATA_DIR: userDataDirectory
        }
    });

    const page = await electronApp.firstWindow();
    // Only provider boundaries are mocked; job and incident operations use the
    // actual demo runtime, persisted workflow store, preload and native windows.
    await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('ask-ai-assistant');
        ipcMain.handle('ask-ai-assistant', () => ({ success: true, reply: 'Mock job analysis: inspect the job log.' }));
        ipcMain.removeHandler('get-ai-availability');
        ipcMain.handle('get-ai-availability', () => ({
            enabled: true, provider: 'ollama', providerLabel: 'Ollama', providerFamily: 'ollama',
            endpoint: 'http://127.0.0.1:11434', selectedModel: 'gemma3:latest', availableModels: [],
            healthy: true, featureAccess: 'included', message: 'Mock provider ready.'
        }));
    });

    return {
        electronApp,
        page,
        cleanup: async () => {
            await electronApp.close();
            await fs.rm(sandboxRoot, { recursive: true, force: true });
        }
    };
}

async function openDemoMonitor(page: Page) {
    await expect(page.locator('#saved-connections')).toHaveValue('demo-connection');
    await page.locator('#connect').click();
    await expect(page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
    await expect(page.locator('.actionboard-jobs-panel')).toHaveAttribute('open', '');
    await expect(page.locator('.job-row.has-incident').first()).toBeVisible();
    // Keep the real demo poll running, with stable evidence during each workflow.
    await page.locator('#refresh-interval').selectOption('60000');
}

async function openTaskWindow(app: Awaited<ReturnType<typeof launchTestApp>>, open: () => Promise<unknown>) {
    const opened = app.electronApp.waitForEvent('window');
    await open();
    const task = await opened;
    await task.waitForLoadState('domcontentloaded');
    await expect(task).toHaveURL(/job-task\.html\?jobName=/);
    await expect(task.locator('#task-content')).toBeVisible();
    await expect(app.page.locator('#job-detail-drawer')).not.toHaveClass(/is-open/);
    return task;
}

async function selectedIncident(page: Page) {
    const alerts = await page.evaluate(() => window.electronAPI.getActiveAlerts());
    const incident = alerts.find((entry) => entry.kind === 'messageWait' && entry.isActive !== false);
    expect(incident, 'The persistent demo MSGW incident must be available').toBeDefined();
    return incident!;
}

async function readIncident(page: Page, alertId: string) {
    return page.evaluate(async (id) => (await window.electronAPI.getActiveAlerts()).find((entry) => entry.id === id), alertId);
}

function incidentRow(page: Page, jobName: string) {
    return page.locator('.job-row').filter({ has: page.locator('.job-cell-primary small', { hasText: jobName }) });
}

test('launches the demo monitor and renders live incidents in active jobs', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);
        await expect(app.page.locator('.hero-logo')).toHaveAttribute('src', 'assets/ibm-eye.svg');
        await expect(app.page.locator('.ai-assistant-panel')).toHaveClass(/panel-tone-ai/);
        await expect(app.page.locator('.alert-rules-panel')).toHaveClass(/panel-tone-alerts/);
        await expect(app.page.locator('#app-status-bar')).toBeVisible();
        await expect(app.page.locator('#app-status-message')).toContainText(/Monitoring healthy|Waiting for monitoring/);
        await expect(app.page.locator('.activity-log-shell')).toHaveCount(0);
        await expect(app.page.locator('.alerts-panel')).toBeHidden();
        await expect(app.page.getByTestId('jobs-visible-count')).toContainText(/Showing \d+ of \d+ jobs/);
        const incident = await selectedIncident(app.page);
        await expect.poll(async () => {
            const current = await readIncident(app.page, incident.id);
            return current?.evidence?.jobLog.status;
        }).toMatch(/^(captured|stale)$/);
        const row = incidentRow(app.page, incident.jobName!);
        await expect(row).toBeVisible();
        await expect(row.locator('.job-incident-chip')).toHaveText('MSGW');
        await expect(row.locator('.job-priority-chip')).toHaveText(/^P\d+$/);
        await expect(row).toHaveClass(/is-critical/);
        await app.page.evaluate(() => window.electronAPI.saveBusinessServiceSettings({
            mappings: [{ id: 'demo-service', serviceName: 'Order processing', owner: 'Finance operations', systemIds: ['*'], alertKinds: [], jobPattern: '*', priority: 0, deadlineMinutes: 60 }]
        }));
        const task = await openTaskWindow(app, () => row.click());
        await expect(task.locator('#task-qualified-job')).toHaveText(incident.jobName!);
        await expect(task.locator('#task-issue-title')).toHaveText(incident.title);
        await expect(task.locator('#task-issue-summary')).toHaveText(incident.message);
        await expect(task.locator('#task-issue-state')).toHaveText('CRITICAL | New');
        await task.getByRole('tab', { name: 'Actions', exact: true }).click();
        await expect(task.locator('#task-response-business')).toHaveText('Order processing');
        await expect(task.locator('#task-response-business-summary')).toContainText('Finance operations');
        await expect(task.getByTestId('incident-correlation-summary')).toContainText(/Priority \d+\/100/);
        await expect(task.locator('#task-routing-summary')).toContainText('Suggested owner:');
        await expect(task.locator('#task-runbook-policy')).toContainText('Message wait response · v1');
        await expect(task.locator('#task-runbook-section')).toBeVisible();
        await expect(task.locator('#task-runbook-steps li')).toHaveCount(3);
        await task.locator('#task-runbook-start').click();
        await expect(task.locator('#task-runbook-status')).toHaveText('Running');
        await task.locator('#task-runbook-step').click();
        await expect(task.locator('#task-runbook-summary')).toContainText('1/3 checkpoints complete');
        await task.locator('#task-memory-save').click();
        await expect(task.locator('.resolution-memory-item')).toContainText(incident.title);
        await expect(task.locator('.resolution-memory-item')).toContainText('Draft');
        await task.locator('.resolution-memory-item [data-memory-action="approve"]').click();
        await expect(task.locator('.resolution-memory-item')).toContainText('Approved');
        await task.getByRole('tab', { name: 'Details', exact: true }).click();
        await task.locator('#task-load-graph').click();
        await expect(task.getByTestId('task-resource-graph')).toContainText('Observed resource relationships');
        await expect(task.getByTestId('task-resource-graph')).toContainText('uses queue');
        await task.locator('.resource-graph-table summary').click();
        await expect(task.locator('.resource-graph-table table')).toContainText('Job queue');
        await task.getByRole('tab', { name: 'Overview', exact: true }).click();
        await expect(task.locator('[data-testid="task-evidence-captured"]')).toBeVisible();
        await expect(task.locator('[data-testid="task-evidence-captured"]')).toContainText('Job log');
    } finally {
        await app.cleanup();
    }
});

test('prioritizes incident jobs and opens the next task from the active jobs board', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);
        await expect(app.page.locator('#actionboard-focus-title')).toBeVisible();
        await expect(app.page.locator('#actionboard-attention-count')).toContainText(/[1-9]\d*/);
        await app.page.getByTestId('jobs-filter-msgw').click();
        await expect(app.page.getByTestId('jobs-filter-msgw')).toHaveAttribute('aria-pressed', 'true');
        await expect(app.page.locator('.job-row .badge').first()).toHaveText('Message wait');
        const filteredStates = await app.page.locator('.job-row .badge').allTextContents();
        expect(filteredStates.length).toBeGreaterThan(0);
        expect(filteredStates.every((status) => status.trim() === 'Message wait')).toBe(true);
        // Focus Next must escape an unrelated filter and open a critical wait.
        await app.page.getByTestId('jobs-search-input').fill('no-matching-job');
        await expect(app.page.locator('#system-stats tbody')).toContainText('No jobs match');
        const task = await openTaskWindow(app, () => app.page.locator('#superpanel-focus-next').click());
        await expect(app.page.getByTestId('jobs-filter-all')).toHaveAttribute('aria-pressed', 'true');
        await expect(app.page.getByTestId('jobs-search-input')).toHaveValue('');
        await expect(task.locator('#task-issue-state')).toContainText('CRITICAL');
        await expect(task.locator('#task-status')).toHaveText(/MSGW|LCKW/);
        const jobName = await task.locator('#task-qualified-job').innerText();
        await expect(incidentRow(app.page, jobName)).toBeVisible();
        await task.getByRole('tab', { name: 'Actions', exact: true }).click();
        await expect(task.getByRole('button', { name: 'Claim Work', exact: true })).toBeEnabled();
    } finally {
        await app.cleanup();
    }
});

test('keeps ClickUp ticket creation with the operator workflow', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);
        const operator = (await app.page.evaluate(() => window.electronAPI.getAppFlags())).operatorName;
        expect(operator).toBeTruthy();
        await app.page.locator('#open-settings').click();
        await app.page.getByTestId('settings-page-alerts').click();
        await expect(app.page.locator('#settings-alert-panel')).toBeVisible();
        await expect(app.page.locator('#settings-alert-panel').getByText('ClickUp', { exact: true })).toHaveCount(0);
        await app.page.getByTestId('settings-page-integrations').click();
        await expect(app.page.locator('#settings-clickup-panel')).toBeVisible();
        await expect(app.page.locator('#settings-clickup-user')).toContainText(`Saved for operator: ${operator}`);
        await app.page.locator('#settings-clickup-panel > summary').click();
        await expect(app.page.locator('#settings-clickup-enabled')).not.toBeChecked();
        await expect(app.page.locator('#settings-clickup-token')).toHaveValue('');
    } finally {
        await app.cleanup();
    }
});

test('keeps duplicate properties out and loads job logs only when requested', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);
        const task = await openTaskWindow(app, () => app.page.locator('.job-row').first().click());
        await expect(task.getByRole('heading', { name: 'Current or last SQL statement', exact: true })).toHaveCount(0);
        await expect(task.locator('#load-job-context')).toHaveCount(0);
        await expect(task.locator('#job-context-output')).toHaveCount(0);
        await task.getByRole('tab', { name: 'Details', exact: true }).click();
        await expect(task.locator('#task-details-output')).toBeEmpty();
        await task.getByRole('tab', { name: 'AI helper', exact: true }).click();
        await expect(task.locator('#task-ai-output')).toBeHidden();
        await expect(task.locator('#task-ai-summary')).toBeEnabled();
        await task.locator('#task-ai-summary').click();
        await expect(task.locator('#task-ai-output')).toBeVisible();
        await expect(task.locator('#task-ai-status')).toHaveText('Ready');
        await expect(task.locator('#task-ai-content')).toContainText('Mock job analysis: inspect the job log.');
        await expect(app.page.locator('#ibmeyeai-widget')).toHaveAttribute('data-open', 'false');
        await task.getByRole('tab', { name: 'Details', exact: true }).click();
        await expect(task.locator('#task-details-output')).toBeEmpty();
        await task.locator('#task-load-log').click();
        await expect(task.locator('#task-details-output')).toContainText('Recent job log');
        await expect(task.locator('#task-details-output')).toContainText('STATUS');
    } finally {
        await app.cleanup();
    }
});

test('requires confirmation before running an IBM i job action', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);
        const task = await openTaskWindow(app, () => app.page.locator('.job-row').first().click());
        await task.getByRole('tab', { name: 'Actions', exact: true }).click();
        const jobName = await task.locator('#task-qualified-job').innerText();
        const originalNote = await task.locator('#task-action-note').innerText();
        let dismissed = false;
        task.once('dialog', async (dialog) => {
            expect(dialog.type()).toBe('confirm');
            expect(dialog.message()).toContain(jobName);
            dismissed = true;
            await dialog.dismiss();
        });
        await task.getByRole('button', { name: 'Hold Job', exact: true }).click();
        expect(dismissed).toBe(true);
        await expect(task.locator('#task-action-note')).toHaveText(originalNote);
        let confirmed = false;
        task.once('dialog', async (dialog) => {
            expect(dialog.type()).toBe('confirm');
            expect(dialog.message()).toContain(jobName);
            confirmed = true;
            await dialog.accept();
        });
        await task.getByRole('button', { name: 'Hold Job', exact: true }).click();
        expect(confirmed).toBe(true);
        await expect(task.locator('#task-action-note')).toContainText('Action completed: holdJob');
        await expect(task.locator('#task-refresh')).toBeEnabled();
        await task.locator('#task-refresh').click();
        await expect(task.locator('#task-refresh')).toBeEnabled();
        await expect(task.locator('#task-action-note')).toContainText('Action completed: holdJob');
    } finally {
        await app.cleanup();
    }
});

test('supports acknowledge, claim, note, work done, and return-to-queue in the alert workflow', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);
        const incident = await selectedIncident(app.page);
        const alertId = incident.id;
        const jobName = incident.jobName!;
        const operator = (await app.page.evaluate(() => window.electronAPI.getAppFlags())).operatorName;
        expect(operator).toBeTruthy();
        const row = incidentRow(app.page, jobName);
        const task = await openTaskWindow(app, () => row.click());
        await task.getByRole('tab', { name: 'Actions', exact: true }).click();
        await task.getByRole('button', { name: 'Acknowledge', exact: true }).click();
        await expect.poll(() => readIncident(app.page, alertId)).toMatchObject({ workflowStatus: 'acknowledged' });
        await expect(task.getByRole('button', { name: 'Acknowledge', exact: true })).toHaveCount(0);
        await task.getByRole('button', { name: 'Claim Work', exact: true }).click();
        await expect.poll(() => readIncident(app.page, alertId)).toMatchObject({ workflowStatus: 'claimed', owner: operator });
        await expect(task.locator('.job-task-owner')).toHaveText(`Owner: ${operator}`);
        await expect(task.getByRole('button', { name: 'Claim Work', exact: true })).toHaveCount(0);
        await expect(task.getByRole('button', { name: 'Mark Work Done', exact: true })).toBeEnabled();
        expect((await readIncident(app.page, alertId))?.clickUpTask).toBeUndefined();

        // Native task windows currently lack the old note composer. Preserve the
        // real note mutation/persistence and visible timeline coverage through IPC;
        // this does not claim coverage of a note-entry UI that no longer exists.
        const note = 'Checked by e2e smoke test';
        const result = await task.evaluate(({ id, text }) => window.electronAPI.updateAlertWorkflow({
            alertId: id, action: 'note', note: text
        }), { id: alertId, text: note });
        expect(result.success).toBe(true);
        await expect.poll(async () => (await readIncident(app.page, alertId))?.notes).toEqual([
            expect.objectContaining({ text: note, author: operator })
        ]);
        await task.getByRole('tab', { name: 'History', exact: true }).click();
        await expect(task.locator('#task-incident-history')).toContainText('Note added');
        await expect(task.locator('#task-incident-history')).toContainText(note);
        await task.getByRole('tab', { name: 'Actions', exact: true }).click();
        await task.getByRole('button', { name: 'Mark Work Done', exact: true }).click();
        await expect.poll(() => readIncident(app.page, alertId)).toMatchObject({ workflowStatus: 'work_done', owner: operator });
        await task.getByRole('tab', { name: 'History', exact: true }).click();
        const history = task.locator('#task-incident-history .on-demand-record-group').filter({
            has: task.getByRole('heading', { name: `${incident.title} · Work done`, exact: true })
        });
        await expect(history.locator('.alert-timeline-entry')).toHaveCount(5);
        await expect(history.locator('.alert-timeline-entry strong')).toHaveText([
            'Work marked done', 'Note added', 'Work claimed', 'Acknowledged', 'Alert created'
        ]);
        await task.getByRole('tab', { name: 'Actions', exact: true }).click();
        await task.getByRole('button', { name: 'Remove Claim', exact: true }).click();
        await expect.poll(async () => {
            const updated = await readIncident(app.page, alertId);
            return { owner: updated?.owner || '', workflowStatus: updated?.workflowStatus };
        }).toEqual({ owner: '', workflowStatus: 'acknowledged' });
        await expect(task.locator('.job-task-owner')).toHaveText('Unassigned');
        await expect(task.locator('#task-incident-actions .activity-log-badge.is-area')).toHaveText('Acknowledged');
        await expect(task.getByRole('button', { name: 'Claim Work', exact: true })).toBeEnabled();
        await task.getByRole('tab', { name: 'History', exact: true }).click();
        await expect(task.locator('#task-incident-history')).toContainText('Returned to queue');
        await expect(task.locator('#task-incident-history')).toContainText(note);
    } finally {
        await app.cleanup();
    }
});

// Keep cross-window freshness separate so a stale board cannot prevent the
// acknowledge/note/work-done/release persistence scenario above from running.
test('updates the active job owner badge immediately after claiming and releasing work', async () => {
    const app = await launchTestApp();
    try {
        await openDemoMonitor(app.page);
        const incident = await selectedIncident(app.page);
        const operator = (await app.page.evaluate(() => window.electronAPI.getAppFlags())).operatorName;
        expect(operator).toBeTruthy();
        const row = incidentRow(app.page, incident.jobName!);
        const task = await openTaskWindow(app, () => row.click());
        await task.getByRole('tab', { name: 'Actions', exact: true }).click();
        await task.getByRole('button', { name: 'Claim Work', exact: true }).click();
        await expect.poll(() => readIncident(app.page, incident.id)).toMatchObject({ workflowStatus: 'claimed', owner: operator });
        await expect(row.locator('.job-owner-chip')).toHaveText(operator!);
        await task.getByRole('button', { name: 'Remove Claim', exact: true }).click();
        await expect.poll(async () => (await readIncident(app.page, incident.id))?.owner || '').toBe('');
        await expect(row.locator('.job-owner-chip')).toHaveCount(0);
    } finally {
        await app.cleanup();
    }
});
