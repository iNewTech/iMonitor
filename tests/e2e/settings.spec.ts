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
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-settings-e2e-'));
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

test('opens the dedicated settings page and switches AI provider setup', async () => {
    const app = await launchTestApp();

    try {
        await app.page.locator('#launch-demo').click();
        await expect(app.page.getByRole('heading', { name: 'iMonitor Dashboard', exact: true })).toBeVisible();
        await app.page.locator('#open-settings').click();
        await expect(app.page.getByRole('heading', { name: 'Configure AI providers and action integrations', exact: true })).toBeVisible();
        await expect(app.page.getByRole('heading', { name: 'ClickUp action tracking', exact: true })).toBeVisible();

        const providerTabs = app.page.locator('#settings-ai-provider-switcher .settings-provider-tab');
        await expect(providerTabs).toHaveCount(4);

        await app.page.locator('#settings-ai-provider-switcher [data-provider-id="anthropic"]').click();
        await expect(app.page.locator('#settings-ai-endpoint-label')).toHaveText('Claude endpoint');
        await expect(app.page.locator('#settings-ai-api-key-label')).toHaveText('Claude API key');
        await expect(app.page.locator('#settings-ai-model-label')).toHaveText('Claude model');

        await app.page.locator('#settings-ai-provider-switcher [data-provider-id="openai"]').click();
        await expect(app.page.locator('#settings-ai-endpoint-label')).toHaveText('API endpoint');
        await expect(app.page.locator('#settings-ai-api-key-label')).toHaveText('OpenAI API key');
        await expect(app.page.locator('#settings-ai-model-label')).toHaveText('OpenAI model');
    } finally {
        await app.cleanup();
    }
});
