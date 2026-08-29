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
    await expect(page.getByTestId('launch-demo')).toBeVisible();
    await page.getByTestId('launch-demo').click();
    await expect(page.getByRole('heading', { name: 'IBMEye Incident Queue', exact: true })).toBeVisible();
    await expect(page.getByTestId('alert-card').first()).toBeVisible();
}

test('launches the demo monitor and renders live alert cards', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);
        await expect(app.page.getByRole('heading', { name: 'iMonitor Dashboard', exact: true })).toBeVisible();
        await expect(app.page.getByTestId('alert-count')).toContainText('active alert');
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

        await workingAlert.getByTestId('alert-release').click();
        const returnedAlert = app.page.getByTestId('alert-card').first();
        await expect.poll(async () => {
            const alerts = await app.page.evaluate(() => window.electronAPI.getActiveAlerts());
            return alerts.find((entry) => entry.id === alertId)?.owner || '';
        }).toBe('');
        await expect(returnedAlert.getByTestId('alert-workflow-badge')).toHaveText('ACKNOWLEDGED');
    } finally {
        await app.cleanup();
    }
});
