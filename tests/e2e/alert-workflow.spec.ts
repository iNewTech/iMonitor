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
    const homeDirectory = path.join(sandboxRoot, 'home');
    const storeDirectory = path.join(sandboxRoot, 'store');
    const userDataDirectory = path.join(sandboxRoot, 'user-data');

    await Promise.all([
        fs.mkdir(homeDirectory, { recursive: true }),
        fs.mkdir(storeDirectory, { recursive: true }),
        fs.mkdir(userDataDirectory, { recursive: true })
    ]);

    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env: {
            ...process.env,
            HOME: homeDirectory,
            IBM_EYE_STORE_DIR: storeDirectory,
            IBM_EYE_USER_DATA_DIR: userDataDirectory
        }
    });

    const page = await electronApp.firstWindow();

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
    await expect(page.getByRole('heading', { name: 'IBMEye Incident Queue', exact: true })).toBeVisible();
    const alertsPanel = page.locator('.alerts-panel');
    if (!(await alertsPanel.evaluate((panel: HTMLDetailsElement) => panel.open))) {
        await alertsPanel.locator(':scope > summary').click();
    }
    await expect(page.getByTestId('alert-card').first()).toBeVisible();
}

test('launches the demo monitor and renders live alert cards', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);
        await expect(app.page.getByRole('heading', { name: 'iMonitor ActionBoard', exact: true })).toBeVisible();
        await expect(app.page.locator('.hero-logo')).toHaveAttribute('src', 'assets/ibm-eye.svg');
        await expect(app.page.locator('.ai-assistant-panel')).toHaveClass(/panel-tone-ai/);
        await expect(app.page.locator('.alert-rules-panel')).toHaveClass(/panel-tone-alerts/);
        await expect(app.page.locator('#app-status-bar')).toBeVisible();
        await expect(app.page.locator('#app-status-message')).toContainText(/Monitoring healthy|Waiting for monitoring/);
        await expect(app.page.locator('.activity-log-shell')).toHaveCount(0);
        await expect(app.page.getByTestId('alert-count')).toContainText('active alert');
    } finally {
        await app.cleanup();
    }
});

test('turns the incident queue into a prioritized action board', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);
        await expect(app.page.locator('#actionboard-focus-title')).toBeVisible();
        await expect(app.page.locator('#actionboard-attention-count')).toContainText(/\d+/);
        await expect(app.page.getByTestId('alert-filter-attention')).toBeVisible();

        await app.page.getByTestId('alert-filter-attention').click();
        await expect(app.page.getByTestId('alert-filter-attention')).toHaveAttribute('aria-pressed', 'true');
        await app.page.getByTestId('focus-next-alert').click();
        await expect(app.page.locator('#focus-alert-shell')).not.toHaveAttribute('hidden', '');
        await expect(app.page.getByTestId('focus-alert-card')).toBeVisible();
    } finally {
        await app.cleanup();
    }
});

test('keeps ClickUp ticket creation with the operator workflow', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);

        await app.page.locator('#open-settings').click();
        await app.page.getByTestId('settings-page-alerts').click();
        await expect(app.page.locator('#settings-alert-panel')).toBeVisible();
    } finally {
        await app.cleanup();
    }
});

test('keeps duplicate properties out and loads job logs only when requested', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);
        await expect(app.page.locator('.job-row').first()).toBeVisible();
        await app.page.locator('.job-row').first().click();
        await expect(app.page.locator('#job-detail-drawer')).toHaveClass(/is-open/);
        await expect(app.page.getByRole('heading', { name: 'Current or last SQL statement', exact: true })).toHaveCount(0);
        await expect(app.page.locator('#load-job-context')).toHaveCount(0);
        await expect(app.page.locator('#job-context-output')).toHaveCount(0);
        await expect(app.page.getByTestId('detail-wait-ai')).toBeEnabled();

        await app.page.getByTestId('detail-wait-ai').click();
        await expect(app.page.locator('#detail-wait-ai-report')).toBeVisible();
        await expect(app.page.locator('#detail-wait-ai-content')).not.toBeEmpty();
        await expect(app.page.locator('#ibmeyeai-widget')).toHaveAttribute('data-open', 'false');

        await app.page.locator('#load-job-log').click();
        await expect(app.page.locator('#job-log-output')).toContainText('Recent job log');
        await expect(app.page.locator('#job-log-output')).toContainText('STATUS');
    } finally {
        await app.cleanup();
    }
});

