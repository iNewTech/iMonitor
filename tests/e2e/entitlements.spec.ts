import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';

test('shows the development plan and accepts the development license key', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imonitor-entitlements-e2e-'));
    const electronApp = await electron.launch({
        args: [path.resolve(process.cwd())],
        env: {
            ...process.env,
            HOME: path.join(root, 'home'),
            IBM_EYE_STORE_DIR: path.join(root, 'store'),
            IBM_EYE_USER_DATA_DIR: path.join(root, 'user-data'),
            IMONITOR_PREMIUM_DISABLED: '1'
        }
    });

    try {
        const page = await electronApp.firstWindow();
        await expect(page.locator('#plan-label')).toHaveText('Free plan');
        await page.locator('#plan-panel > summary').click();
        await page.locator('#development-license-key').fill('IMONITOR-DEV-PREMIUM-2026');
        await page.locator('#activate-development-license').click();
        await expect(page.locator('#plan-label')).toHaveText('Premium plan');
        await expect(page.locator('#plan-status')).toHaveText('Development license activated.');
    } finally {
        await electronApp.close();
        await fs.rm(root, { recursive: true, force: true });
    }
});
