import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

interface TestAppHandle {
    electronApp: ElectronApplication;
    page: Page;
}

async function createSandboxDirectories() {
    const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ibmeye-theme-e2e-'));
    const homeDirectory = path.join(sandboxRoot, 'home');
    const storeDirectory = path.join(sandboxRoot, 'store');
    const userDataDirectory = path.join(sandboxRoot, 'user-data');

    await Promise.all([
        fs.mkdir(homeDirectory, { recursive: true }),
        fs.mkdir(storeDirectory, { recursive: true }),
        fs.mkdir(userDataDirectory, { recursive: true })
    ]);

    return {
        sandboxRoot,
        env: {
            ...process.env,
            HOME: homeDirectory,
            IBM_EYE_STORE_DIR: storeDirectory,
            IBM_EYE_USER_DATA_DIR: userDataDirectory
        }
    };
}

async function launchWithEnvironment(env: NodeJS.ProcessEnv): Promise<TestAppHandle> {
    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env
    });

    return {
        electronApp,
        page: await electronApp.firstWindow()
    };
}

async function openDemoMonitor(page: Page) {
    await expect(page.getByTestId('launch-demo')).toBeVisible();
    await page.getByTestId('launch-demo').click();
    await expect(page.getByRole('heading', { name: 'IBMEye Incident Queue', exact: true })).toBeVisible();
}

test('applies the selected theme and restores it after restart', async () => {
    const sandbox = await createSandboxDirectories();
    let app: TestAppHandle | null = null;

    try {
        app = await launchWithEnvironment(sandbox.env);
        await openDemoMonitor(app.page);

        await app.page.locator('#theme-menu-trigger').click();
        await expect(app.page.getByTestId('theme-menu-options')).toBeVisible();
        await app.page.locator('[data-theme-id="night-console"]').click();
        await expect(app.page.locator('body')).toHaveAttribute('data-theme', 'night-console');
        await expect(app.page.getByTestId('theme-description')).toContainText('Dark graphite panels');

        await app.electronApp.close();

        app = await launchWithEnvironment(sandbox.env);
        await expect(app.page.locator('body')).toHaveAttribute('data-theme', 'night-console');
    } finally {
        if (app) {
            await app.electronApp.close();
        }
        await fs.rm(sandbox.sandboxRoot, { recursive: true, force: true });
    }
});
