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
    await expect(page.getByText('Operator intervention queue')).toBeVisible();
    await expect(page.getByTestId('alert-card').first()).toBeVisible();
}

test('launches the demo monitor and renders live alert cards', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);
        await expect(app.page.getByText('Live monitor')).toBeVisible();
        await expect(app.page.getByTestId('alert-count')).toContainText('active alerts');
    } finally {
        await app.cleanup();
    }
});

test('supports expand, acknowledge, start, note, resolve, and clear in the alert workflow', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);

        const firstAlert = app.page.getByTestId('alert-card').first();
        await firstAlert.getByTestId('alert-toggle').click();
        await expect(firstAlert.getByTestId('alert-body')).toBeVisible();

        await firstAlert.getByTestId('alert-acknowledge').click();
        await expect(firstAlert.getByTestId('alert-workflow-badge')).toHaveText('ACKNOWLEDGED');

        await firstAlert.getByTestId('alert-start').click();
        await expect(firstAlert.getByTestId('alert-workflow-badge')).toHaveText('IN PROGRESS');

        await firstAlert.getByTestId('alert-note-toggle').click();
        await expect(firstAlert.getByTestId('alert-note-composer')).toBeVisible();
        await firstAlert.getByTestId('alert-note-input').fill('Checked by e2e smoke test');
        await firstAlert.getByTestId('alert-note-save').click();
        await expect(firstAlert.getByTestId('alert-note-item').first()).toContainText('Checked by e2e smoke test');
        await expect(firstAlert.getByTestId('alert-timeline')).toContainText('Note added');

        await firstAlert.getByTestId('alert-resolve').click();
        await expect(firstAlert.getByTestId('alert-workflow-badge')).toHaveText('RESOLVED');

        const initialCount = await app.page.getByTestId('alert-card').count();
        await firstAlert.getByTestId('alert-clear').click();
        await expect(app.page.getByTestId('alert-card')).toHaveCount(initialCount - 1);
    } finally {
        await app.cleanup();
    }
});
