import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';

test('shows a focused connection workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-connection-e2e-'));
    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env: {
            ...process.env,
            HOME: path.join(root, 'home'),
            IBM_EYE_STORE_DIR: path.join(root, 'store'),
            IBM_EYE_USER_DATA_DIR: path.join(root, 'user-data')
        }
    });

    try {
        const page = await electronApp.firstWindow();
        await expect(page.getByRole('heading', { name: 'Connect to IBM i', exact: true })).toBeVisible();
        await expect(page.locator('.brand-panel')).toHaveCount(0);
        await expect(page.locator('#connect')).toHaveText(/Connect & Monitor/);
        await expect(page.locator('#save-connection')).toHaveText(/Save Profile/);
        await expect(page.locator('#launch-demo')).toHaveCount(0);
        await expect(page.locator('#theme-menu > summary')).toHaveAttribute('title', 'Change theme');

        await page.locator('#plan-panel > summary').click();
        await expect(page.locator('.plan-panel-body')).toBeVisible();
        await expect(page.locator('.plan-panel-body')).toHaveCSS('position', 'absolute');
    } finally {
        await electronApp.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