test('requires confirmation before running an IBM i job action', async () => {
    const app = await launchTestApp();

    try {
        app.page.on('dialog', (dialog) => void dialog.accept());
        await openDemoMonitor(app.page);
        await expect(app.page.locator('.job-row').first()).toBeVisible();
        await app.page.locator('.job-row').first().click();
        await app.page.locator('#job-detail-drawer').getByRole('button', { name: 'Hold Job' }).click();
        await expect(app.page.locator('#detail-operator-action-note')).toContainText('Action completed: holdJob');
    } finally {
        await app.cleanup();
    }
});

test('supports acknowledge, claim, note, work done, and return-to-queue in the alert workflow', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);

        const firstAlert = app.page.getByTestId('alert-card').first();
        await firstAlert.getByTestId('alert-toggle').click();
        await expect(firstAlert.getByTestId('alert-body')).toBeVisible();
        const alertId = await firstAlert.getAttribute('data-alert-id');

        await firstAlert.getByTestId('alert-acknowledge').click();
        await expect.poll(async () => {
            const alerts = await app.page.evaluate(() => window.electronAPI.getActiveAlerts());
            return alerts.find((entry) => entry.id === alertId)?.workflowStatus;
        }).toBe('acknowledged');

        await firstAlert.getByTestId('alert-claim').click();
        const workingAlert = app.page.getByTestId('focus-alert-card');
        await expect(workingAlert).toBeVisible();
        await expect.poll(async () => {
            const alerts = await app.page.evaluate(() => window.electronAPI.getActiveAlerts());
            return alerts.find((entry) => entry.id === alertId)?.workflowStatus;
        }).toBe('claimed');

        await workingAlert.getByTestId('alert-note-toggle').click();
        await expect(workingAlert.getByTestId('alert-note-composer')).toBeVisible();
        await workingAlert.getByTestId('alert-note-input').fill('Checked by e2e smoke test');
        await workingAlert.getByTestId('alert-note-save').click();
        await expect(workingAlert.getByTestId('alert-timeline')).toContainText('Note added');
        await expect(workingAlert.getByTestId('alert-timeline')).toContainText('Checked by e2e smoke test');
        await workingAlert.getByTestId('alert-work-done').click();
        await expect.poll(async () => {
            const alerts = await app.page.evaluate(() => window.electronAPI.getActiveAlerts());
            return alerts.find((entry) => entry.id === alertId)?.workflowStatus;
        }).toBe('work_done');
        await workingAlert.getByTestId('alert-history-toggle').click();
        await expect(workingAlert.getByTestId('alert-history-toggle')).toContainText('Show less history');
        await expect(workingAlert.getByTestId('alert-timeline').locator('.alert-timeline-entry')).toHaveCount(5);

        await workingAlert.getByTestId('alert-release').click();
        const returnedAlert = app.page.locator(`[data-testid="alert-card"][data-alert-id="${alertId}"]`);
        await expect.poll(async () => {
            const alerts = await app.page.evaluate(() => window.electronAPI.getActiveAlerts());
            return alerts.find((entry) => entry.id === alertId)?.owner || '';
        }).toBe('');
        await expect(returnedAlert.getByTestId('alert-workflow-badge')).toHaveText('ACKNOWLEDGED');
    } finally {
        await app.cleanup();
    }
});
