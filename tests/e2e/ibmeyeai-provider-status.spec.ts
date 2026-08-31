import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

async function launchTestApp(): Promise<{
    electronApp: ElectronApplication;
    page: Page;
    cleanup: () => Promise<void>;
}> {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ibmeye-provider-e2e-'));
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

    return {
        electronApp,
        page: await electronApp.firstWindow(),
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
    await page.locator('.ai-assistant-panel > summary').click();
    await page.locator('.alerts-panel > summary').click();
    await page.locator('.table-shell > summary').click({ force: true });
}

test('shows the provider model source hint in the panel and floating widget', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);

        await expect(app.page.locator('#ai-provider-model-source')).toContainText(
            /Live models loaded|Using fallback suggestions/
        );

        await app.page.locator('#ibmeyeai-launcher').click();
        await expect(app.page.locator('#ibmeyeai-widget-model-source')).toContainText(
            /Live models loaded|Using fallback suggestions/
        );
    } finally {
        await app.cleanup();
    }
});

test('sends preset prompts directly to the transcript and exposes alert and job AI actions', async () => {
    const app = await launchTestApp();

    try {
        await openDemoMonitor(app.page);

        await app.page.getByTestId('ai-prompt-incident-summary').click();
        await expect(app.page.locator('#ai-chat-transcript')).toContainText('current incident picture');
        await expect(app.page.locator('#ai-assistant-input')).toHaveValue('');

        const firstAlert = app.page.getByTestId('alert-card').first();
        await firstAlert.getByTestId('alert-toggle').click();
        await expect(firstAlert.getByTestId('alert-ai-explain')).toBeVisible();
        await expect(firstAlert.getByTestId('alert-ai-next-actions')).toBeVisible();
        await expect(app.page.locator('#ai-assistant-refresh')).toHaveCount(0);

        await firstAlert.getByTestId('alert-ai-explain').click();
        await expect(app.page.locator('#ibmeyeai-widget')).toHaveAttribute('data-open', 'true');
        await expect(app.page.locator('#ibmeyeai-widget-refresh')).toHaveCount(0);

        await app.page.locator('tbody .job-row').first().click();
        await expect(app.page.getByTestId('detail-ai-health')).toBeVisible();
        await expect(app.page.getByTestId('detail-ai-health')).toBeEnabled();
    } finally {
        await app.cleanup();
    }
});
